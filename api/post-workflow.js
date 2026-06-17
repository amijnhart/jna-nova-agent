import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// Multi-agent workflow voor een complete social media post.
//
// Hoe het werkt:
//   1. Frontend stuurt een briefing: kanaal, onderwerp, productcatalogus.
//   2. Deze backend roept VIER gespecialiseerde agents parallel aan via Claude:
//      - strategie-agent (hoek + doelgroep + call-to-action)
//      - copywriter-agent (caption, hashtags, opening hook)
//      - visual-agent (concrete beeldconcepten + image prompts)
//      - regie-agent (videoscript + shotlist als het video-content is)
//   3. Alle resultaten komen samen terug naar de frontend, die ze toont in
//      een postcard waar jij ze ziet, kunt aanpassen of laten regenereren.
//
// Belangrijk: we genereren GEEN beelden in deze stap (te duur, jij beslist
// wanneer). De visual-agent levert prompts; jij klikt later om er beelden
// uit te genereren.

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

const STRATEGIE = "Je bent de Marketing Director van JnA Events. Bepaal voor de gevraagde post: de strategische hoek (waarom werkt dit), de doelgroep (kort, concreet), en de gewenste actie van de kijker. Antwoord in drie korte alinea's met de kopjes 'Hoek:', 'Doelgroep:', 'Gewenste actie:'. Geen markdown, geen sterretjes.";

const COPYWRITER = "Je bent de Content Creator van JnA Events. Schrijf een sterke social media caption in het Nederlands voor het gevraagde kanaal. Begin met een opening hook die scrollers stopt. Hou het kort en levendig. Eindig met een duidelijke call-to-action. Lever drie blokken: 'Hook:' (1 zin), 'Caption:' (max 4 zinnen), 'Hashtags:' (5-8 relevante tags zonder hekjes, gescheiden door spaties). Geen markdown.";

const VISUAL = "Je bent de Visual Director van JnA Events. Bedenk voor de gevraagde post DRIE concrete visual-concepten die opvallen op het gekozen kanaal. Voor elk concept lever je: 'Concept N:' (1 zin idee), gevolgd door 'Prompt:' (een gedetailleerde Engelse image-generation prompt, fotografisch, met licht, hoek, sfeer en compositie - geschikt voor gpt-image-1). Geen markdown.";

const REGIE = "Je bent de Video Director van JnA Events. Maak een uitvoerbaar regie-script voor een korte video (15-30 seconden) over het gevraagde onderwerp, geschikt voor het gekozen kanaal. Lever: 'Concept:' (1 zin), 'Shotlist:' (4-6 shots, elk 1 regel: 'Shot 1: ...'), 'Voice-over of tekst-op-beeld:' (de exacte zinnen). Schrijf zo dat een telefooncamera dit kan filmen. Geen markdown.";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  const apiKey = CONFIG.anthropicKey();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt." });

  try {
    const { channel, topic, catalog } = req.body || {};
    if (!channel || !topic) return res.status(400).json({ error: "channel en topic zijn verplicht" });

    const client = new Anthropic({ apiKey });

    // Context die elke agent meekrijgt
    const catalogTekst = Array.isArray(catalog) && catalog.length
      ? "\n\nApparatuur van JnA Events die in het materiaal mag voorkomen:\n" +
        catalog.map((p) => "- " + p.name + (p.category ? " (" + p.category + ")" : "") + (p.description ? ": " + p.description : "")).join("\n")
      : "";

    const briefing = `Kanaal: ${channel}\nOnderwerp: ${topic}${catalogTekst}`;

    // Vier agents parallel laten denken
    const [strategie, copy, visual, regie] = await Promise.all([
      callAgent(client, STRATEGIE, briefing),
      callAgent(client, COPYWRITER, briefing),
      callAgent(client, VISUAL, briefing),
      callAgent(client, REGIE, briefing),
    ]);

    // Visual-prompts uit het visual-blok halen voor latere beeldgeneratie
    const promptRegels = visual.split("\n").filter((l) => /^prompt\s*:/i.test(l.trim()));
    const imagePrompts = promptRegels.map((l) => l.replace(/^prompt\s*:\s*/i, "").trim()).filter(Boolean).slice(0, 3);

    return res.status(200).json({
      channel,
      topic,
      strategie,
      copy,
      visual,
      regie,
      imagePrompts,
      created: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Multi-agent fout:", err.message);
    return res.status(500).json({ error: "Workflow mislukte: " + (err.message || "onbekend") });
  }
}
