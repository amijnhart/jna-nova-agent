import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// WhatsApp-aansluitpunt voor het versturen van berichten.
//
// Werkt automatisch met de provider die jij hebt gekoppeld:
//   - Twilio:    TWILIO_SID + TWILIO_TOKEN + TWILIO_FROM (bijv. "whatsapp:+14155...")
//   - 360dialog: WHATSAPP_TOKEN + WHATSAPP_PHONE_ID
//
// Zolang geen van beide gezet is, geeft dit endpoint een nette melding terug
// in plaats van te doen alsof er iets verstuurd is.

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

export default async function handler(req, res) {
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
