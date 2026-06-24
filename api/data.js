import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS, storageStatus } from "./_config.js";

// Samengevoegde data-functie voor de lijst-soorten in NOVA:
//
//   ?type=catalog       - productcatalogus van JnA Events
//   ?type=calendar      - contentkalender met geplande posts
//   ?type=improvements  - verbeterpunten die NOVA verzamelt
//   ?type=storage       - status van de opslag (Redis/KV/geheugen)
//
// Drie aparte functies zijn samengebracht in één om binnen de Vercel
// Hobby-limiet (12 serverless functies) te blijven. De logica per type
// blijft helder gescheiden in eigen handlers.

function makeId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
}

// --- CATALOG ---
async function handleCatalog(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ items: await readData(KEYS.catalog, []) });
  }
  if (req.method === "POST") {
    const { name, category, description } = req.body || {};
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Naam ontbreekt" });
    const list = await readData(KEYS.catalog, []);
    const item = {
      id: makeId("prod"),
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
}

// --- CALENDAR ---
async function handleCalendar(req, res) {
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
      id: makeId("post"),
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
}

// --- IMPROVEMENTS ---
//
// Verbeterpunten worden persistent opgeslagen in Redis. Sessies overleven dit al.
// Status-veld toegevoegd om bij te houden welke al opgepakt/afgewezen zijn:
//   - "open" (standaard, nog niet behandeld)
//   - "done" (opgepakt en klaar)
//   - "dismissed" (niet relevant, niet meer tonen)
async function handleImprovements(req, res) {
  if (req.method === "GET") {
    const all = await readData(KEYS.improvements, []);
    // Standaard alleen open items teruggeven, tenzij ?all=1
    const includeAll = req.query.all === "1";
    const items = includeAll ? all : all.filter((i) => (i.status || "open") === "open");
    return res.status(200).json({ items, totalOpen: all.filter((i) => (i.status || "open") === "open").length, totalAll: all.length });
  }
  if (req.method === "POST") {
    const { text, source } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Lege verbeterpunt" });
    const list = await readData(KEYS.improvements, []);
    // Dedup: zelfde tekst niet opnieuw - ook als hij eerder afgewezen was, opnieuw open zetten
    const existing = list.find((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase());
    if (existing) {
      if (existing.status === "dismissed") existing.status = "open"; // heropen want het komt terug
      await writeData(KEYS.improvements, list);
      return res.status(200).json({ items: list.filter((i) => (i.status || "open") === "open"), duplicate: true });
    }
    const item = {
      id: makeId("imp"),
      text: text.trim(),
      source: source || "nova",
      date: new Date().toISOString(),
      status: "open",
    };
    const next = [item, ...list].slice(0, 200);
    await writeData(KEYS.improvements, next);
    return res.status(200).json({ items: next.filter((i) => (i.status || "open") === "open") });
  }
  if (req.method === "PATCH") {
    // Status veranderen: open / done / dismissed
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: "id en status verplicht" });
    if (!["open", "done", "dismissed"].includes(status)) return res.status(400).json({ error: "Ongeldige status" });
    const list = await readData(KEYS.improvements, []);
    const item = list.find((i) => i.id === id);
    if (!item) return res.status(404).json({ error: "Verbeterpunt niet gevonden" });
    item.status = status;
    item.updated = new Date().toISOString();
    await writeData(KEYS.improvements, list);
    return res.status(200).json({ items: list.filter((i) => (i.status || "open") === "open") });
  }
  if (req.method === "DELETE") {
    const { id, all } = req.body || {};
    let list = await readData(KEYS.improvements, []);
    list = all ? [] : list.filter((i) => i.id !== id);
    await writeData(KEYS.improvements, list);
    return res.status(200).json({ items: list.filter((i) => (i.status || "open") === "open") });
  }
  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- ROUTER ---
export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    const type = req.query.type || "";
    if (type === "catalog") return await handleCatalog(req, res);
    if (type === "calendar") return await handleCalendar(req, res);
    if (type === "improvements") return await handleImprovements(req, res);
    if (type === "storage") {
      const status = await storageStatus();
      return res.status(200).json(status);
    }
    return res.status(400).json({ error: "Onbekend type. Gebruik ?type=catalog, calendar, improvements of storage." });
  } catch (err) {
    console.error("Data-functie fout:", err.message);
    return res.status(500).json({ error: "Kon data niet verwerken: " + err.message });
  }
}
