import Anthropic from "@anthropic-ai/sdk";

// Serverless variant voor Vercel/Netlify. De sleutel staat in de omgevingsvariabelen
// van je hostingplatform (Settings > Environment Variables), nooit in de code.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  "Je bent NOVA, de centrale AI-agent en coordinator van JnA Events, een Nederlands evenementenbedrijf. " +
  "Je bent aangenomen voor engineering en design en helpt de eigenaar het bedrijf te automatiseren: content maken, " +
  "social media plannen, strategie bepalen en agents aansturen (marketing, content, strategie, WhatsApp). " +
  "BELANGRIJK voor spraak: je antwoorden worden hardop voorgelezen. Schrijf daarom in vloeiende, natuurlijke spreektaal. " +
  "Gebruik GEEN opmaak: geen sterretjes, geen markdown, geen opsommingstekens, geen kopjes, geen emoji, geen nummering. " +
  "Schrijf in volledige, lopende zinnen alsof je het hardop zegt. Hou het kort en concreet, maximaal drie tot vier zinnen " +
  "tenzij om detail gevraagd. Je toon is zakelijk en strak, beleefd en to-the-point, zonder overbodige uitweidingen. " +
  "Je ontzorgt de gebruiker volledig. Als iets een koppeling nodig heeft (Anthropic API, WhatsApp Business, Meta of Instagram) " +
  "leg je in een korte zin uit wat je nodig hebt. Sluit je antwoord ALTIJD af met een aparte regel die begint met ACTIES: gevolgd door drie tot vier korte vervolgacties die de gebruiker logisch zou kunnen kiezen, gescheiden door een verticale streep. Voorbeeld: ACTIES: Maak een Instagram post | Plan voor vrijdag | Toon de strategie. Hou elke actie onder de vijf woorden en formuleer ze als een opdracht. Deze ACTIES-regel wordt niet voorgelezen, alleen de zinnen ervoor.";


function splitActions(raw) {
  const lines = raw.split("\n");
  let actions = [];
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^\s*ACTIES\s*:\s*(.+)$/i);
    if (m) {
      actions = m[1].split("|").map((a) => a.trim()).filter(Boolean).slice(0, 4);
    } else {
      kept.push(line);
    }
  }
  return { reply: kept.join("\n").trim(), actions };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST" });
  }
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages ontbreekt" });
    }
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const raw = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    const { reply, actions } = splitActions(raw);
    res.status(200).json({ reply, actions });
  } catch (err) {
    console.error("Anthropic fout:", err.message);
    res.status(500).json({ error: "AI-brein onbereikbaar" });
  }
}
