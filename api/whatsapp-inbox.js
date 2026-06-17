import { verifyToken } from "./_auth.js";
import { readData, writeData } from "./_config.js";

// Leest de WhatsApp-inbox die door whatsapp-webhook.js wordt gevuld.
// Gebruikt door NOVA bij login om te zien of er nieuwe berichten zijn.

const INBOX_KEY = "nova_whatsapp_inbox";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      const items = await readData(INBOX_KEY, []);
      return res.status(200).json({ items });
    }
    if (req.method === "POST") {
      // Markeer als gelezen
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
