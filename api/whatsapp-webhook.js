import { readData, writeData, KEYS } from "./_config.js";

// Webhook voor inkomende WhatsApp-berichten.
//
// LET OP: dit endpoint is publiek (geen token), want providers moeten erbij kunnen.
// Beveiliging via een gedeelde geheime sleutel in de URL: WHATSAPP_WEBHOOK_SECRET.
// Stel hem in Vercel in en gebruik dezelfde waarde in de webhook-URL bij je provider:
//   https://agent.jna-events.nl/api/whatsapp-webhook?secret=DE_GEHEIME_WAARDE
//
// Twilio stuurt form-data, 360dialog stuurt JSON. We herkennen beide.
// Berichten worden opgeslagen in de inbox-lijst die NOVA bij login leest.

const INBOX_KEY = "nova_whatsapp_inbox";

function parseTwilio(body) {
  // Twilio levert x-www-form-urlencoded: From=whatsapp:+31..., Body=..., ...
  if (typeof body !== "object" || !body) return null;
  if (!body.From || !body.Body) return null;
  return {
    from: String(body.From).replace(/^whatsapp:/, ""),
    text: String(body.Body),
    name: body.ProfileName || null,
  };
}

function parse360(body) {
  try {
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
    if (!msg) return null;
    return {
      from: msg.from,
      text: msg.text?.body || "",
      name: contact?.profile?.name || null,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  // Verify ownership voor 360dialog (GET hub.challenge)
  if (req.method === "GET") {
    const challenge = req.query["hub.challenge"];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Methode niet toegestaan" });

  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (expected && req.query.secret !== expected) {
    return res.status(403).json({ error: "Ongeldig secret" });
  }

  const parsed = parseTwilio(req.body) || parse360(req.body);
  if (!parsed) return res.status(200).json({ ignored: true });

  try {
    const inbox = await readData(INBOX_KEY, []);
    const item = {
      id: "wa-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      from: parsed.from,
      name: parsed.name,
      text: parsed.text,
      received: new Date().toISOString(),
      read: false,
    };
    const next = [item, ...inbox].slice(0, 100);
    await writeData(INBOX_KEY, next);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook fout:", err.message);
    return res.status(500).json({ error: "Kon bericht niet opslaan" });
  }
}
