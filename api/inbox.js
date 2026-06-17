import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// Inbox-overzicht voor de welkomstbriefing en handmatige checks.
//
// Werkt automatisch zodra IMAP gekoppeld is via:
//   IMAP_HOST  (bijv. mail.jna-events.nl of imap.gmail.com)
//   IMAP_PORT  (optioneel, standaard 993)
//   IMAP_USER  (mailadres)
//   IMAP_PASS  (app-wachtwoord, NIET je gewone wachtwoord)
//
// We halen de laatste 20 berichten op. NOVA bepaalt zelf welke aandacht vragen
// (op basis van afzender, onderwerp en inhoud).

async function fetchImapInbox() {
  // Dynamische import zodat de bundle klein blijft als IMAP niet gebruikt wordt.
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
  });

  const messages = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Laatste 20 berichten ophalen
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

  const connected = CONFIG.hasMailConnection();

  if (!connected) {
    return res.status(200).json({
      connected: false,
      emails: [],
      note: "Mailkoppeling nog niet actief. Zet IMAP_HOST, IMAP_USER en IMAP_PASS in Vercel, of koppel Gmail/Outlook.",
    });
  }

  // IMAP heeft prioriteit als die is gezet (werkt voor info@jna-events.nl)
  if (CONFIG.hasIMAP()) {
    try {
      const emails = await fetchImapInbox();
      // Eenvoudige aandacht-detectie: ongelezen + bevat trefwoorden
      const aandacht = (m) => {
        if (!m.unread) return false;
        const t = (m.subject + " " + m.snippet).toLowerCase();
        return /urgent|spoed|asap|belangrijk|factuur|herinnering|antwoord|reactie|reageer|deadline/.test(t);
      };
      return res.status(200).json({
        connected: true,
        provider: "imap",
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

  // Plek voor Gmail/Outlook API zodra die gekoppeld zijn.
  return res.status(200).json({
    connected: true,
    provider: "gmail-or-outlook",
    emails: [],
    note: "Gmail/Outlook-koppeling herkend, maar nog niet geïmplementeerd. IMAP werkt nu wel.",
  });
}
