import { verifyToken } from "./_auth.js";

// Text-to-Speech via OpenAI.
// Genereert een MP3 voor een gegeven tekst en stem-naam.
// Kost ongeveer $0.015 per 1000 karakters voor de basis-stem,
// of $0.030 per 1000 karakters voor de HD-stem.
//
// Vereist environment variable: OPENAI_API_KEY (gedeeld met image-generate).
//
// Beschikbare OpenAI stemmen (multilingual, kunnen Nederlands):
//   alloy, echo, fable, onyx, nova, shimmer, ash, sage, coral

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "TTS niet geactiveerd. Voeg OPENAI_API_KEY toe als environment-variable in Vercel." });
  }

  try {
    const { text, voice = "nova", model = "tts-1" } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json({ error: "tekst ontbreekt" });
    // Limiet om kosten te beperken: max 4000 karakters per uitspraak
    const safeText = text.slice(0, 4000);

    const openaiResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,             // 'tts-1' (snel/goedkoop) of 'tts-1-hd' (hogere kwaliteit)
        voice,             // alloy, echo, fable, onyx, nova, shimmer, ash, sage, coral
        input: safeText,
        response_format: "mp3",
        // Speed 1.1 = iets sneller dan natuurlijk. Op mobiel voelt dat reactiever
        // en het verhoogt het tempo dus minder lange wachttijd.
        speed: 1.1,
      }),
    });

    if (!openaiResponse.ok) {
      let detail = "";
      try { const j = await openaiResponse.json(); detail = j.error?.message || ""; } catch { /* ignore */ }
      return res.status(500).json({ error: "OpenAI TTS-fout: " + (detail || openaiResponse.statusText) });
    }

    // Stream de MP3 terug naar de browser
    const buffer = Buffer.from(await openaiResponse.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length.toString());
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("TTS fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
