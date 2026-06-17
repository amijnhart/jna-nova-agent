import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// Multi-agent contentpost workflow in TWEE fases:
//
//  Fase 1 (phase: "concept"): alleen de Marketing Director werkt.
//    Hij levert: hoek, doelgroep, gewenste actie, en hoe de video er ongeveer uit ziet.
//    Het concept gaat naar de gebruiker voor akkoord.
//
//  Fase 2 (phase: "production"): pas na akkoord. Drie agents werken parallel.
//    Content Creator (caption + hashtags), Visual Director (beeldconcepten + prompts),
//    Video Director (shotlist + voice-over). Op basis van het goedgekeurde concept.
//
// Zo werkt het ook in een echt mediabureau: eerst briefing-akkoord, dan productie.

async function callAgent(client, system, user) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

const STRATEGIE = "Je bent de Marketing Director van JnA Events. Maak een KORT, helder concept voor de gevraagde post (max 8 zinnen totaal). Lever vier korte blokken: 'Hoek:' (1-2 zinnen waarom dit werkt), 'Doelgroep:' (1 zin), 'Gewenste actie:' (1 zin), 'Hoe het eruit ziet:' (2-3 zinnen die kort beschrijven wat de kijker te zien krijgt - sfeer, beeld, beweging). Schrijf in spreektaal want het wordt mogelijk voorgelezen. Geen markdown, geen sterretjes, geen emoji.";

const COPYWRITER = "Je bent de Content Creator van JnA Events. Schrijf op basis van het meegegeven concept een sterke social media caption in het Nederlands. Lever drie blokken: 'Hook:' (1 zin die scrollers stopt), 'Caption:' (max 4 zinnen, levendig), 'Hashtags:' (5-8 relevante tags zonder hekjes, gescheiden door spaties). Geen markdown.";

const VISUAL = "Je bent de Visual Director van JnA Events. Bedenk op basis van het meegegeven concept DRIE concrete visual-concepten. Voor elk: 'Concept N:' (1 zin idee), 'Prompt:' (gedetailleerde Engelse image-generation prompt, fotografisch, met licht, hoek, sfeer en compositie - geschikt voor gpt-image-1). Geen markdown.";

const REGIE = "Je bent de Video Director van JnA Events. Maak op basis van het meegegeven concept een uitvoerbaar regie-script voor een korte video (15-30 sec). Lever: 'Shotlist:' (4-6 shots, elk 1 regel: 'Shot 1: ...'), 'Voice-over of tekst-op-beeld:' (exacte zinnen). Schrijf zo dat een telefooncamera dit kan filmen. Geen markdown.";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  const apiKey = CONFIG.anthropicKey();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt." });

  try {
    const { phase, channel, topic, catalog, concept } = req.body || {};
    if (!phase || !channel || !topic) return res.status(400).json({ error: "phase, channel en topic zijn verplicht" });

    const client = new Anthropic({ apiKey });

    const catalogTekst = Array.isArray(catalog) && catalog.length
      ? "\n\nApparatuur van JnA Events die in het materiaal mag voorkomen:\n" +
        catalog.map((p) => "- " + p.name + (p.category ? " (" + p.category + ")" : "") + (p.description ? ": " + p.description : "")).join("\n")
      : "";

    // FASE 1: alleen Marketing Director
    if (phase === "concept") {
      const briefing = `Kanaal: ${channel}\nOnderwerp: ${topic}${catalogTekst}`;
      const strategie = await callAgent(client, STRATEGIE, briefing);
      return res.status(200).json({ phase: "concept", strategie });
    }

    // FASE 2: de drie productie-agents, parallel
    if (phase === "production") {
      if (!concept) return res.status(400).json({ error: "concept ontbreekt voor productie-fase" });
      const briefing = `Kanaal: ${channel}\nOnderwerp: ${topic}\n\nGoedgekeurd concept van de Marketing Director:\n${concept}${catalogTekst}`;

      const [copy, visual, regie] = await Promise.all([
        callAgent(client, COPYWRITER, briefing),
        callAgent(client, VISUAL, briefing),
        callAgent(client, REGIE, briefing),
      ]);

      const promptRegels = visual.split("\n").filter((l) => /^prompt\s*:/i.test(l.trim()));
      const imagePrompts = promptRegels.map((l) => l.replace(/^prompt\s*:\s*/i, "").trim()).filter(Boolean).slice(0, 3);

      return res.status(200).json({ phase: "production", copy, visual, regie, imagePrompts });
    }

    return res.status(400).json({ error: "Onbekende phase: " + phase });
  } catch (err) {
    console.error("Multi-agent fout:", err.message);
    return res.status(500).json({ error: "Workflow mislukte: " + (err.message || "onbekend") });
  }
}
