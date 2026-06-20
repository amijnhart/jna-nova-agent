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

// Filter weg: geannuleerde, verwijderde, of voltooid/betaalde items zonder relevantie.
// We willen ALLEEN actuele items zien in het overzicht. De backend van Boeksy houdt
// soms ook archief-items in een lijst, die zijn niet relevant voor dagelijks zicht.
function isActueel(item) {
  const status = (item.status || "").toLowerCase();
  // Verberg alles wat geannuleerd, verwijderd, archief, of expliciet afgesloten is.
  // De business-logica: dit zijn items waar geen actie meer op nodig is.
  const verbergen = [
    "cancelled", "canceled", "deleted", "archived", "voided", "void",
    "geannuleerd", "verwijderd", "gearchiveerd", "vervallen",
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

  // FINANCIALS LIGHT: bankstand, BTW lopend kwartaal en jaar.
  // Dit zit standaard in overview zodat NOVA er actief over kan meedenken zonder
  // dat de gebruiker eerst het Financieel-paneel hoeft te openen.
  // De volledige IB-berekening blijft alleen in /financials om kosten te sparen.
  try {
    const ytdFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const ytdTo = now.toISOString().slice(0, 10);
    const [bank, vatQuarter, vatYear] = await Promise.allSettled([
      calcBankBalance(),
      calcVatPosition(from, to),
      calcVatPosition(ytdFrom, ytdTo),
    ]);
    result.financials = {
      bank: bank.status === "fulfilled" ? { saldo: bank.value.saldo, reason: bank.value.reason, accounts: bank.value.accounts } : null,
      btwKwartaal: vatQuarter.status === "fulfilled" ? { uitgaand: vatQuarter.value.uitgaand, inkomend: vatQuarter.value.inkomend, teBetalen: vatQuarter.value.teBetalen, from, to } : null,
      btwJaar: vatYear.status === "fulfilled" ? { uitgaand: vatYear.value.uitgaand, inkomend: vatYear.value.inkomend, teBetalen: vatYear.value.teBetalen, from: ytdFrom, to: ytdTo } : null,
    };
  } catch (err) {
    // Niet fataal - rest van overview moet doorgaan
    result.financialsError = err.message;
  }

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
// --- FINANCIËLE RAPPORTAGES (afgeleid uit journal-entries en ledger-accounts) ---

// Detecteert bank-grootboekrekeningen op basis van veelvoorkomende patronen.
// Boeksy gebruikt het Nederlandse rekeningschema; bank-accounts vallen meestal
// in de 1000-1099 reeks (liquide middelen) of hebben "bank" in de naam.
function isBankAccount(account) {
  if (!account) return false;
  const code = String(account.code || account.number || "").trim();
  const name = String(account.name || "").toLowerCase();
  // 1000-1099 is standaard liquide middelen in Nederlands rekeningschema
  if (/^10\d{2}$/.test(code)) return true;
  if (/^11\d{2}$/.test(code)) return true; // soms ook 11xx voor banken
  if (/bank|knab|ing|abn|rabo|liquide|kas/.test(name)) return true;
  return false;
}

// Detecteert BTW-grootboekrekeningen. Standaard NL-schema: 1500-1599 reeks.
// Voorbeelden: 1500 Te betalen BTW hoog, 1510 BTW laag, 1520 Voorbelasting.
function classifyVatAccount(account) {
  if (!account) return null;
  const code = String(account.code || account.number || "").trim();
  const name = String(account.name || "").toLowerCase();
  // Outbound BTW = wat we moeten betalen aan belastingdienst (op verkopen)
  if (/^15(0|1)\d$/.test(code)) return "uitgaand"; // te betalen BTW (verkoop)
  if (/^15(2|3)\d$/.test(code)) return "inkomend"; // voorbelasting (inkoop)
  if (/te.betalen.btw|btw.afdracht|btw.verkoop|omzetbelasting.verkoop/.test(name)) return "uitgaand";
  if (/voorbelasting|btw.inkoop|terug.te.vorderen.btw/.test(name)) return "inkomend";
  return null;
}

// Bereken bankstand uit ledger-accounts en boekingen tot vandaag.
// Returnt totaal saldo op alle bank-accounts.
async function calcBankBalance() {
  try {
    const accountsData = await boeksyFetch("/v1/accounting/ledger-accounts");
    const accounts = accountsData.data || accountsData || [];
    const bankAccounts = accounts.filter(isBankAccount);
    if (!bankAccounts.length) return { saldo: null, accounts: [], reason: "Geen bank-grootboekrekeningen herkend in je rekeningschema" };

    // Voor elke bank-account: huidig saldo afleiden uit alle mutaties vanaf
    // boekjaar-begin. Boeksy geeft mogelijk een 'balance' veld direct mee.
    const result = [];
    for (const acc of bankAccounts) {
      let saldo = null;
      // Probeer direct balance veld
      if (typeof acc.balance === "number") saldo = acc.balance;
      else if (typeof acc.current_balance === "number") saldo = acc.current_balance;
      else if (typeof acc.amount === "number") saldo = acc.amount;
      result.push({
        code: acc.code || acc.number,
        name: acc.name,
        saldo,
      });
    }

    // Als geen enkele account een balance gaf, sommen we via journal-entries
    const haveBalance = result.some((r) => r.saldo !== null);
    if (!haveBalance) {
      const today = new Date().toISOString().slice(0, 10);
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
      try {
        const entriesData = await boeksyFetch(`/v1/accounting/journal-entries?from=${yearStart}&to=${today}`);
        const entries = entriesData.data || entriesData || [];
        const codesSet = new Set(bankAccounts.map((a) => String(a.code || a.number)));
        const saldos = {};
        for (const code of codesSet) saldos[code] = 0;
        for (const entry of entries) {
          const lines = entry.lines || entry.rows || [];
          for (const line of lines) {
            const lineCode = String(line.account_code || line.ledger_code || line.code || "");
            if (!codesSet.has(lineCode)) continue;
            const debit = parseFloat(line.debit || 0) || 0;
            const credit = parseFloat(line.credit || 0) || 0;
            // Voor bank: debet verhoogt saldo (geld erbij), credit verlaagt (geld eraf)
            saldos[lineCode] = (saldos[lineCode] || 0) + debit - credit;
          }
        }
        for (const r of result) {
          const k = String(r.code);
          if (saldos[k] !== undefined) r.saldo = saldos[k];
        }
      } catch (e) {
        // journal-entries faalde; laat saldo's null staan
      }
    }

    const totaal = result.reduce((sum, r) => sum + (r.saldo || 0), 0);
    const allOk = result.every((r) => r.saldo !== null);
    return {
      saldo: allOk ? totaal : null,
      accounts: result,
      reason: allOk ? null : "Niet alle bank-saldi konden bepaald worden uit Boeksy. Mogelijk is je administratie niet volledig bij of mist Boeksy een balance-endpoint.",
    };
  } catch (err) {
    return { saldo: null, accounts: [], reason: "Fout bij ophalen bankgegevens: " + err.message };
  }
}

// Bereken BTW positie voor een periode.
// Uitgaand (verkoop) - Inkomend (voorbelasting) = te betalen aan Belastingdienst.
async function calcVatPosition(from, to) {
  try {
    const accountsData = await boeksyFetch("/v1/accounting/ledger-accounts");
    const accounts = accountsData.data || accountsData || [];
    const vatAccounts = {};
    for (const acc of accounts) {
      const type = classifyVatAccount(acc);
      if (type) vatAccounts[String(acc.code || acc.number)] = { type, name: acc.name };
    }
    if (!Object.keys(vatAccounts).length) {
      return { uitgaand: 0, inkomend: 0, teBetalen: 0, reason: "Geen BTW-grootboekrekeningen herkend in je rekeningschema" };
    }

    const entriesData = await boeksyFetch(`/v1/accounting/journal-entries?from=${from}&to=${to}`);
    const entries = entriesData.data || entriesData || [];

    let uitgaand = 0; // BTW op verkopen (creditzijde op te-betalen BTW)
    let inkomend = 0; // BTW op inkopen (debetzijde voorbelasting)

    for (const entry of entries) {
      const lines = entry.lines || entry.rows || [];
      for (const line of lines) {
        const lineCode = String(line.account_code || line.ledger_code || line.code || "");
        const vatAcc = vatAccounts[lineCode];
        if (!vatAcc) continue;
        const debit = parseFloat(line.debit || 0) || 0;
        const credit = parseFloat(line.credit || 0) || 0;
        if (vatAcc.type === "uitgaand") {
          // Te-betalen BTW: credit = erbij (verkoop met BTW), debit = eraf (aangifte gedaan)
          uitgaand += credit - debit;
        } else {
          // Voorbelasting: debit = erbij (inkoop met BTW aftrekbaar), credit = eraf
          inkomend += debit - credit;
        }
      }
    }

    return {
      uitgaand: Math.round(uitgaand * 100) / 100,
      inkomend: Math.round(inkomend * 100) / 100,
      teBetalen: Math.round((uitgaand - inkomend) * 100) / 100,
      from, to,
      reason: null,
    };
  } catch (err) {
    return { uitgaand: 0, inkomend: 0, teBetalen: 0, reason: "Fout bij BTW-berekening: " + err.message };
  }
}

// Schat de inkomstenbelasting Box 1 voor een ZZP'er volgens NL-tarieven 2026.
// LET OP: dit is een grove schatting voor reserveringsdoeleinden, NIET een
// belastingaangifte. Werkelijke aangifte hangt af van veel factoren die wij
// niet kennen (toeslagen, hypotheekrente, partner-inkomen, etc.).
function estimateIncomeTax(annualProfit) {
  if (!annualProfit || annualProfit <= 0) return { totalTax: 0, profitAfterDeductions: 0, breakdown: [] };

  // Zelfstandigenaftrek 2026 (wordt afgebouwd)
  const zelfstandigenaftrek = 1200;
  // MKB-winstvrijstelling 2026: 12,03% over winst minus zelfstandigenaftrek
  const winstNaZelfstandigen = Math.max(0, annualProfit - zelfstandigenaftrek);
  const mkbVrijstelling = Math.round(winstNaZelfstandigen * 0.1203);
  const belastbareWinst = Math.max(0, winstNaZelfstandigen - mkbVrijstelling);

  // Box 1 schijven 2026 (ZZP zonder AOW)
  // Schijf 1: tot ~€38.441 → 35,82% (incl. premies volksverzekeringen)
  // Schijf 2: tot ~€76.817 → 37,48%
  // Schijf 3: vanaf €76.817 → 49,50%
  const brackets = [
    { tot: 38441, rate: 0.3582 },
    { tot: 76817, rate: 0.3748 },
    { tot: Infinity, rate: 0.4950 },
  ];

  let tax = 0;
  let remaining = belastbareWinst;
  let lastTop = 0;
  const breakdown = [];
  for (const b of brackets) {
    if (remaining <= 0) break;
    const segmentSize = Math.min(remaining, b.tot - lastTop);
    const segmentTax = segmentSize * b.rate;
    tax += segmentTax;
    breakdown.push({ tot: b.tot === Infinity ? null : b.tot, rate: b.rate, segment: Math.round(segmentSize), tax: Math.round(segmentTax) });
    remaining -= segmentSize;
    lastTop = b.tot;
  }

  // Heffingskorting algemeen + arbeidskorting (vereenvoudigd, 2026)
  // Voor middeninkomens samen ongeveer €5500 aftrek
  const heffingskortingen = Math.min(5500, tax);
  const finalTax = Math.max(0, tax - heffingskortingen);

  return {
    annualProfit: Math.round(annualProfit),
    zelfstandigenaftrek,
    mkbVrijstelling,
    belastbareWinst: Math.round(belastbareWinst),
    taxBeforeKortingen: Math.round(tax),
    heffingskortingen,
    totalTax: Math.round(finalTax),
    breakdown,
  };
}

// Hoofdhandler voor het financiële overzicht
async function handleFinancials(req, res) {
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  // Lopend kwartaal
  const q = Math.floor(now.getMonth() / 3);
  const qFrom = new Date(year, q * 3, 1).toISOString().slice(0, 10);
  const qTo = today;

  // BTW: verzamel kwartaal, jaar, lopende maand
  const monthFrom = new Date(year, now.getMonth(), 1).toISOString().slice(0, 10);

  const [bank, vatQuarter, vatYear, vatMonth, plYearData] = await Promise.allSettled([
    calcBankBalance(),
    calcVatPosition(qFrom, qTo),
    calcVatPosition(yearStart, today),
    calcVatPosition(monthFrom, today),
    boeksyFetch(`/v1/reports/profit-loss?from=${yearStart}&to=${today}`),
  ]);

  // Winst dit jaar voor IB-schatting
  let yearProfit = 0;
  if (plYearData.status === "fulfilled") {
    const pl = plYearData.value.data || plYearData.value;
    if (typeof pl.profit === "number") yearProfit = pl.profit;
    else if (typeof pl.winst === "number") yearProfit = pl.winst;
    else if (typeof pl.net_profit === "number") yearProfit = pl.net_profit;
    else if (typeof pl.result === "number") yearProfit = pl.result;
    else {
      const revenue = parseFloat(pl.revenue || pl.omzet || pl.total_revenue || 0) || 0;
      const expenses = parseFloat(pl.expenses || pl.kosten || pl.total_expenses || 0) || 0;
      yearProfit = revenue - expenses;
    }
  }

  // Projecteer naar jaarwinst voor IB-schatting
  const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 86400000);
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const projectedProfit = dayOfYear > 30 ? Math.round(yearProfit * (daysInYear / dayOfYear)) : yearProfit;

  const ibActueel = estimateIncomeTax(yearProfit);     // op basis van YTD winst
  const ibProjected = estimateIncomeTax(projectedProfit); // schatting volledige jaar

  // BTW te reserveren = het uitgaande BTW totaal tot nu toe (we moeten dit aan Belastingdienst)
  const btwTeReserveren = vatYear.status === "fulfilled" ? Math.max(0, vatYear.value.teBetalen) : 0;

  // Besteedbaar = bank - BTW te betalen - geprojecteerde IB nog te betalen
  const bankSaldo = bank.status === "fulfilled" ? bank.value.saldo : null;
  const besteedbaar = bankSaldo !== null ? Math.round(bankSaldo - btwTeReserveren - ibProjected.totalTax) : null;

  return res.status(200).json({
    bank: bank.status === "fulfilled" ? bank.value : { saldo: null, reason: bank.reason?.message },
    btw: {
      maand: vatMonth.status === "fulfilled" ? vatMonth.value : { reason: vatMonth.reason?.message },
      kwartaal: vatQuarter.status === "fulfilled" ? vatQuarter.value : { reason: vatQuarter.reason?.message },
      jaar: vatYear.status === "fulfilled" ? vatYear.value : { reason: vatYear.reason?.message },
      teReserveren: btwTeReserveren,
    },
    ib: {
      ytdWinst: yearProfit,
      geprojecteerdeJaarwinst: projectedProfit,
      ibYtd: ibActueel,
      ibGeprojecteerd: ibProjected,
    },
    besteedbaar: {
      bankSaldo,
      minBtw: btwTeReserveren,
      minIbGeprojecteerd: ibProjected.totalTax,
      besteedbaar,
    },
    waarschuwing: "Dit zijn schattingen op basis van boekhoudkundige gegevens, geen belastingaangifte. Voor de werkelijke aangifte raadpleeg je accountant.",
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
