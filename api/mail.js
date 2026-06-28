import { verifyToken } from "./_auth.js";
import { CONFIG, readData, writeData } from "./_config.js";

// Samengevoegde mail-functie.
//
// Routes op basis van ?action= parameter:
//   ?action=inbox     - haal de laatste mails op (vereist login)
//   ?action=settings  - GET/POST/DELETE IMAP-instellingen (vereist login)
//
// Het wachtwoord wordt NOOIT teruggegeven aan de frontend.

const SETTINGS_KEY = "nova_imap_settings";

async function getImapConfig() {
  // Eerst KV (door gebruiker in NOVA ingevoerd)
  const stored = await readData(SETTINGS_KEY, null);
  if (stored && stored.host && stored.user && stored.pass) {
    return { host: stored.host, port: stored.port || 993, user: stored.user, pass: stored.pass, source: "app" };
  }
  // Anders env-variables (fallback voor wie het zo had ingesteld)
  if (process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS) {
    return {
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT) || 993,
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
      source: "env",
    };
  }
  return null;
}

// --- INBOX ---

async function fetchImapInbox(cfg) {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const messages = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox.exists;
      if (total > 0) {
        const start = Math.max(1, total - 19);
        for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: true, flags: true })) {
          let snippet = "";
          try {
            const parsed = await simpleParser(msg.source);
            snippet = (parsed.text || "").trim().slice(0, 200);
          } catch { /* snippet blijft leeg */ }
          messages.push({
            id: "mail-" + msg.uid,
            from: msg.envelope.from?.[0]?.address || "",
            fromName: msg.envelope.from?.[0]?.name || "",
            subject: msg.envelope.subject || "(geen onderwerp)",
            received: msg.envelope.date,
            snippet,
            unread: !msg.flags.has("\\Seen"),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  messages.sort((a, b) => new Date(b.received) - new Date(a.received));
  return messages;
}

async function handleInbox(req, res) {
  const cfg = await getImapConfig();
  const gmailOutlookOnly = CONFIG.hasMailConnection() && !cfg;

  if (!cfg && !gmailOutlookOnly) {
    return res.status(200).json({
      connected: false,
      emails: [],
      note: "Mailkoppeling nog niet actief. Stel IMAP in via NOVA (klik op het mail-icoon rond de cirkel).",
    });
  }

  if (cfg) {
    try {
      const emails = await fetchImapInbox(cfg);
      const aandacht = (m) => {
        if (!m.unread) return false;
        const t = (m.subject + " " + m.snippet).toLowerCase();
        return /urgent|spoed|asap|belangrijk|factuur|herinnering|antwoord|reactie|reageer|deadline/.test(t);
      };
      return res.status(200).json({
        connected: true,
        provider: "imap",
        source: cfg.source,
        emails: emails.map((m) => ({ ...m, urgent: aandacht(m) })),
      });
    } catch (err) {
      console.error("IMAP fout:", err.message);
      return res.status(200).json({
        connected: true,
        provider: "imap",
        emails: [],
        error: "Kon mailbox niet bereiken: " + err.message,
      });
    }
  }

  return res.status(200).json({
    connected: true,
    provider: "gmail-or-outlook",
    emails: [],
    note: "Gmail/Outlook-koppeling herkend, maar nog niet geïmplementeerd.",
  });
}

// --- SETTINGS ---

async function handleSettings(req, res) {
  if (req.method === "GET") {
    const data = await readData(SETTINGS_KEY, null);
    if (!data) return res.status(200).json({ configured: false });
    // Geef wachtwoord NOOIT terug; alleen of het bestaat
    return res.status(200).json({
      configured: true,
      host: data.host || "",
      port: data.port || 993,
      user: data.user || "",
      passSet: !!data.pass,
      updated: data.updated || null,
    });
  }

  if (req.method === "POST") {
    const { host, port, user, pass } = req.body || {};
    if (!host || !user) {
      return res.status(400).json({ error: "Host en gebruiker zijn verplicht." });
    }
    const existing = (await readData(SETTINGS_KEY, null)) || {};
    const next = {
      host: String(host).trim(),
      port: Number(port) || 993,
      user: String(user).trim(),
      pass: pass && pass.length > 0 ? pass : existing.pass || "",
      updated: new Date().toISOString(),
    };
    if (!next.pass) {
      return res.status(400).json({ error: "Wachtwoord is verplicht bij eerste keer instellen." });
    }
    await writeData(SETTINGS_KEY, next);
    return res.status(200).json({ ok: true, configured: true, host: next.host, port: next.port, user: next.user, passSet: true, updated: next.updated });
  }

  if (req.method === "DELETE") {
    await writeData(SETTINGS_KEY, null);
    return res.status(200).json({ ok: true, configured: false });
  }

  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- SPRINT 1: EMAIL PIPELINE (classify + draft-reply) ---
// Sprint 1a: classify mails op categorie en intent in één Claude-call
// Sprint 1b: draft-reply genereert JnA-stijl conceptantwoord per mail

async function fetchSpecificMail(uid) {
  const cfg = await getImapConfig();
  if (!cfg) return null;
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  let mail = null;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(uid, { envelope: true, source: true, flags: true });
      if (msg) {
        let body = "";
        try {
          const parsed = await simpleParser(msg.source);
          body = (parsed.text || "").trim();
        } catch { /* */ }
        mail = {
          id: "mail-" + msg.uid,
          uid: msg.uid,
          from: msg.envelope.from?.[0]?.address || "",
          fromName: msg.envelope.from?.[0]?.name || "",
          subject: msg.envelope.subject || "",
          received: msg.envelope.date,
          body,
        };
      }
    } finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }
  return mail;
}

async function handleClassify(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Claude niet geconfigureerd" });

  // Pak laatste mails uit inbox - gebruik dezelfde IMAP-fetch
  const cfg = await getImapConfig();
  if (!cfg) return res.status(503).json({ error: "Mail niet gekoppeld" });

  // Hergebruik bestaande fetcher
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const mails = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = await client.mailboxOpen("INBOX");
      const limit = Math.min(20, mailbox.exists);
      const start = Math.max(1, mailbox.exists - limit + 1);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: true, flags: true })) {
        let snippet = "";
        try {
          const parsed = await simpleParser(msg.source);
          snippet = (parsed.text || "").trim().slice(0, 300);
        } catch { /* */ }
        mails.push({
          id: "mail-" + msg.uid,
          uid: msg.uid,
          from: msg.envelope.from?.[0]?.address || "",
          fromName: msg.envelope.from?.[0]?.name || "",
          subject: msg.envelope.subject || "",
          snippet,
          received: msg.envelope.date,
          unread: !msg.flags.has("\\Seen"),
        });
      }
    } finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }

  // Cache eerst: heeft mail-id al een classificatie?
  const cacheKey = "mail_classifications";
  const cached = (await readData(cacheKey)) || {};
  const teClassificeren = mails.filter((m) => !cached[m.id]);

  if (teClassificeren.length > 0) {
    // Eén Claude-call voor alle nieuwe mails - efficient en goedkoop
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client2 = new Anthropic({ apiKey });

    const prompt = `Hieronder staan ${teClassificeren.length} e-mails voor JnA Events (DJ-bedrijf, Tilburg). Classificeer elke mail op categorie EN intent.

CATEGORIE (kies één): lead, klant, leverancier, spam, urgent, overig
INTENT (kies één): vraag, offerte-verzoek, klacht, informatie, follow-up-nodig, geen-actie

Lever je antwoord terug als JSON-array met exact deze structuur, één object per mail in dezelfde volgorde:
[{"id": "mail-X", "category": "lead", "intent": "offerte-verzoek", "reden": "korte zin"}]

GEEN markdown, GEEN uitleg eromheen, ALLEEN de JSON.

Mails:
${teClassificeren.map((m, i) => `[${i + 1}] id=${m.id}\nVan: ${m.fromName || m.from} <${m.from}>\nOnderwerp: ${m.subject}\nSnippet: ${m.snippet || "(leeg)"}\n`).join("\n")}`;

    try {
      const response = await client2.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
      // Vind JSON-array in response
      const m = text.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        for (const p of parsed) {
          cached[p.id] = { category: p.category, intent: p.intent, reden: p.reden, when: Date.now() };
        }
        await writeData(cacheKey, cached);
      }
    } catch (err) {
      // Cache laten staan, niet fataal
      console.error("Classify mislukt:", err.message);
    }
  }

  // Geef mails terug met hun classificatie
  return res.status(200).json({
    mails: mails.map((m) => ({
      id: m.id,
      from: m.from,
      fromName: m.fromName,
      subject: m.subject,
      received: m.received,
      unread: m.unread,
      classification: cached[m.id] || null,
    })),
  });
}

async function handleDraftReply(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Claude niet geconfigureerd" });
  const mailId = req.query.id;
  if (!mailId) return res.status(400).json({ error: "id parameter vereist (bv. mail-123)" });
  const uid = mailId.replace(/^mail-/, "");

  // Haal de specifieke mail op
  const mail = await fetchSpecificMail(parseInt(uid));
  if (!mail) return res.status(404).json({ error: "Mail niet gevonden" });

  // Klantcontext uit Boeksy: heeft deze afzender al iets bij ons lopen?
  let boeksyContext = "";
  try {
    const overview = await readData("boeksy_overview_cache");
    if (overview && overview.relations) {
      const klant = overview.relations.find((r) => r.email && r.email.toLowerCase() === mail.from.toLowerCase());
      if (klant) {
        boeksyContext += `\n\nKLANT-CONTEXT UIT BOEKSY: ${klant.name} is een bekende relatie (${klant.type || "klant"}).`;
        const klantFacturen = (overview.invoices || []).filter((i) => i.relation === klant.name);
        const klantOffertes = (overview.quotes || []).filter((q) => q.relation === klant.name);
        if (klantFacturen.length) {
          boeksyContext += ` Eerder gefactureerd: ${klantFacturen.length} factu(u)r(en).`;
        }
        if (klantOffertes.length) {
          const open = klantOffertes.filter((q) => !((q.status || "").toLowerCase().match(/accepted|paid|geaccepteerd|voldaan|rejected/)));
          if (open.length) boeksyContext += ` ${open.length} open offerte(s).`;
        }
      }
    }
  } catch { /* klant-context is bonus, niet kritiek */ }

  // JnA tone-of-voice uit snippets
  let toneSnippet = "";
  try {
    const snippets = (await readData("doc_snippets")) || [];
    const tone = snippets.find((s) => /tone|toon|stijl/i.test(s.label));
    if (tone) toneSnippet = `\n\nJnA TONE-OF-VOICE (uit eigen instellingen): ${tone.value}`;
  } catch { /* */ }

  // CATEGORIE-SPECIFIEKE STIJL.
  // De classify-stap heeft eerder bepaald in welke categorie deze mail valt.
  // We halen die uit Redis-cache zodat de draft een passende toon krijgt.
  let categorie = "overig";
  let intent = "vraag";
  try {
    const classifications = (await readData("mail_classifications")) || {};
    const cls = classifications[mailId];
    if (cls) {
      categorie = cls.category || "overig";
      intent = cls.intent || "vraag";
    }
  } catch { /* niet fataal */ }

  // Per categorie een specifieke stijl-instructie.
  // Lead = enthousiast en vraagt door. Klant = persoonlijk met geschiedenis.
  // Leverancier = zakelijk en kort. Klacht = de-escalatie. Urgent = direct.
  const stijlPerCategorie = {
    lead: `STIJL: enthousiast en uitnodigend. Dit is een potentiële nieuwe klant - bedank ze voor de aanvraag, toon interesse in hun event. Vraag door naar datum, locatie, type event, geschatte aantal gasten. Sluit af met een suggestie voor een kort kennismakingsgesprek of het opstellen van een passende offerte.`,
    klant: `STIJL: warm en persoonlijk - dit is een bekende klant. Verwijs naar de klantgeschiedenis als die er is (eerder gefactureerd, lopende offertes). Hou het gemakkelijk en informeel, alsof je elkaar al kent.`,
    leverancier: `STIJL: zakelijk, kort en functioneel. Geen smalltalk - meteen ter zake. Bedank kort, behandel het punt, sluit af.`,
    urgent: `STIJL: direct en duidelijk - dit is urgent. Geen omhaal, geen langdradigheid. Erken urgentie, geef concrete actie of antwoord. Korte zinnen.`,
    overig: `STIJL: spreektaal, persoonlijk, warm maar professioneel.`,
    spam: `STIJL: dit is mogelijk spam. Schrijf alleen een kort beleefd antwoord als de inhoud legitiem lijkt. Anders adviseer GEEN reactie te sturen.`,
  };

  // Intent-specifieke aanvullingen
  const intentInstructies = {
    "offerte-verzoek": `Vraag specifiek door naar: gewenste datum, locatie, type event (bruiloft/bedrijfsfeest/verjaardag/etc.), geschatte aantal gasten, eventuele specifieke wensen voor muziek of licht. GEEN prijzen noemen - die volgen in een formele offerte via Boeksy.`,
    "klacht": `Erken het probleem direct in de eerste zin zonder excuses te bagatelliseren. Toon begrip. Bied een concrete oplossing of vervolgstap. Vermijd defensieve taal. Niet "ja maar" - wel "dat had niet mogen gebeuren, ik ga dit oplossen door...".`,
    "follow-up-nodig": `Dit is een follow-up situatie. Schrijf een nette, niet-opdringerige check-in die de klant uitnodigt om verder te gaan zonder druk te leggen.`,
    "vraag": `Beantwoord de vraag concreet. Als je het antwoord niet kunt geven, zeg dat eerlijk en bied aan om het uit te zoeken.`,
    "informatie": `De klant deelt informatie en verwacht waarschijnlijk een korte bevestiging. Bevestig dat je het hebt ontvangen en verwerkt.`,
    "geen-actie": `Deze mail vereist geen reactie. Schrijf alleen een concept als de gebruiker er expliciet om vraagt - anders kun je beter een leeg antwoord teruggeven.`,
  };

  const stijl = stijlPerCategorie[categorie] || stijlPerCategorie.overig;
  const intentExtra = intentInstructies[intent] || "";

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const claude = new Anthropic({ apiKey });

  const prompt = `Schrijf een conceptantwoord op deze e-mail voor JnA Events (DJ-bedrijf in Tilburg, eigenaar Jordi).

CATEGORIE: ${categorie}. INTENT: ${intent}.

${stijl}

${intentExtra}

ALGEMENE REGELS: spreektaal, geen "geachte heer/mevrouw", begin met "Hoi [voornaam]" of "Hi [voornaam]" als de naam bekend is. Geen overdreven marketingtaal. Geen markdown of sterretjes.${toneSnippet}

LENGTE: 4-6 zinnen voor reguliere mails, 2-3 voor urgent of leverancier.

INKOMENDE MAIL:
Van: ${mail.fromName || mail.from} <${mail.from}>
Onderwerp: ${mail.subject}
Bericht: ${mail.body || mail.snippet || "(leeg)"}${boeksyContext}

Lever terug in dit exacte formaat:
Onderwerp: [onderwerp hier]
Bericht: [bericht hier]

Sluit het bericht af met "Groet, Jordi".`;

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();

    // Parse onderwerp + bericht
    const ondMatch = text.match(/Onderwerp:\s*(.+?)(?:\n|$)/i);
    const berMatch = text.match(/Bericht:\s*([\s\S]+?)(?:Groet,|\nGroet|$)/i);
    const subject = ondMatch ? ondMatch[1].trim() : `Re: ${mail.subject}`;
    let body = berMatch ? berMatch[1].trim() : text;
    // Voeg afsluiting toe als die ontbreekt
    if (!/groet,?\s*jordi/i.test(body)) body += "\n\nGroet,\nJordi";

    return res.status(200).json({
      to: mail.from,
      toName: mail.fromName,
      subject,
      body,
      originalSubject: mail.subject,
    });
  } catch (err) {
    return res.status(500).json({ error: "Concept-opstelling mislukt: " + err.message });
  }
}


// Verstuurt mail via dezelfde provider als IMAP (meestal). Verwacht:
//   - SMTP_HOST en SMTP_PORT in env (vaak respectievelijk imap-host met poort 465 of 587)
//   - of: gebruikt IMAP_HOST/USER/PASS met een raden van SMTP-host (host vervangen 'imap' door 'smtp')
async function getSmtpConfig() {
  // Eerste keus: expliciete SMTP env vars
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) !== 587, // 465 = secure, 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
    };
  }
  // Tweede keus: IMAP-credentials hergebruiken (vaak dezelfde server)
  const imap = await getImapConfig();
  if (imap) {
    const smtpHost = imap.host.replace(/^imap\./, "smtp.");
    return {
      host: smtpHost,
      port: 465,
      secure: true,
      auth: { user: imap.user, pass: imap.pass },
      from: imap.user,
    };
  }
  return null;
}

async function handleSend(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST vereist" });
  const cfg = await getSmtpConfig();
  if (!cfg) return res.status(503).json({ error: "SMTP niet geconfigureerd. Voeg SMTP_HOST/SMTP_USER/SMTP_PASS toe in Vercel, of gebruik IMAP-credentials als die ook voor SMTP werken." });

  const { to, subject, body, cc, bcc, replyTo } = req.body || {};
  if (!to || !subject || !body) return res.status(400).json({ error: "to, subject en body zijn verplicht" });

  // Veiligheid: voorkom dat NOVA per ongeluk spam-doelen aanvalt
  // Maximum 5 ontvangers per call.
  const toList = Array.isArray(to) ? to : [to];
  if (toList.length > 5) return res.status(400).json({ error: "Maximaal 5 ontvangers per mail" });

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    });

    // Verbinding eerst testen om gerichte foutmelding terug te geven
    await transporter.verify();

    const info = await transporter.sendMail({
      from: cfg.from,
      to: toList.join(", "),
      cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc) : undefined,
      replyTo,
      subject,
      text: body,
      html: body.includes("<") ? body : body.replace(/\n/g, "<br>"),
    });

    return res.status(200).json({
      ok: true,
      messageId: info.messageId,
      to: toList,
      subject,
    });
  } catch (err) {
    return res.status(500).json({ error: "Versturen mislukt: " + (err.message || "onbekend") });
  }
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    const action = req.query.action || "inbox";
    if (action === "inbox") return await handleInbox(req, res);
    if (action === "settings") return await handleSettings(req, res);
    if (action === "send") return await handleSend(req, res);
    if (action === "classify") return await handleClassify(req, res);
    if (action === "draft-reply") return await handleDraftReply(req, res);
    return res.status(400).json({ error: "Onbekende action. Gebruik ?action=inbox, settings, send, classify of draft-reply." });
  } catch (err) {
    console.error("Mail fout:", err.message);
    return res.status(500).json({ error: "Mail-fout: " + err.message });
  }
}
