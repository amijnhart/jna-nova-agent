import { verifyToken } from "./_auth.js";

// Boeksy boekhoudkoppeling.
//
// De API-key (BOEKSY_API_KEY) blijft uitsluitend serverside als environment-variable.
// NOVA's frontend krijgt de key NOOIT te zien. Alle aanroepen gaan via deze proxy.
//
// Routes:
//   ?action=status                  - of Boeksy gekoppeld is (geen externe call)
//   ?action=relations               - lijst klanten en leveranciers
//   ?action=invoices                - recente facturen
//   ?action=quotes                  - recente offertes
//   ?action=profit-loss             - winst- en verliesrekening voor lopend kwartaal
//   ?action=overview                - samengevat overzicht (gebruikt door NOVA bij login)
//
// Schrijf-acties (factuur of offerte aanmaken) zijn bewust nog NIET ingebouwd.
// Die vereisen een goedkeuring-flow met menselijke check; die voegen we apart toe.

const BASE_URL = "https://vxjjidrqzbbzserdkhkg.supabase.co/functions/v1/public-api";

function getApiKey() {
  return process.env.BOEKSY_API_KEY || "";
}

async function boeksyFetch(path) {
  const key = getApiKey();
  if (!key) throw new Error("Boeksy-API-key ontbreekt. Voeg BOEKSY_API_KEY toe als environment-variable in Vercel.");

  const url = BASE_URL + path;
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + key },
  });

  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j.error?.message || j.message || ""; } catch { detail = res.statusText; }
    throw new Error(`Boeksy (${res.status}): ${detail || "onbekende fout"}`);
  }
  return await res.json();
}

// --- HANDLERS ---

async function handleStatus(req, res) {
  return res.status(200).json({
    configured: !!getApiKey(),
    base: BASE_URL,
  });
}

async function handleRelations(req, res) {
  const data = await boeksyFetch("/v1/relations?limit=50");
  // Compacte versie voor de frontend
  const items = (data.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    email: r.email,
    vat_number: r.vat_number,
  }));
  return res.status(200).json({ items });
}

async function handleInvoices(req, res) {
  const data = await boeksyFetch("/v1/invoices?limit=50");
  const items = (data.data || []).map((inv) => ({
    id: inv.id,
    number: inv.number || inv.invoice_number || null,
    date: inv.invoice_date,
    subject: inv.subject,
    total: inv.total || inv.total_amount || null,
    status: inv.status,
    relation: inv.relation?.name || inv.relation_name || null,
  }));
  return res.status(200).json({ items });
}

async function handleQuotes(req, res) {
  const data = await boeksyFetch("/v1/quotes?limit=50");
  const items = (data.data || []).map((q) => ({
    id: q.id,
    number: q.number || q.quote_number || null,
    date: q.quote_date || q.date,
    subject: q.subject,
    total: q.total || q.total_amount || null,
    status: q.status,
    relation: q.relation?.name || q.relation_name || null,
  }));
  return res.status(200).json({ items });
}

async function handleProfitLoss(req, res) {
  // Lopend kwartaal: bereken from/to op basis van vandaag
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const fromMonth = quarter * 3;
  const from = new Date(now.getFullYear(), fromMonth, 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const data = await boeksyFetch(`/v1/reports/profit-loss?from=${from}&to=${to}`);
  return res.status(200).json({ from, to, report: data.data || data });
}

// Samengevat overzicht: alle belangrijke nummers in één call zodat NOVA's
// frontend met één request alles kan tonen.
async function handleOverview(req, res) {
  const result = { configured: !!getApiKey() };
  if (!result.configured) return res.status(200).json(result);

  // Parallel ophalen voor snelheid; één faalt mag de rest niet stoppen
  const [relations, invoices, quotes, pl] = await Promise.allSettled([
    boeksyFetch("/v1/relations?limit=50"),
    boeksyFetch("/v1/invoices?limit=20"),
    boeksyFetch("/v1/quotes?limit=20"),
    (() => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      return boeksyFetch(`/v1/reports/profit-loss?from=${from}&to=${to}`);
    })(),
  ]);

  if (relations.status === "fulfilled") {
    result.relations = (relations.value.data || []).map((r) => ({ id: r.id, name: r.name, type: r.type, email: r.email }));
  } else {
    result.relationsError = relations.reason?.message || "fout";
  }
  if (invoices.status === "fulfilled") {
    result.invoices = (invoices.value.data || []).map((inv) => ({
      id: inv.id, number: inv.number || inv.invoice_number, date: inv.invoice_date, subject: inv.subject,
      total: inv.total || inv.total_amount, status: inv.status, relation: inv.relation?.name || inv.relation_name,
    }));
  } else {
    result.invoicesError = invoices.reason?.message || "fout";
  }
  if (quotes.status === "fulfilled") {
    result.quotes = (quotes.value.data || []).map((q) => ({
      id: q.id, number: q.number || q.quote_number, date: q.quote_date || q.date, subject: q.subject,
      total: q.total || q.total_amount, status: q.status, relation: q.relation?.name || q.relation_name,
    }));
  } else {
    result.quotesError = quotes.reason?.message || "fout";
  }
  if (pl.status === "fulfilled") {
    result.profitLoss = pl.value.data || pl.value;
  } else {
    result.profitLossError = pl.reason?.message || "fout";
  }

  return res.status(200).json(result);
}

// --- ROUTER ---

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "GET") return res.status(405).json({ error: "Alleen GET toegestaan" });

  try {
    const action = req.query.action || "status";
    if (action === "status") return await handleStatus(req, res);
    if (action === "relations") return await handleRelations(req, res);
    if (action === "invoices") return await handleInvoices(req, res);
    if (action === "quotes") return await handleQuotes(req, res);
    if (action === "profit-loss") return await handleProfitLoss(req, res);
    if (action === "overview") return await handleOverview(req, res);
    return res.status(400).json({ error: "Onbekende action. Beschikbaar: status, relations, invoices, quotes, profit-loss, overview." });
  } catch (err) {
    console.error("Boeksy-fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
