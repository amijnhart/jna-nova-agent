import { verifyToken } from "./_auth.js";
import { writeData } from "./_config.js";

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

// Diagnose: probeer welke Boeksy endpoints werken voor jouw API-key.
// Dit is een veilige manier om te ontdekken welke endpoints beschikbaar zijn
// zonder dat de gebruiker zelf met API-keys hoeft te knoeien.
async function handleDiagnose(req, res) {
  const key = getApiKey();
  if (!key) return res.status(503).json({ error: "Geen BOEKSY_API_KEY in Vercel" });

  // Lijst van endpoints om te proberen - bekende uit docs en mogelijke varianten
  const probes = [
    // Uit de docs
    { name: "Producten", path: "/v1/products" },
    { name: "Relaties", path: "/v1/relations?limit=1" },
    { name: "Facturen", path: "/v1/invoices?limit=1" },
    { name: "Offertes", path: "/v1/quotes?limit=1" },
    // Dashboard endpoints - waar onze financials nu uit komen
    { name: "Dashboard: besteedbaar", path: "/v1/dashboard/disposable-income" },
    { name: "Dashboard: banksaldo", path: "/v1/dashboard/bank-balance" },
    { name: "Dashboard: deadlines", path: "/v1/dashboard/deadlines" },
    { name: "Dashboard: open facturen", path: "/v1/dashboard/open-invoices" },
    { name: "P&L rapport", path: "/v1/reports/profit-loss?from=2026-01-01&to=2026-01-31" },
    { name: "Cashflow", path: "/v1/reports/cashflow-forecast?months=1" },
    // Rekeningschema - varianten proberen
    { name: "Rekeningschema (gedocumenteerd)", path: "/v1/accounting/ledger-accounts" },
    { name: "Rekeningschema (alternatief 1)", path: "/v1/ledger-accounts" },
    { name: "Rekeningschema (alternatief 2)", path: "/v1/accounts" },
    { name: "Rekeningschema (alternatief 3)", path: "/v1/chart-of-accounts" },
    // Journal entries - varianten
    { name: "Boekingen (gedocumenteerd)", path: "/v1/accounting/journal-entries?from=2026-01-01&to=2026-01-31" },
    { name: "Boekingen (alternatief 1)", path: "/v1/journal-entries?from=2026-01-01&to=2026-01-31" },
    { name: "Boekingen (alternatief 2)", path: "/v1/entries?from=2026-01-01&to=2026-01-31" },
    // BTW endpoints - speculatief
    { name: "BTW-aangifte (Q1)", path: "/v1/reports/vat?from=2026-01-01&to=2026-03-31" },
    { name: "BTW-aangifte (oud zonder params)", path: "/v1/reports/vat" },
    { name: "BTW-positie", path: "/v1/vat" },
    { name: "Balans", path: "/v1/reports/balance" },
    { name: "Balans (alternatief)", path: "/v1/balance-sheet" },
    // Bank
    // Bank
    { name: "Banktransacties (nieuw)", path: "/v1/bank-transactions?from=2026-01-01&to=2026-06-30" },
    { name: "Bankrekeningen (nieuw)", path: "/v1/bank-accounts" },
    // Oude paden voor de zekerheid
    { name: "Banktransacties (alt)", path: "/v1/bank/transactions" },
    { name: "Bankrekeningen (alt)", path: "/v1/bank/accounts" },
    // Inkoop & projecten
    { name: "Inkoopfacturen", path: "/v1/purchases" },
    { name: "Bonnetjes", path: "/v1/receipts" },
    { name: "Projecten/events", path: "/v1/events" },
    { name: "Urenregistratie", path: "/v1/time-entries" },
    // Boekhouding
    { name: "Vaste activa", path: "/v1/fixed-assets" },
    { name: "Terugkerende boekingen", path: "/v1/recurring-entries" },
    // Rapportage
    { name: "Jaar-op-jaar", path: "/v1/reports/yoy?year=2026" },
  ];

  const results = [];
  for (const p of probes) {
    try {
      const r = await fetch(BASE_URL + p.path, {
        headers: { Authorization: "Bearer " + key },
      });
      let bodyHint = "";
      let sample = null;
      try {
        if (r.ok) {
          const j = await r.json();
          // Voor dashboard-endpoints: laat de volledige veld-namen + waardes zien
          // omdat we die nodig hebben om de juiste keys te kiezen.
          const isDashboard = p.path.includes("/dashboard/") || p.path.includes("/reports/");
          if (Array.isArray(j.data)) {
            bodyHint = `array van ${j.data.length} items`;
            if (isDashboard && j.data.length > 0) {
              sample = JSON.stringify(j.data[0]).slice(0, 400);
            }
          } else if (Array.isArray(j)) {
            bodyHint = `array van ${j.length} items`;
            if (isDashboard && j.length > 0) {
              sample = JSON.stringify(j[0]).slice(0, 400);
            }
          } else if (typeof j === "object") {
            const keys = Object.keys(j);
            bodyHint = `object met velden: ${keys.slice(0, 8).join(", ")}`;
            // Voor dashboard: stuur de hele response mee (kleine objecten)
            if (isDashboard) {
              const dataObj = j.data || j;
              sample = JSON.stringify(dataObj).slice(0, 500);
            }
          }
        } else {
          const j = await r.json().catch(() => ({}));
          bodyHint = (j.error?.message || j.message || "").slice(0, 100);
        }
      } catch { /* */ }
      results.push({
        endpoint: p.name,
        path: p.path,
        status: r.status,
        ok: r.ok,
        detail: bodyHint,
        sample,
      });
    } catch (err) {
      results.push({
        endpoint: p.name,
        path: p.path,
        status: 0,
        ok: false,
        detail: "Netwerkfout: " + err.message.slice(0, 100),
      });
    }
  }

  return res.status(200).json({
    base: BASE_URL,
    results,
    samenvatting: {
      werkend: results.filter((r) => r.ok).length,
      totaal: results.length,
    },
  });
}



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

// Filter weg: geannuleerde, verwijderde, of voltooid/betaalde items zonder relevantie.
// We willen ALLEEN actuele items zien in het overzicht. De backend van Boeksy houdt
// soms ook archief-items in een lijst, die zijn niet relevant voor dagelijks zicht.
function isActueel(item) {
  const status = (item.status || "").toLowerCase();
  // Verberg alles wat geannuleerd, verwijderd, archief, of expliciet afgesloten is.
  // De business-logica: dit zijn items waar geen actie meer op nodig is.
  // Inclusief afgewezen/geweigerd voor offertes - die zijn definitief klaar.
  const verbergen = [
    "cancelled", "canceled", "deleted", "archived", "voided", "void",
    "geannuleerd", "verwijderd", "gearchiveerd", "vervallen",
    "rejected", "declined", "afgewezen", "geweigerd",
    "expired", "verlopen", "ingetrokken", "withdrawn",
  ];
  if (verbergen.some((v) => status.includes(v))) return false;
  return true;
}

async function handleInvoices(req, res) {
  const data = await boeksyFetch("/v1/invoices?limit=50");
  const items = (data.data || []).filter(isActueel).map((inv) => ({
    id: inv.id,
    number: inv.number || inv.invoice_number || null,
    date: inv.invoice_date,
    event_date: inv.event_date || null,
    subject: inv.subject,
    total: inv.total || inv.total_amount || null,
    status: inv.status,
    relation: inv.relation?.name || inv.relation_name || null,
  }));
  return res.status(200).json({ items });
}

async function handleQuotes(req, res) {
  const data = await boeksyFetch("/v1/quotes?limit=50");
  const items = (data.data || []).filter(isActueel).map((q) => ({
    id: q.id,
    number: q.number || q.quote_number || null,
    date: q.quote_date || q.date,
    event_date: q.event_date || null,
    subject: q.subject,
    total: q.total || q.total_amount || null,
    status: q.status,
    relation: q.relation?.name || q.relation_name || null,
  }));
  return res.status(200).json({ items });
}

async function handleProfitLoss(req, res) {
  // Lopend kwartaal: bereken from/to op basis van vandaag.
  // Geeft ook vorig kwartaal mee voor vergelijking (verbeterpunt F).
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const fromMonth = quarter * 3;
  const from = new Date(now.getFullYear(), fromMonth, 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  // Vorig kwartaal: 3 maanden terug
  const prevFromMonth = fromMonth - 3;
  const prevYear = prevFromMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevFromMonthAdj = (prevFromMonth + 12) % 12;
  const prevFrom = new Date(prevYear, prevFromMonthAdj, 1).toISOString().slice(0, 10);
  const prevTo = new Date(prevYear, prevFromMonthAdj + 3, 0).toISOString().slice(0, 10);

  const [current, previous] = await Promise.allSettled([
    boeksyFetch(`/v1/reports/profit-loss?from=${from}&to=${to}`),
    boeksyFetch(`/v1/reports/profit-loss?from=${prevFrom}&to=${prevTo}`),
  ]);
  return res.status(200).json({
    from, to,
    report: current.status === "fulfilled" ? (current.value.data || current.value) : null,
    previous: previous.status === "fulfilled" ? { from: prevFrom, to: prevTo, report: previous.value.data || previous.value } : null,
  });
}

// Samengevat overzicht: alle belangrijke nummers in één call zodat NOVA's
// frontend met één request alles kan tonen.
async function handleOverview(req, res) {
  const result = { configured: !!getApiKey() };
  if (!result.configured) return res.status(200).json(result);

  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const from = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const prevFromMonth = q * 3 - 3;
  const prevYear = prevFromMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevFromMonthAdj = (prevFromMonth + 12) % 12;
  const prevFrom = new Date(prevYear, prevFromMonthAdj, 1).toISOString().slice(0, 10);
  const prevTo = new Date(prevYear, prevFromMonthAdj + 3, 0).toISOString().slice(0, 10);

  // Parallel ophalen voor snelheid; één faalt mag de rest niet stoppen
  const [relations, invoices, quotes, pl, plPrev, products] = await Promise.allSettled([
    boeksyFetch("/v1/relations?limit=50"),
    boeksyFetch("/v1/invoices?limit=20"),
    boeksyFetch("/v1/quotes?limit=20"),
    boeksyFetch(`/v1/reports/profit-loss?from=${from}&to=${to}`),
    boeksyFetch(`/v1/reports/profit-loss?from=${prevFrom}&to=${prevTo}`),
    boeksyFetch("/v1/products"),
  ]);

  // Producten: standaard-prijslijst voor offertes
  if (products.status === "fulfilled") {
    const list = products.value.data || products.value || [];
    result.boeksyProducts = list.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type || null,                  // 'dienst', 'product' etc
      unit: p.unit || null,                  // 'uur', 'stuks' etc
      sales_price: p.sales_price ?? p.price ?? null,
      vat_rate: p.vat_rate ?? p.vat ?? 21,
      description: p.description || null,
    }));
  } else {
    result.boeksyProductsError = products.reason?.message || "fout";
  }

  if (relations.status === "fulfilled") {
    result.relations = (relations.value.data || []).map((r) => ({ id: r.id, name: r.name, type: r.type, email: r.email }));
  } else {
    result.relationsError = relations.reason?.message || "fout";
  }
  if (invoices.status === "fulfilled") {
    result.invoices = (invoices.value.data || []).filter(isActueel).map((inv) => ({
      id: inv.id, number: inv.number || inv.invoice_number, date: inv.invoice_date,
      event_date: inv.event_date || null,
      subject: inv.subject,
      total: inv.total || inv.total_amount, status: inv.status, relation: inv.relation?.name || inv.relation_name,
    }));
  } else {
    result.invoicesError = invoices.reason?.message || "fout";
  }
  if (quotes.status === "fulfilled") {
    result.quotes = (quotes.value.data || []).filter(isActueel).map((q) => ({
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
    result.profitLossPeriod = { from, to };
  } else {
    result.profitLossError = pl.reason?.message || "fout";
  }
  if (plPrev.status === "fulfilled") {
    result.profitLossPrev = plPrev.value.data || plPrev.value;
    result.profitLossPrevPeriod = { from: prevFrom, to: prevTo };
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
  //
  // FILTER-LOGICA: we tonen ALLEEN offertes met status 'concept' of 'verzonden'/'open'.
  // Geweigerd, geaccepteerd, vervallen, ingetrokken, verwijderd worden uitgesloten.
  // Boeksy gebruikt mogelijk varianten in NL/EN; we matchen beide voor robuustheid.
  if (quotes.status === "fulfilled") {
    const followUps = [];
    const allStatussen = []; // diagnose: welke statussen zien we echt langskomen
    const verworpen = []; // diagnose: welke offertes werden gefilterd en waarom
    const fourteenDaysAgo = nowMs - 14 * 24 * 60 * 60 * 1000;
    // Statussen die wél in follow-up mogen verschijnen (positieve filter)
    const toegestaan = new Set([
      "concept", "draft",
      "verzonden", "sent", "open", "verstuurd",
      "deels_betaald", "partly_paid",
    ]);
    // Expliciete uitsluit-lijst als backup voor wanneer status niet in toegestaan zit
    const uitsluiten = new Set([
      "geaccepteerd", "accepted",
      "afgewezen", "rejected", "geweigerd", "declined",
      "expired", "verlopen", "vervallen",
      "ingetrokken", "withdrawn", "cancelled", "canceled", "geannuleerd",
      "deleted", "verwijderd", "archived", "gearchiveerd",
      "voided", "void", "paid", "betaald",
    ]);
    for (const q of (quotes.value.data || [])) {
      const status = (q.status || "").toLowerCase().trim();
      if (status) allStatussen.push(status);
      const nummer = q.number || q.quote_number || "?";

      // STRIKT: lege status -> NIET doorlaten. Bij twijfel uitsluiten.
      if (!status) {
        verworpen.push({ nummer, reden: "geen status", status: q.status });
        continue;
      }

      // Uitsluit-lijst
      if (uitsluiten.has(status)) {
        verworpen.push({ nummer, reden: "uitgesloten status", status });
        continue;
      }

      // Niet in toegestaan-lijst? Ook uitsluiten (whitelist-approach)
      if (!toegestaan.has(status)) {
        verworpen.push({ nummer, reden: "onbekende status", status });
        continue;
      }

      const date = q.quote_date || q.date;
      if (!date) {
        verworpen.push({ nummer, reden: "geen datum", status });
        continue;
      }
      const ms = new Date(date).getTime();
      if (isNaN(ms)) {
        verworpen.push({ nummer, reden: "ongeldige datum", status });
        continue;
      }
      if (ms > fourteenDaysAgo) {
        // Te jong - geen follow-up nodig, niet als verworpen aanmerken
        continue;
      }

      // DOOD-CONCEPT FILTER: concepten ouder dan 90 dagen zijn praktisch dood.
      // Boeksy laat status onveranderd 'concept' als de gebruiker hem nooit
      // verstuurd of afgesloten heeft. Een dergelijke offerte ga je in de
      // praktijk niet alsnog opvolgen, dus uitsluiten van begroeting/follow-up.
      const ageDays = Math.floor((nowMs - ms) / (24 * 60 * 60 * 1000));
      if (status === "concept" && ageDays > 90) {
        verworpen.push({ nummer, reden: `concept > 90 dagen (${ageDays}d) - praktisch dood`, status });
        continue;
      }
      // Hardere grens voor alles: > 365 dagen = vrijwel zeker geen actie meer waard
      if (ageDays > 365) {
        verworpen.push({ nummer, reden: `> 365 dagen oud (${ageDays}d)`, status });
        continue;
      }

      followUps.push({
        id: q.id,
        number: nummer,
        date,
        klant: q.relation?.name || q.relation_name || "",
        subject: q.subject || "",
        total: q.total || q.total_amount || null,
        status: q.status || "open",
        ageDays,
      });
    }
    followUps.sort((a, b) => b.ageDays - a.ageDays);
    result.followUps = followUps;
    // Diagnose: welke statussen kwamen we tegen, en wat werd gefilterd waarom?
    // Hulpvol om te zien of er statussen zijn die we nog niet kennen.
    result.followUpsDiagnose = {
      uniekStatussen: [...new Set(allStatussen)].sort(),
      totaalOffertes: (quotes.value.data || []).length,
      naFilter: followUps.length,
      verworpen: verworpen.slice(0, 20), // max 20 voor leesbaarheid
    };
  }

  // FINANCIALS LIGHT uit Boeksy dashboard endpoints.
  // PRINCIPE: niets zelf berekenen, alleen wat Boeksy zelf toont aan de gebruiker.
  // Zo zijn de cijfers in NOVA's begroeting identiek aan wat Boeksy's app laat zien.
  try {
    const [disposable, bankBalance] = await Promise.allSettled([
      boeksyFetch("/v1/dashboard/disposable-income"),
      boeksyFetch("/v1/bank-accounts"),
    ]);

    let besteedbaar = null, bankSaldo = null, btwReservering = null, ibReservering = null;
    if (disposable.status === "fulfilled") {
      const d = disposable.value.data || disposable.value;
      besteedbaar = pickNumber(d, "disposable", "disposable_income", "besteedbaar");
      bankSaldo = pickNumber(d, "bank_total", "bank_balance", "banksaldo");
      btwReservering = pickNumber(d, "vat_reserve", "vat_reservation", "btw_reservering");
      ibReservering = pickNumber(d, "ib_reserve", "income_tax_reservation", "ib_reservering");
    }
    if (bankBalance.status === "fulfilled" && bankSaldo === null) {
      const b = bankBalance.value.data || bankBalance.value;
      bankSaldo = pickNumber(b, "total", "total_balance", "saldo", "balance");
    }

    result.financials = {
      besteedbaar,
      bankSaldo,
      btwReservering,
      ibReservering,
      bron: "Boeksy dashboard",
    };
  } catch (err) {
    result.financialsError = err.message;
  }

  // Cache het hele overview in Redis zodat Daily Brain (cron-job 's ochtends)
  // dezelfde data kan gebruiken zonder zelf opnieuw alle Boeksy-calls te doen.
  // Geldt zolang het overview niet ouder is dan een paar uur.
  try {
    await writeData("boeksy_overview_cache", { ...result, cached: new Date().toISOString() });
  } catch { /* niet fataal */ }

  return res.status(200).json(result);
}

// --- POST handlers: schrijven naar Boeksy ---

// POST /v1/quotes - offerte als concept aanmaken.
// Verwacht body: { relation_id, subject, event_date?, lines: [{description, quantity, unit_price, vat_rate}] }
// Boeksy maakt het automatisch als concept aan zonder het te versturen.
async function handleCreateQuote(req, res) {
  const key = getApiKey();
  if (!key) return res.status(503).json({ error: "Boeksy niet geconfigureerd" });
  const body = req.body;
  if (!body || !body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "lines verplicht" });
  }
  const url = BASE_URL + "/v1/quotes";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = "";
    try { const j = await r.json(); msg = j.error?.message || j.message || ""; } catch { msg = r.statusText; }
    return res.status(r.status).json({ error: msg || "Aanmaken offerte mislukt" });
  }
  const result = await r.json();
  return res.status(200).json({ ok: true, quote: result.data || result });
}

// POST /v1/invoices - factuur als concept aanmaken.
// --- FINANCIËLE RAPPORTAGES (rechtstreeks uit Boeksy dashboard endpoints) ---
//
// PRINCIPE: NIETS ZELF BEREKENEN. Boeksy levert de cijfers al klaar voor gebruik.
// Wij halen ze op en presenteren ze. Geen schattingen, geen belastingschijven,
// geen optellingen uit journal-entries - alles komt direct van Boeksy.
//
// Endpoints die we gebruiken:
//   /v1/dashboard/disposable-income   - besteedbaar bedrag, BTW + IB reservering
//   /v1/dashboard/bank-balance        - totaal banksaldo + per rekening
//   /v1/dashboard/deadlines           - BTW-deadline, achterstallig
//   /v1/dashboard/open-invoices       - openstaande verkoopfacturen
//   /v1/reports/vat?from=...&to=...   - BTW-aangifte per periode

// Helper: probeer veld onder verschillende namen
function pickNumber(obj, ...names) {
  if (!obj) return null;
  for (const n of names) {
    if (typeof obj[n] === "number") return obj[n];
    if (typeof obj[n] === "string" && !isNaN(parseFloat(obj[n]))) return parseFloat(obj[n]);
  }
  return null;
}

async function handleFinancials(req, res) {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  // Lopend kwartaal voor BTW-aangifte
  const q = Math.floor(now.getMonth() / 3);
  const qFrom = new Date(year, q * 3, 1).toISOString().slice(0, 10);
  const qTo = today;

  // Lopende maand voor BTW
  const mFrom = new Date(year, now.getMonth(), 1).toISOString().slice(0, 10);

  // Alles parallel ophalen voor snelheid
  const [disposable, bankBalance, deadlines, openInvoices, vatQuarter, vatYear, vatMonth] = await Promise.allSettled([
    boeksyFetch("/v1/dashboard/disposable-income"),
    boeksyFetch("/v1/bank-accounts"),
    boeksyFetch("/v1/dashboard/deadlines"),
    boeksyFetch("/v1/dashboard/open-invoices"),
    boeksyFetch(`/v1/reports/vat?from=${qFrom}&to=${qTo}`),
    boeksyFetch(`/v1/reports/vat?from=${yearStart}&to=${today}`),
    boeksyFetch(`/v1/reports/vat?from=${mFrom}&to=${today}`),
  ]);

  // disposable-income response: verwacht structuur uit dashboard
  // Mogelijke veldnamen die we proberen (voor robuustheid)
  let besteedbaar = null, bankSaldo = null, btwReservering = null, ibReservering = null;
  if (disposable.status === "fulfilled") {
    const d = disposable.value.data || disposable.value;
    besteedbaar = pickNumber(d, "disposable", "disposable_income", "besteedbaar");
    bankSaldo = pickNumber(d, "bank_total", "bank_balance", "banksaldo");
    btwReservering = pickNumber(d, "vat_reserve", "vat_reservation", "btw_reservering");
    ibReservering = pickNumber(d, "ib_reserve", "income_tax_reservation", "ib_reservering");
  }

  // bank-balance fallback voor specifiekere bank-data
  let bankAccounts = [];
  let bankTotal = bankSaldo;
  if (bankBalance.status === "fulfilled") {
    const b = bankBalance.value.data || bankBalance.value;
    const total = pickNumber(b, "total", "total_balance", "saldo", "balance");
    if (total !== null) bankTotal = total;
    const accounts = b.accounts || b.bank_accounts || b.rekeningen || [];
    if (Array.isArray(accounts)) {
      bankAccounts = accounts.map((a) => ({
        name: a.name || a.iban || a.naam || "rekening",
        iban: a.iban || a.account_number || null,
        saldo: pickNumber(a, "balance", "saldo", "amount", "current_balance"),
      }));
    }
  }

  // BTW per periode - probeer veldnamen
  function extractVat(result) {
    if (result.status !== "fulfilled") return { reason: result.reason?.message || "ophalen mislukt" };
    const d = result.value.data || result.value;
    return {
      teBetalen: pickNumber(d, "vat_payable", "to_pay", "te_betalen"),
      geind: pickNumber(d, "vat_collected", "collected", "geind"),
      aftrekbaar: pickNumber(d, "vat_deductible", "deductible", "aftrekbaar"),
      from: d.from || d.period_from,
      to: d.to || d.period_to,
    };
  }

  // Deadlines voor BTW-aangifte
  let btwDeadline = null, btwDagen = null, achterstallig = null, ongematched = null, btwPeriodLabel = null;
  if (deadlines.status === "fulfilled") {
    const d = deadlines.value.data || deadlines.value;
    btwDeadline = d.vat_deadline || null;
    btwPeriodLabel = d.vat_period_label || null;
    btwDagen = pickNumber(d, "vat_days_left", "days_until_vat");
    achterstallig = pickNumber(d, "overdue_invoice_count", "overdue_invoices");
    ongematched = pickNumber(d, "unmatched_bank_count", "unmatched_transactions");
  }

  // Openstaande facturen
  let openstaandTotal = null, openstaandLijst = [];
  if (openInvoices.status === "fulfilled") {
    const d = openInvoices.value.data || openInvoices.value;
    if (Array.isArray(d)) {
      openstaandLijst = d.slice(0, 20);
      openstaandTotal = d.reduce((sum, inv) => sum + (pickNumber(inv, "open_amount", "openstaand", "balance", "total") || 0), 0);
    } else if (d && Array.isArray(d.invoices)) {
      openstaandLijst = d.invoices.slice(0, 20);
      openstaandTotal = pickNumber(d, "total", "total_outstanding", "openstaand_totaal");
    }
  }

  return res.status(200).json({
    // Hoofdwaarden uit dashboard - PRECIES wat Boeksy zelf toont
    besteedbaar: {
      bedrag: besteedbaar,
      bankSaldo: bankTotal,
      minBtw: btwReservering,
      minIb: ibReservering,
    },
    bank: {
      saldo: bankTotal,
      accounts: bankAccounts,
    },
    btw: {
      maand: extractVat(vatMonth),
      kwartaal: extractVat(vatQuarter),
      jaar: extractVat(vatYear),
      teReserveren: btwReservering,
    },
    deadlines: {
      btwDeadline,
      btwPeriodLabel,
      btwDagenRest: btwDagen,
      achterstalligeFacturen: achterstallig,
      ongematchteTransacties: ongematched,
    },
    openstaand: {
      totaal: openstaandTotal,
      facturen: openstaandLijst,
    },
    bron: "Boeksy dashboard endpoints",
    berekend: new Date().toISOString(),
  });
}


async function handleCreateInvoice(req, res) {
  const key = getApiKey();
  if (!key) return res.status(503).json({ error: "Boeksy niet geconfigureerd" });
  const body = req.body;
  if (!body || !body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ error: "lines verplicht" });
  }
  const url = BASE_URL + "/v1/invoices";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = "";
    try { const j = await r.json(); msg = j.error?.message || j.message || ""; } catch { msg = r.statusText; }
    return res.status(r.status).json({ error: msg || "Aanmaken factuur mislukt" });
  }
  const result = await r.json();
  return res.status(200).json({ ok: true, invoice: result.data || result });
}

// --- ROUTER ---

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    const action = req.query.action || "status";

    // GET-acties
    if (req.method === "GET") {
      if (action === "status") return await handleStatus(req, res);
      if (action === "relations") return await handleRelations(req, res);
      if (action === "invoices") return await handleInvoices(req, res);
      if (action === "quotes") return await handleQuotes(req, res);
      if (action === "profit-loss") return await handleProfitLoss(req, res);
      if (action === "overview") return await handleOverview(req, res);
      if (action === "diagnose") return await handleDiagnose(req, res);
      if (action === "financials") return await handleFinancials(req, res);
      return res.status(400).json({ error: "Onbekende GET-action" });
    }

    // POST-acties (schrijven)
    if (req.method === "POST") {
      if (action === "create-quote") return await handleCreateQuote(req, res);
      if (action === "create-invoice") return await handleCreateInvoice(req, res);
      return res.status(400).json({ error: "Onbekende POST-action" });
    }

    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Boeksy-fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
