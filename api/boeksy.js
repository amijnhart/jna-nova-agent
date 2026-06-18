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

// Bereken contentadvies voor een specifieke event-datum.
// Geeft een lijst suggesties met datum, type en korte tekst.
function generateContentAdvice(eventISO, subject, klant) {
  const advice = [];
  const eventDate = new Date(eventISO);
  if (isNaN(eventDate.getTime())) return advice;

  // -4 dagen: nieuwe ontwikkelingen highlighten
  const d4 = new Date(eventDate); d4.setDate(d4.getDate() - 4);
  advice.push({
    when: d4.toISOString(),
    type: "pre-build",
    title: `Pre-event aankondiging: ${subject || "gig"}`,
    body: `Heb je sinds vorige keer nieuwe apparatuur, een nieuwe show-onderdeel of bijzondere voorbereidingen? Deel die alvast om verwachting te bouwen voor ${klant || "deze klus"}.`,
  });

  // -2 dagen: teaser
  const d2 = new Date(eventDate); d2.setDate(d2.getDate() - 2);
  advice.push({
    when: d2.toISOString(),
    type: "teaser",
    title: `Teaser: ${subject || "gig"}`,
    body: `Korte teaser-post om de gig aan te kondigen. Visual van vorige edities of een setup-shot werkt goed. Tag de locatie en eventueel ${klant || "de klant"}.`,
  });

  // Op de dag zelf: on-site footage
  advice.push({
    when: eventDate.toISOString(),
    type: "on-site",
    title: `On-site content: ${subject || "gig"}`,
    body: `Schiet vandaag beeldmateriaal van je plek, de opstelling, het publiek en sfeermomenten. Een korte boomerang of timelapse van het opbouwen werkt goed. Stories live, posts kun je later inplannen.`,
  });

  // +2 dagen: recap
  const dPlus2 = new Date(eventDate); dPlus2.setDate(dPlus2.getDate() + 2);
  advice.push({
    when: dPlus2.toISOString(),
    type: "recap",
    title: `Recap: ${subject || "gig"}`,
    body: `Laat zien hoe het was. Korte montage van de beste momenten met muziek, of een carousel met sfeerbeelden. Bedank ${klant || "de klant"} en de gasten.`,
  });

  return advice;
}

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
    event_date: inv.event_date || null,   // datum dat de werkzaamheden plaatsvinden
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
    event_date: q.event_date || null,   // datum dat de werkzaamheden plaatsvinden
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
      id: inv.id, number: inv.number || inv.invoice_number, date: inv.invoice_date,
      event_date: inv.event_date || null,
      subject: inv.subject,
      total: inv.total || inv.total_amount, status: inv.status, relation: inv.relation?.name || inv.relation_name,
    }));
  } else {
    result.invoicesError = invoices.reason?.message || "fout";
  }
  if (quotes.status === "fulfilled") {
    result.quotes = (quotes.value.data || []).map((q) => ({
      id: q.id, number: q.number || q.quote_number, date: q.quote_date || q.date,
      event_date: q.event_date || null,
      subject: q.subject,
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

  // EVENTS: alle offertes en facturen met event_date in de toekomst (of recent verleden)
  // worden tot agenda-items met contentadvies opgewerkt.
  const events = [];
  const nowMs = Date.now();
  const horizonPast = 14 * 24 * 60 * 60 * 1000;  // 14 dagen terug
  const horizonFuture = 120 * 24 * 60 * 60 * 1000; // 4 maanden vooruit

  // Helper om een lijst om te zetten naar events
  function addEventsFromItems(items, source) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      // event_date staat in zowel offertes als facturen volgens Boeksy schema
      const ed = item.event_date || item.eventDate || null;
      if (!ed) continue;
      const ms = new Date(ed).getTime();
      if (isNaN(ms)) continue;
      // Filter op horizon (recent verleden tot enkele maanden vooruit)
      if (ms < nowMs - horizonPast) continue;
      if (ms > nowMs + horizonFuture) continue;
      const klant = item.relation?.name || item.relation_name || "";
      const subject = item.subject || "";
      events.push({
        id: `boeksy-${source}-${item.id}`,
        boeksyId: item.id,
        boeksySource: source,
        date: ed,
        subject,
        klant,
        number: item.number || item.invoice_number || item.quote_number || null,
        total: item.total || item.total_amount || null,
        status: item.status || null,
        advice: generateContentAdvice(ed, subject, klant),
      });
    }
  }

  if (invoices.status === "fulfilled") addEventsFromItems(invoices.value.data || [], "invoice");
  if (quotes.status === "fulfilled") addEventsFromItems(quotes.value.data || [], "quote");
  // Sorteer op datum, dichtstbij eerst
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  result.events = events;

  // FOLLOW-UPS: offertes die ouder zijn dan 14 dagen en niet zijn geaccepteerd/afgewezen.
  // NOVA stuurt geen mail; Boeksy heeft daar zelf een functie voor.
  if (quotes.status === "fulfilled") {
    const followUps = [];
    const fourteenDaysAgo = nowMs - 14 * 24 * 60 * 60 * 1000;
    for (const q of (quotes.value.data || [])) {
      const status = (q.status || "").toLowerCase();
      // Status-namen verschillen; we filteren wat zeker NIET follow-up vereist
      if (["geaccepteerd", "accepted", "afgewezen", "rejected", "expired", "verlopen", "ingetrokken"].includes(status)) continue;
      const date = q.quote_date || q.date;
      if (!date) continue;
      const ms = new Date(date).getTime();
      if (isNaN(ms) || ms > fourteenDaysAgo) continue; // nog te jong voor follow-up
      followUps.push({
        id: q.id,
        number: q.number || q.quote_number || null,
        date,
        klant: q.relation?.name || q.relation_name || "",
        subject: q.subject || "",
        total: q.total || q.total_amount || null,
        status: q.status || "open",
        ageDays: Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000)),
      });
    }
    // Oudste eerst zodat NOVA de meest dringende bovenaan zet
    followUps.sort((a, b) => b.ageDays - a.ageDays);
    result.followUps = followUps;
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
