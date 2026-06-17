import { verifyToken } from "./_auth.js";
import { CONFIG, readData } from "./_config.js";

// Inbox-overzicht voor de welkomstbriefing en handmatige checks.
//
// IMAP-instellingen worden in deze volgorde gezocht:
//   1. Via /api/imap-settings opgeslagen waarden (in Vercel KV) - voorkeur
//   2. Environment variables (IMAP_HOST/IMAP_USER/IMAP_PASS) - fallback
//
// We halen de laatste 20 berichten op. NOVA bepaalt zelf welke aandacht vragen.

const SETTINGS_KEY = "nova_imap_settings";

async function getImapConfig() {
  // Eerst KV
  const stored = await readData(SETTINGS_KEY, null);
  if (stored && stored.host && stored.user && stored.pass) {
    return { host: stored.host, port: stored.port || 993, user: stored.user, pass: stored.pass, source: "app" };
  }
  // Anders env-variables
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

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  const cfg = await getImapConfig();
  const gmailOutlookOnly = CONFIG.hasMailConnection() && !cfg;

  if (!cfg && !gmailOutlookOnly) {
    return res.status(200).json({
      connected: false,
      emails: [],
      note: "Mailkoppeling nog niet actief. Stel IMAP in via NOVA (zoek Setup of E-mail in de app), of zet de env-variabelen in Vercel.",
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
