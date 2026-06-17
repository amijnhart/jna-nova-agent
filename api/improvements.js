import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS } from "./_config.js";

// Verbeterlijst. Opslag-logica zit in _config.js zodat hij overal hetzelfde werkt.

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ items: await readData(KEYS.improvements, []) });
    }
    if (req.method === "POST") {
      const { text, source } = req.body || {};
      if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Lege verbeterpunt" });
      const list = await readData(KEYS.improvements, []);
      if (list.some((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase())) {
        return res.status(200).json({ items: list, duplicate: true });
      }
      const item = {
        id: "imp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        text: text.trim(),
        source: source || "nova",
        date: new Date().toISOString(),
      };
      const next = [item, ...list].slice(0, 200);
      await writeData(KEYS.improvements, next);
      return res.status(200).json({ items: next });
    }
    if (req.method === "DELETE") {
      const { id, all } = req.body || {};
      let list = await readData(KEYS.improvements, []);
      list = all ? [] : list.filter((i) => i.id !== id);
      await writeData(KEYS.improvements, list);
      return res.status(200).json({ items: list });
    }
    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Verbeterlijst fout:", err.message);
    return res.status(500).json({ error: "Kon verbeterlijst niet verwerken" });
  }
}
