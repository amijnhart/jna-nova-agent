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

// --- ROUTER ---

// --- SEND (SMTP via nodemailer) ---
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
    return res.status(400).json({ error: "Onbekende action. Gebruik ?action=inbox, settings of send." });
  } catch (err) {
    console.error("Mail fout:", err.message);
    return res.status(500).json({ error: "Mail-fout: " + err.message });
  }
}
