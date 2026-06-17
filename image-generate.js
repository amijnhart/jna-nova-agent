import { verifyToken } from "./_auth.js";
import { CONFIG } from "./_config.js";

// AI-beeldgeneratie via OpenAI's gpt-image-1 (opvolger van DALL-E).
//
// VEILIGHEID: dit endpoint genereert beelden die GELD KOSTEN per stuk
// (4-20 cent afhankelijk van kwaliteit). Daarom:
//   - alleen aanroepbaar door ingelogde gebruikers
//   - alleen via expliciete user-actie in de UI (niet automatisch door NOVA)
//   - retourneert de afbeelding als base64 zodat hij niet ergens blijft hangen
//     waar iemand 'm onbedoeld opnieuw genereert.

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  if (!CONFIG.hasImageGen()) {
    return res.status(503).json({
      error: "Beeldgeneratie niet gekoppeld",
      hint: "Voeg OPENAI_API_KEY toe in Vercel Environment Variables (zie Setup-checklist).",
    });
  }

  try {
    const { prompt, size = "1024x1024", quality = "medium" } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt ontbreekt" });
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: CONFIG.openaiKey() });

    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt: prompt.trim(),
      size, // 1024x1024 (vierkant), 1024x1536 (verticaal), 1536x1024 (horizontaal)
      quality, // low / medium / high
      n: 1,
    });

    const b64 = response.data[0].b64_json;
    if (!b64) return res.status(500).json({ error: "Geen beeld ontvangen" });

    return res.status(200).json({
      image: `data:image/png;base64,${b64}`,
      prompt: prompt.trim(),
      size,
      quality,
    });
  } catch (err) {
    console.error("Beeldgeneratie fout:", err.message);
    return res.status(500).json({ error: "Beeldgeneratie mislukte: " + (err.message || "onbekend") });
  }
}
