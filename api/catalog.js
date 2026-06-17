import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS } from "./_config.js";

// Productcatalogus van JnA Events. Opslag via _config.js.

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ items: await readData(KEYS.catalog, []) });
    }
    if (req.method === "POST") {
      const { name, category, description } = req.body || {};
      if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Naam ontbreekt" });
      const list = await readData(KEYS.catalog, []);
      const item = {
        id: "prod-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name: name.trim(),
        category: (category || "").trim(),
        description: (description || "").trim(),
        date: new Date().toISOString(),
      };
      const next = [item, ...list].slice(0, 500);
      await writeData(KEYS.catalog, next);
      return res.status(200).json({ items: next });
    }
    if (req.method === "DELETE") {
      const { id, all } = req.body || {};
      let list = await readData(KEYS.catalog, []);
      list = all ? [] : list.filter((i) => i.id !== id);
      await writeData(KEYS.catalog, list);
      return res.status(200).json({ items: list });
    }
    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Catalogus fout:", err.message);
    return res.status(500).json({ error: "Kon catalogus niet verwerken" });
  }
}
