import { verifyToken } from "./_auth.js";

// Verbeterlijst-opslag. Gebruikt Vercel KV (blijvende opslag) als die gekoppeld is.
// Zonder KV valt het terug op een tijdelijke opslag in het geheugen, zodat het
// lokaal en zonder database toch werkt (maar dan niet blijvend).
//
// KV koppelen (gratis): Vercel project > Storage > Create > KV > Connect.
// Daarna zijn KV_REST_API_URL en KV_REST_API_TOKEN automatisch beschikbaar.

const KEY = "nova_improvements";
let memoryStore = []; // fallback wanneer er geen KV is

function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet() {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json();
  if (!data || !data.result) return [];
  try { return JSON.parse(data.result); } catch { return []; }
}

async function kvSet(list) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(list)),
  });
}

async function readList() {
  if (hasKV()) { try { return await kvGet(); } catch { return memoryStore; } }
  return memoryStore;
}
async function writeList(list) {
  if (hasKV()) { try { await kvSet(list); return; } catch { /* val terug op geheugen */ } }
  memoryStore = list;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) {
    return res.status(401).json({ error: "Niet ingelogd." });
  }

  try {
    if (req.method === "GET") {
      const list = await readList();
      return res.status(200).json({ items: list });
    }

    if (req.method === "POST") {
      const { text, source } = req.body || {};
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "Lege verbeterpunt" });
      }
      const list = await readList();
      // dubbele punten voorkomen (zelfde tekst niet twee keer)
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
      await writeList(next);
      return res.status(200).json({ items: next });
    }

    if (req.method === "DELETE") {
      const { id, all } = req.body || {};
      let list = await readList();
      list = all ? [] : list.filter((i) => i.id !== id);
      await writeList(list);
      return res.status(200).json({ items: list });
    }

    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Verbeterlijst fout:", err.message);
    return res.status(500).json({ error: "Kon verbeterlijst niet verwerken" });
  }
}
