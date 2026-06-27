import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS, CONFIG, listAllKeys } from "./_config.js";

// Onboarding & status & backup in één functie.
//
// Routes:
//   ?action=status   - GET: complete wizard (stappen + live status van integraties)
//                      POST: stap afvinken/uitvinken
//   ?action=backup   - GET: download alle KV-data als JSON
//                      POST: upload JSON om data terug te zetten
//
// De wizard is opgezet als ÉÉN doorlopende setup-flow, niet meer als losse
// blokken per integratie. Stappen lopen logisch achter elkaar van basisinstellingen
// naar koppelingen. Per integratie geeft NOVA aan of hij actief is dankzij live
// detectie - geen handmatig afvinken nodig voor "is mail gekoppeld".

// Eén lineaire wizard: van basis (verplicht) naar koppelingen (optioneel).
// Elke stap weet zelf of hij 'auto-detecteerd' wordt (gebruiker hoeft niets
// af te vinken) of 'handmatig' (gebruiker moet bevestigen).
const WIZARD = [
  {
    id: "basis",
    title: "Basisinstellingen",
    intent: "Eerst zorgen dat NOVA überhaupt draait.",
    steps: [
      { id: "basis-1", title: "Wachtwoord ingesteld (NOVA_PASSWORD)", auto: () => true, // als je leest kun je inloggen
        help: "Het wachtwoord waarmee je in NOVA komt staat veilig in Vercel." },
      { id: "basis-2", title: "AI-brein actief (ANTHROPIC_API_KEY)", auto: () => !!CONFIG.anthropicKey(),
        help: "NOVA gebruikt deze sleutel om met Claude te praten. Zonder kan ze niet antwoorden." },
    ],
  },
  {
    id: "email",
    title: "E-mail koppeling",
    intent: "NOVA leest je inbox en signaleert urgente mails.",
    steps: [
      { id: "email-1", title: "Mailbox-gegevens ingevoerd in NOVA",
        autoAsync: async () => {
          const s = await readData(KEYS.imapSettings, null);
          return !!(s && s.host && s.user && s.pass);
        },
        help: "Klik op het 📧-icoon rond de cirkel. NOVA herkent automatisch je provider en vraagt alleen om mailadres en app-wachtwoord." },
      { id: "email-2", title: "App-wachtwoord gebruikt (niet je gewone wachtwoord)", manual: true,
        help: "Voor Hostinger: maak een nieuw wachtwoord aan via hPanel. Voor Gmail: maak een app-wachtwoord aan op myaccount.google.com onder Beveiliging." },
      { id: "email-3", title: "Test: NOVA leest mailbox bij inloggen", manual: true,
        help: "Log uit en weer in. NOVA noemt je laatste mails in de begroeting als de koppeling werkt." },
    ],
  },
  {
    id: "whatsapp",
    title: "WhatsApp Business",
    intent: "Berichten ontvangen en versturen via WhatsApp.",
    steps: [
      { id: "wa-1", title: "WhatsApp Business account aangemaakt", manual: true,
        help: "Ga naar business.whatsapp.com en maak een zakelijk account aan met een nummer dat NOG NIET in de gewone WhatsApp gebruikt wordt." },
      { id: "wa-2", title: "Provider gekozen en account aangemaakt", manual: true,
        help: "Twilio (eenvoudiger) of 360dialog (goedkoper). Maak een account, activeer WhatsApp Sender." },
      { id: "wa-3", title: "Sender goedgekeurd door Meta", manual: true,
        help: "Meta keurt elke afzender handmatig goed. Duurt meestal 1-3 dagen." },
      { id: "wa-4", title: "WhatsApp actief in NOVA",
        auto: () => CONFIG.hasWhatsApp(),
        help: "Zet de sleutels in Vercel: TWILIO_SID + TWILIO_TOKEN + TWILIO_FROM, of WHATSAPP_TOKEN + WHATSAPP_PHONE_ID. Daarna deploy zonder build-cache." },
    ],
  },
  {
    id: "social",
    title: "Social Media (TikTok, Instagram, Facebook)",
    intent: "Content automatisch laten plaatsen op je social-kanalen.",
    steps: [
      { id: "soc-1", title: "TikTok Business actief", auto: () => CONFIG.hasTikTok(),
        help: "Persoonlijk TikTok-account omzetten naar Business. Daarna in TikTok for Business Developer Portal een app aanmaken voor agent.jna-events.nl en TIKTOK_TOKEN in Vercel zetten." },
      { id: "soc-2", title: "Instagram & Facebook actief", auto: () => CONFIG.hasMeta(),
        help: "Facebook-pagina aanmaken, Instagram-zakelijk koppelen, Meta Developer App aanvragen met permissies instagram_content_publish + pages_show_list, daarna META_ACCESS_TOKEN in Vercel zetten." },
    ],
  },
  {
    id: "ai-beeld",
    title: "AI-beeldgeneratie",
    intent: "NOVA genereert beelden voor je content via OpenAI.",
    steps: [
      { id: "img-1", title: "OpenAI sleutel actief", auto: () => CONFIG.hasImageGen(),
        help: "Maak een account op platform.openai.com, zet OPENAI_API_KEY in Vercel. ~10 cent per beeld." },
    ],
  },
];

// Voor elke stap: bepaal of hij voltooid is.
async function resolveSteps(progress) {
  const result = [];
  for (const block of WIZARD) {
    const steps = [];
    for (const s of block.steps) {
      let done = false;
      if (s.auto) done = !!s.auto();
      else if (s.autoAsync) done = !!(await s.autoAsync());
      else if (s.manual) done = progress.includes(s.id);
      steps.push({ id: s.id, title: s.title, help: s.help, done, auto: !!(s.auto || s.autoAsync) });
    }
    const doneCount = steps.filter((x) => x.done).length;
    result.push({
      key: block.id,
      title: block.title,
      intent: block.intent,
      steps,
      done: doneCount,
      total: steps.length,
      complete: doneCount === steps.length,
    });
  }
  return result;
}

// Snelle live-status van integraties (zonder volledige wizard te bouwen).
async function liveIntegrationStatus() {
  const imapStored = await readData(KEYS.imapSettings, null);
  return {
    ai: !!CONFIG.anthropicKey(),
    email: CONFIG.hasMailConnection() || !!(imapStored && imapStored.host && imapStored.pass),
    whatsapp: CONFIG.hasWhatsApp(),
    tiktok: CONFIG.hasTikTok(),
    meta: CONFIG.hasMeta(),
    imageGen: CONFIG.hasImageGen(),
  };
}

// --- BACKUP / RESTORE ---

async function handleBackup(req, res) {
  if (req.method === "GET") {
    // Exporteer alle KV-data als JSON
    const keys = await listAllKeys();
    const data = {};
    for (const k of keys) {
      data[k] = await readData(k, null);
    }
    return res.status(200).json({
      exported: new Date().toISOString(),
      keys: keys.length,
      data,
    });
  }
  if (req.method === "POST") {
    // Zet backup terug
    const { data } = req.body || {};
    if (!data || typeof data !== "object") return res.status(400).json({ error: "Geen geldige backup-data." });
    let restored = 0;
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        await writeData(key, value);
        restored++;
      }
    }
    return res.status(200).json({ restored, restoredAt: new Date().toISOString() });
  }
  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- STATUS / WIZARD ---

async function handleStatus(req, res) {
  if (req.method === "GET") {
    const progress = await readData(KEYS.onboarding, []);
    const items = await resolveSteps(progress);
    const integrations = await liveIntegrationStatus();
    return res.status(200).json({ items, integrations });
  }
  if (req.method === "POST") {
    const { stepId, done } = req.body || {};
    if (typeof stepId !== "string") return res.status(400).json({ error: "stepId ontbreekt" });
    let progress = await readData(KEYS.onboarding, []);
    if (done) { if (!progress.includes(stepId)) progress = [...progress, stepId]; }
    else { progress = progress.filter((s) => s !== stepId); }
    await writeData(KEYS.onboarding, progress);
    const items = await resolveSteps(progress);
    const integrations = await liveIntegrationStatus();
    return res.status(200).json({ items, integrations });
  }
  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- DAILY BRAIN ---
// Verzamelt 's ochtends data en bouwt een briefing voor de dag.
// Wordt getriggerd door:
//   - Vercel Cron (zonder auth - we detecteren via x-vercel-cron header)
//   - Frontend bij login (met auth - om laatste briefing te tonen)
//
// Briefing wordt in Redis opgeslagen onder daily_brief_YYYY-MM-DD.
async function handleDailyBrain(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];

  // GET zonder cron-header: alleen tonen wat er al staat (frontend bij login)
  // GET met cron-header: nieuwe briefing genereren (cron triggert dit)
  // POST: handmatig forceren van nieuwe briefing
  const moetGenereren = req.method === "POST" || (req.method === "GET" && isCron);

  if (req.method === "GET" && !isCron) {
    const today = new Date().toISOString().slice(0, 10);
    const brief = await readData("daily_brief_" + today, null);
    return res.status(200).json({ date: today, brief });
  }

  if (moetGenereren) {
    const brief = {
      generated: new Date().toISOString(),
      items: [],
    };

    // 1. Open offertes (followUps uit Boeksy-cache) - oudste 3
    try {
      const overview = await readData("boeksy_overview_cache", null);
      if (overview && Array.isArray(overview.followUps)) {
        const top3 = overview.followUps.slice(0, 3);
        for (const f of top3) {
          brief.items.push({
            type: "offerte",
            urgency: f.ageDays > 30 ? "hoog" : "midden",
            tekst: `De offerte voor ${f.klant || "onbekende klant"}${f.subject ? " (" + f.subject + ")" : ""} staat al ${f.ageDays} dagen open.`,
            action: "follow-up mail concept opstellen",
            ref: f.number,
          });
        }
      }
    } catch { /* niet fataal */ }

    // 2. Achterstallige facturen (uit financials.deadlines)
    try {
      const overview = await readData("boeksy_overview_cache", null);
      if (overview && overview.financials?.deadlines?.achterstalligeFacturen > 0) {
        brief.items.push({
          type: "factuur",
          urgency: "hoog",
          tekst: `${overview.financials.deadlines.achterstalligeFacturen} factu(u)r(en) achterstallig.`,
          action: "betaalherinnering sturen",
        });
      }
    } catch { /* */ }

    // 3. BTW-deadline naderend
    try {
      const overview = await readData("boeksy_overview_cache", null);
      const dagen = overview?.financials?.deadlines?.btwDagenRest;
      if (typeof dagen === "number" && dagen <= 14 && dagen > 0) {
        brief.items.push({
          type: "btw",
          urgency: dagen <= 7 ? "hoog" : "midden",
          tekst: `BTW-aangifte ${overview.financials.deadlines.btwPeriodLabel || ""} loopt af over ${dagen} dagen.`,
          action: "aangifte voorbereiden",
        });
      }
    } catch { /* */ }

    // 4. Events deze week (uit Boeksy events of zelf-geplande content)
    try {
      const overview = await readData("boeksy_overview_cache", null);
      if (overview && Array.isArray(overview.events)) {
        const nu = Date.now();
        const week = nu + 7 * 24 * 60 * 60 * 1000;
        const dezeWeek = overview.events.filter((e) => {
          const ms = new Date(e.date).getTime();
          return ms >= nu && ms <= week;
        });
        if (dezeWeek.length > 0) {
          brief.items.push({
            type: "events",
            urgency: "midden",
            tekst: `${dezeWeek.length} event${dezeWeek.length === 1 ? "" : "s"} deze week: ${dezeWeek.map((e) => e.klant + (e.subject ? " (" + e.subject + ")" : "")).join(", ")}.`,
            action: "content-plan controleren",
          });
        }
      }
    } catch { /* */ }

    // 5. Urgent ongelezen mails (uit mail-classifications-cache)
    try {
      const cls = await readData("mail_classifications", {});
      const urgentCount = Object.values(cls).filter((c) => c.category === "urgent" || c.intent === "klacht").length;
      if (urgentCount > 0) {
        brief.items.push({
          type: "mail",
          urgency: "hoog",
          tekst: `${urgentCount} mail${urgentCount === 1 ? "" : "s"} geclassificeerd als urgent of klacht.`,
          action: "mail-inbox openen voor reactie",
        });
      }
    } catch { /* */ }

    // 6. Open verbeterpunten - alleen aantal voor situational awareness
    try {
      const imps = await readData(KEYS.improvements, []);
      const open = imps.filter((i) => (i.status || "open") === "open");
      if (open.length >= 5) {
        brief.items.push({
          type: "verbeteringen",
          urgency: "laag",
          tekst: `${open.length} verbeterpunten verzameld, tijd om er een paar door te lopen.`,
          action: "verbeterpunten openen",
        });
      }
    } catch { /* */ }

    // Sorteer op urgency: hoog eerst
    const urgencyOrder = { hoog: 0, midden: 1, laag: 2 };
    brief.items.sort((a, b) => (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3));

    // Opslaan
    const today = new Date().toISOString().slice(0, 10);
    await writeData("daily_brief_" + today, brief);
    // Houd ook een korte historie bij voor week-overzicht
    const historyKey = "daily_brief_history";
    const history = await readData(historyKey, []);
    const today_short = { date: today, itemCount: brief.items.length, urgent: brief.items.filter((i) => i.urgency === "hoog").length };
    const filtered = history.filter((h) => h.date !== today);
    filtered.unshift(today_short);
    await writeData(historyKey, filtered.slice(0, 30));

    return res.status(200).json({ ok: true, date: today, brief });
  }

  return res.status(405).json({ error: "Methode niet toegestaan" });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  // Cron-triggers van Vercel sturen geen Bearer-token maar wel deze header.
  // Voor security checken we de aanwezigheid van de header EN het pad.
  const isCron = !!req.headers["x-vercel-cron"];

  // Daily-brain mag worden getriggerd door cron OF door geauthenticeerde gebruiker
  if (req.query.action === "daily-brain") {
    if (!isCron && !verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });
    return await handleDailyBrain(req, res);
  }

  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    const action = req.query.action || "status";
    if (action === "status") return await handleStatus(req, res);
    if (action === "backup") return await handleBackup(req, res);
    return res.status(400).json({ error: "Onbekende action. Gebruik ?action=status, backup of daily-brain." });
  } catch (err) {
    console.error("Onboarding fout:", err.message);
    return res.status(500).json({ error: "Onboarding-fout: " + err.message });
  }
}
