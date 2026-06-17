import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// De API-sleutel staat ALLEEN hier, serverside, in je .env bestand. Nooit in de browser.
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


// Splitst de ACTIES-regel af van het gesproken antwoord.
function splitActions(raw) {
  const lines = raw.split("\n");
  let actions = [];
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^\s*ACTIES\s*:\s*(.+)$/i);
    if (m) {
      actions = m[1]
        .split("|")
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 4);
    } else {
      kept.push(line);
    }
  }
  return { reply: kept.join("\n").trim(), actions };
}

app.post("/api/chat", async (req, res) => {
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
    res.json({ reply, actions });
  } catch (err) {
    console.error("Anthropic fout:", err.message);
    res.status(500).json({ error: "AI-brein onbereikbaar" });
  }
});

// In productie serveert deze server ook de gebouwde frontend op /agent
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`NOVA backend draait op poort ${PORT}`);
  console.log(`Frontend (na 'npm run build') op http://localhost:${PORT}`);
});
