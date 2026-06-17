import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS } from "./_config.js";

// Contentkalender. Opslag via _config.js.

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      const list = await readData(KEYS.calendar, []);
      list.sort((a, b) => new Date(a.when) - new Date(b.when));
      return res.status(200).json({ items: list });
    }
    if (req.method === "POST") {
      const { title, channel, when, body } = req.body || {};
      if (typeof title !== "string" || !title.trim() || !when) return res.status(400).json({ error: "Titel of tijdstip ontbreekt" });
      const list = await readData(KEYS.calendar, []);
      const item = {
        id: "post-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        title: title.trim(),
        channel: (channel || "social").trim(),
        when,
        body: (body || "").trim(),
        status: "gepland",
        created: new Date().toISOString(),
      };
      const next = [...list, item];
      await writeData(KEYS.calendar, next);
      return res.status(200).json({ items: next });
    }
    if (req.method === "DELETE") {
      const { id, all } = req.body || {};
      let list = await readData(KEYS.calendar, []);
      list = all ? [] : list.filter((i) => i.id !== id);
      await writeData(KEYS.calendar, list);
      return res.status(200).json({ items: list });
    }
    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Kalender fout:", err.message);
    return res.status(500).json({ error: "Kon kalender niet verwerken" });
  }
}
