import { verifyToken } from "./_auth.js";
import { CONFIG, readData, writeData } from "./_config.js";

// Samengevoegde WhatsApp-functie.
//
// Routes op basis van ?action= parameter:
//   ?action=send     - bericht versturen (vereist login)
//   ?action=webhook  - inkomend bericht ontvangen van provider (geen login, wel secret)
//   ?action=inbox    - ontvangen berichten ophalen (vereist login)
//
// We bundelen drie functies in één om binnen Vercel's 12-functie-limiet
// op het Hobby-plan te blijven.

const INBOX_KEY = "nova_whatsapp_inbox";

// --- VERSTUREN ---

async function sendViaTwilio(to, body) {
  const sid = process.env.TWILIO_SID;
  const tok = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
  const form = new URLSearchParams({
    From: from,
    To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
    Body: body,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Twilio: " + err.slice(0, 200));
  }
  return await res.json();
}

async function sendVia360dialog(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const url = "https://waba-v2.360dialog.io/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { "D360-API-KEY": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("360dialog: " + err.slice(0, 200));
  }
  return await res.json();
}

async function handleSend(req, res) {
  // Login vereist
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  const provider = CONFIG.whatsappProvider();
  if (!provider) {
    return res.status(503).json({
      error: "WhatsApp nog niet gekoppeld",
      hint: "Voeg Twilio- of 360dialog-sleutels toe in Vercel. Zie de Setup-checklist.",
      connected: false,
    });
  }

  try {
    const { to, message } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: "to en message zijn verplicht" });
    const result = provider === "twilio" ? await sendViaTwilio(to, message) : await sendVia360dialog(to, message);
    return res.status(200).json({ ok: true, provider, result });
  } catch (err) {
    console.error("WhatsApp verstuurfout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// --- WEBHOOK (inkomende berichten van provider) ---

function parseTwilio(body) {
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

async function handleWebhook(req, res) {
  // Geen login - providers moeten kunnen posten. Beveiligd via WHATSAPP_WEBHOOK_SECRET in URL.
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

// --- INBOX (ontvangen berichten lezen) ---

async function handleInbox(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      const items = await readData(INBOX_KEY, []);
      return res.status(200).json({ items });
    }
    if (req.method === "POST") {
      const { id } = req.body || {};
      const list = await readData(INBOX_KEY, []);
      const next = list.map((m) => (m.id === id ? { ...m, read: true } : m));
      await writeData(INBOX_KEY, next);
      return res.status(200).json({ items: next });
    }
    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    return res.status(500).json({ error: "Kon WhatsApp-inbox niet lezen" });
  }
}

// --- ROUTER ---

export default async function handler(req, res) {
  const action = req.query.action || "";
  if (action === "send") return handleSend(req, res);
  if (action === "webhook") return handleWebhook(req, res);
  if (action === "inbox") return handleInbox(req, res);
  return res.status(400).json({ error: "Onbekende action. Gebruik ?action=send, webhook, of inbox." });
}
