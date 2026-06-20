import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// De sleutel staat in de omgevingsvariabelen van Vercel (ANTHROPIC_API_KEY), nooit in de code.

const SYSTEM_PROMPT =
  "Je bent NOVA, de centrale AI-agent en coordinator van JnA Events, een Nederlands evenementenbedrijf. " +
  "Je bent aangenomen voor engineering en design en helpt de eigenaar het bedrijf te automatiseren. " +
  "Je antwoorden worden hardop voorgelezen, dus schrijf in vloeiende, natuurlijke spreektaal in volledige zinnen. " +
  "Gebruik GEEN opmaak: geen sterretjes, geen markdown, geen opsommingstekens, geen kopjes, geen emoji, geen nummering. " +
  "Hou het kort en concreet, maximaal drie tot vier zinnen tenzij om detail gevraagd. Je toon is zakelijk en strak. " +
  "WEES PROACTIEF EN ONDERSTEUNEND. Je bent er om de eigenaar te ontzorgen, dus jij neemt zelf het initiatief. " +
  "De eigenaar hoeft je NOOIT te vragen om iets te onthouden, een taak te maken of iets vast te houden. " +
  "Concludeer dat zelf en doe het in stilte. Vraag niet om bevestiging voor dit soort vanzelfsprekende ondersteuning. " +
  "Als iets later opgevolgd moet worden (bijvoorbeeld wachten op een goedkeuring), zeg je gewoon dat je het in de gaten houdt " +
  "en erop terugkomt, zonder dat de eigenaar dat hoeft te regelen. " +
  "TAKEN: als de gebruiker iets vraagt dat echt werk vereist (content maken, een plan opstellen, een strategie uitwerken, " +
  "teksten schrijven), zet je zelf een achtergrondtaak uit met een aparte regel: " +
  "TAAK: agentnaam | korte titel | wat er gemaakt moet worden. " +
  "Kies een agentnaam uit: marketing, content, strategie, whatsapp, social, planning. " +
  "Zet alleen een TAAK uit als er echt iets gemaakt moet worden, niet bij gewone vragen of uitleg. " +
  "VERBETERINGEN: als je merkt dat iets aan het systeem zelf beter, slimmer of nieuwer gebouwd zou kunnen worden " +
  "(een ontbrekende functie, een betere werkwijze, een handige uitbreiding), voeg dan een aparte regel toe: " +
  "VERBETER: korte concrete omschrijving van wat er verbeterd of toegevoegd zou moeten worden. " +
  "Doe dit uit jezelf wanneer het je opvalt, zonder dat de eigenaar erom vraagt. Maximaal een VERBETER-regel per antwoord. " +
  "Sluit je antwoord ALTIJD af met een regel: ACTIES: gevolgd door drie tot vier korte vervolgacties, gescheiden door | . " +
  "Hou elke actie onder de vijf woorden. De ACTIES-, TAAK- en VERBETER-regels worden niet voorgelezen. WHATSAPP: als de gebruiker expliciet vraagt om een WhatsApp-bericht te sturen, voeg dan een aparte regel toe: STUUR_WA: telefoonnummer | berichttekst. Het nummer moet in internationaal formaat zijn (bijv. +31612345678). Doe dit ALLEEN op directe vraag van de gebruiker. Vraag eerst om akkoord als het bericht naar een klant gaat. De STUUR_WA-regel wordt niet voorgelezen. POST-WORKFLOW: als de gebruiker vraagt om CONTENT voor een specifiek kanaal (zoals 'maak TikTok-content voor de nieuwe rookmachine' of 'maak een Instagram-post over het zomerfeest'), dan is dat geen gewone TAAK maar een volledige multi-agent workflow. Voeg in dat geval EEN aparte regel toe: POST: kanaal | onderwerp in 1 zin. Voorbeeld: POST: tiktok | nieuwe rookmachine in actie tijdens een event. Gebruik POST ALLEEN voor complete contentposts (tekst+beeld+regie samen), niet voor alleen tekst. De POST-regel wordt niet voorgelezen. Als de gebruiker vraagt om content in te plannen of op een bepaald moment te posten, voeg dan een aparte regel toe: PLAN: kanaal | titel | ISO-datumtijd | korte omschrijving. Kies kanaal uit: tiktok, instagram, facebook, social. Gebruik voor de datumtijd het formaat JJJJ-MM-DDTHH:MM. Stel een logisch optimaal tijdstip voor als de gebruiker geen tijd noemt. De PLAN-regel wordt niet voorgelezen. SPRAAKTEMPO: als de gebruiker vraagt om sneller, langzamer, of normaler te praten (of om je stem aan/uit te zetten), voeg dan een aparte regel toe: STEM: rate=NUMMER of STEM: aan / STEM: uit. NUMMER is tussen 0.7 (heel traag) en 1.5 (vlot). Voorbeeld: STEM: rate=1.15 wanneer gevraagd 'praat wat sneller'. Hou dat tempo dan vast voor volgende antwoorden. De STEM-regel wordt niet voorgelezen. STATUS: als de gebruiker vraagt welke integraties actief zijn ('wat is er gekoppeld', 'controleer integraties', 'status'), reageer dan met de live status die meegestuurd is in de context. De STATUS wordt automatisch bij elk gesprek meegestuurd zodat je het weet.";

const WORKER_PROMPT =
  "Je bent een gespecialiseerde agent van JnA Events. Voer de opdracht volledig en concreet uit. " +
  "Lever direct bruikbaar resultaat. Schrijf in helder Nederlands. Geen voorwoord of excuses, lever gewoon het werk.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST" });
  }

  // Toegangscontrole: alleen ingelogde bezoekers mogen Claude aanroepen.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) {
    return res.status(401).json({ error: "Niet ingelogd. Log opnieuw in." });
  }

  const apiKey = CONFIG.anthropicKey();
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY ontbreekt in Vercel.");
    return res.status(500).json({
      error: "API-sleutel niet gevonden. Voeg ANTHROPIC_API_KEY toe in Vercel en deploy opnieuw zonder build-cache.",
    });
  }

  try {
    const { messages, mode, integrations, voiceRate, emails, boeksy, lastViewed, snippets, files } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages ontbreekt" });
    }
    const anthropic = new Anthropic({ apiKey });
    let system = mode === "worker" ? WORKER_PROMPT : SYSTEM_PROMPT;
    // Productcatalogus meegeven zodat NOVA de apparatuur van JnA Events kent.
    if (Array.isArray(req.body.catalog) && req.body.catalog.length) {
      const lijst = req.body.catalog
        .map((p) => "- " + p.name + (p.category ? " (" + p.category + ")" : "") + (p.description ? ": " + p.description : ""))
        .join("\n");
      system += " De apparatuur en het materieel van JnA Events (gebruik dit bij aankondigingen en content): \n" + lijst;
    }
    // Live integratie-status meegeven zodat NOVA hier eerlijk over kan praten.
    if (integrations && typeof integrations === "object") {
      const isActive = (v) => v === true || (v && typeof v === "object" && v.active === true);
      const lijn = (k, label) => label + ": " + (isActive(integrations[k]) ? "ACTIEF" : "niet gekoppeld");
      system += "\n\nLive status van koppelingen (gebruik DEZE waarheid bij vragen over status, niet je eigen aannames): " +
        [lijn("mail", "E-mail"), lijn("whatsapp", "WhatsApp"), lijn("images", "AI-beeldgeneratie"), lijn("storage", "Persistente opslag")].join(", ") + ".";
    }
    if (typeof voiceRate === "number") {
      system += " Huidig spraaktempo van NOVA: " + voiceRate.toFixed(2) + "x. Bij commando 'sneller' verhoog je met 0.10, bij 'langzamer' verlaag je met 0.10, bij 'normaal' zet je terug op 1.05. Houd waarde tussen 0.7 en 1.5.";
    }
    // Recente e-mails uit de inbox als context meegeven zodat NOVA de inhoud kent
    // en kan voorlezen, samenvatten of beantwoorden zonder telkens te zeggen dat de
    // koppeling niet actief is.
    if (Array.isArray(emails) && emails.length > 0) {
      const lijst = emails.slice(0, 20).map((m, i) => {
        const datum = m.received ? new Date(m.received).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" }) : "";
        const tags = [m.unread ? "ongelezen" : "gelezen", m.urgent ? "URGENT" : ""].filter(Boolean).join(", ");
        return `${i + 1}. Van: ${m.from || "onbekend"} | Onderwerp: ${m.subject || "(geen)"} | ${datum} | ${tags}\n   Voorbeschouwing: ${m.snippet || "(leeg)"}`;
      }).join("\n");
      system += `\n\nDe inbox van JnA Events is LIVE GEKOPPELD en de volgende ${emails.length} recente e-mails zijn beschikbaar als jouw werkelijkheid. Gebruik DEZE lijst bij vragen over e-mail, niet je eigen aannames. Wanneer de gebruiker vraagt om een mail voor te lezen, lees het onderwerp uit, vermeld de afzender, en lees vervolgens de voorbeschouwing. Wees natuurlijk in je spraak en kort. Als de gebruiker vraagt om een samenvatting, vat de inbox samen in 2-3 zinnen met de belangrijkste afzenders en onderwerpen. Beweer NOOIT dat de koppeling niet actief is - die is wel actief, dit is de bewijslast:\n${lijst}`;
    }

    // Boeksy boekhouding als context: klanten, facturen, offertes, W&V.
    // NOVA mag hierover praten alsof zij toegang heeft, want die heeft ze (read-only).
    if (boeksy && typeof boeksy === "object") {
      let blok = "\n\nDe Boeksy-boekhouding van JnA Events is LIVE GEKOPPELD (alleen-lezen). Bij vragen over klanten, omzet, facturen, offertes, gebruik DEZE gegevens als waarheid. Wees concreet met namen en bedragen. Beweer NOOIT dat de koppeling niet actief is.";
      if (Array.isArray(boeksy.relations) && boeksy.relations.length) {
        blok += `\n\nKlanten en leveranciers (${boeksy.relations.length}):\n` + boeksy.relations.slice(0, 30).map((r) => `- ${r.name}${r.type ? ` (${r.type})` : ""}${r.email ? ` · ${r.email}` : ""}`).join("\n");
      }
      if (Array.isArray(boeksy.invoices) && boeksy.invoices.length) {
        blok += `\n\nRecente facturen (${boeksy.invoices.length}):\n` + boeksy.invoices.slice(0, 15).map((i) => `- ${i.number || "concept"} | ${i.date || ""} | ${i.klant || ""} | ${i.subject || ""} | ${i.total ? `€${i.total}` : ""} | ${i.status || ""}`).join("\n");
      }
      if (Array.isArray(boeksy.quotes) && boeksy.quotes.length) {
        blok += `\n\nRecente offertes (${boeksy.quotes.length}):\n` + boeksy.quotes.slice(0, 15).map((q) => `- ${q.number || "concept"} | ${q.date || ""} | ${q.klant || ""} | ${q.subject || ""} | ${q.total ? `€${q.total}` : ""} | ${q.status || ""}`).join("\n");
      }
      if (boeksy.profitLoss) {
        blok += `\n\nWinst- en verliesrekening lopend kwartaal (samengevat): ${JSON.stringify(boeksy.profitLoss).slice(0, 600)}`;
      }
      if (Array.isArray(boeksy.events) && boeksy.events.length) {
        blok += `\n\nKomende events uit Boeksy (offertes/facturen met event_date) - dit zijn dagen waar JnA Events op locatie werkt en content kan maken:\n` + boeksy.events.slice(0, 15).map((e) => {
          const d = new Date(e.date);
          const dStr = isNaN(d.getTime()) ? e.date : d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
          return `- ${dStr} | ${e.klant || "?"} | ${e.subject || ""} | status: ${e.status || "?"}`;
        }).join("\n");
        blok += `\n\nWanneer de gebruiker over een aankomende gig vraagt of jij wilt voorstellen wat te doen op een datum, gebruik deze events. Stel proactief content-acties voor: 4 dagen ervoor een aankondiging, 2 dagen ervoor een teaser, op de dag zelf on-site footage maken, 2 dagen erna een recap.`;
      }
      if (Array.isArray(boeksy.followUps) && boeksy.followUps.length) {
        blok += `\n\nOffertes die mogelijk follow-up nodig hebben (open, ouder dan 14 dagen):\n` + boeksy.followUps.slice(0, 10).map((f) => `- offerte ${f.number || "concept"} aan ${f.klant} voor ${f.subject} - ${f.daysOpen} dagen oud${f.total ? ", € " + f.total : ""}`).join("\n");
        blok += `\n\nALs de gebruiker hierover vraagt, signaleer welke offertes het oudst zijn. Stel NIET voor om automatisch te mailen - Boeksy heeft daar een eigen functie voor. Als hij vraagt om een follow-up tekst, help dan met een conceptmail die hij zelf kan versturen via Boeksy of zijn mailprogramma.`;
      }
      blok += "\n\nJe KUNT nu ook offertes en facturen aanmaken als concept in Boeksy via een goedkeur-flow. Wanneer de gebruiker vraagt om een offerte te maken, geef in je antwoord op een aparte regel: OFFERTE: relation_naam | onderwerp | event_datum YYYY-MM-DD (of leeg) | omschrijving1@aantal@prijs@btw% | omschrijving2@aantal@prijs@btw% (regels gescheiden door %%). Voorbeeld: 'OFFERTE: Acme BV | Bruiloft 15 juli | 2026-07-15 | DJ-set 5 uur@5@150@21%%Geluidset huur@1@200@21'. De gebruiker krijgt dan een preview en kan goedkeuren voor het naar Boeksy gaat.";
      system += blok;
    }

    // Context: wat de gebruiker net heeft bekeken (verbeterpunt P)
    if (lastViewed && typeof lastViewed === "object") {
      system += `\n\nDe gebruiker heeft net bekeken: ${lastViewed.type} - ${lastViewed.label}. Verwijzingen als "die offerte" of "die mail" of "dat" mogen op dit item slaan tenzij context anders aangeeft. Detail: ${JSON.stringify(lastViewed.data).slice(0, 500)}`;
    }

    // Bedrijfsdocumenten: tekst-snippets (kleurpalet, NAW, BTW etc.)
    if (Array.isArray(snippets) && snippets.length) {
      let snipBlok = "\n\nBEDRIJFSGEGEVENS - gebruik deze bij visual-prompts, offertes, mails en alle communicatie:";
      for (const s of snippets) {
        snipBlok += `\n- ${s.label} (${s.category}): ${s.value}`;
      }
      system += snipBlok;
    }

    // Bedrijfsdocumenten: bestanden (PDF rider, handleiding, logo, handtekening)
    if (Array.isArray(files) && files.length) {
      let fileBlok = "\n\nBEDRIJFSDOCUMENTEN - deze bestanden zijn beschikbaar om naar klanten te sturen:";
      for (const f of files) {
        fileBlok += `\n- ${f.label} (${f.category}): ${f.filename}`;
      }
      fileBlok += "\n\nWanneer een klant om een rider, handleiding, logo of ander document vraagt: noem het op een aparte regel als: DOCUMENT: bestandsnaam | optionele toelichting. De gebruiker krijgt dan een knop om het document direct naar de klant te sturen.";
      system += fileBlok;
    }
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const reply = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    res.status(200).json({ reply });
  } catch (err) {
    console.error("Anthropic fout:", err.status || "", err.message);
    res.status(500).json({ error: "AI-brein onbereikbaar: " + (err.message || "onbekende fout") });
  }
}
