import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";

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
  "Hou elke actie onder de vijf woorden. De ACTIES-, TAAK- en VERBETER-regels worden niet voorgelezen.";

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY ontbreekt in Vercel.");
    return res.status(500).json({
      error: "API-sleutel niet gevonden. Voeg ANTHROPIC_API_KEY toe in Vercel en deploy opnieuw zonder build-cache.",
    });
  }

  try {
    const { messages, mode } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages ontbreekt" });
    }
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: mode === "worker" ? WORKER_PROMPT : SYSTEM_PROMPT,
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
