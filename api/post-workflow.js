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

// MERK-KENNIS — komt in elke agent-prompt zodat ze JnA Events kennen.
// Dit is variant 1 van "betere agents": uitgebreide context per oproep.
const JNA_MERK = `
OVER JNA EVENTS
- Eenmanszaak (Tilburg), DJ + apparatuur-verhuur voor bruiloften, bedrijfsfeesten, verjaardagen en feesten
- Eigen materieel: Pioneer DDJ-FLX10, lichtbrug 3m met 4 moving heads, RGB Ibiza 1000 laser, 2 ground PARs, 2 draadloze PARs, rookmachine, geluidssysteem 2x18" subs + 2x15" tops
- Stijl: professioneel maar warm, gericht op een onvergetelijke ervaring
- Niet club-DJ-pretenties, wél hoogwaardige sfeer op locatie
- Doelgroep: bruidsparen, eventorganisatoren, bedrijven met personeelsfeesten in Brabant/regio

TONE OF VOICE
- Spreektaal, persoonlijk, geen jargon
- Enthousiast over de sfeer, niet over de techniek (techniek is middel)
- Korte zinnen, levendig
- Geen overdreven sterretjes of emoji-spam
- Werk in 'je'-vorm naar de lezer toe`;

const VISUAL_STIJL = `
VISUELE STIJL VOOR BEELDEN EN VIDEO
- Cinematic, sfeervol, low-light met statement-lichteffecten
- Veel rook + kleurig licht (paars, cyaan, amber)
- Camera laag bij de dansvloer of vanaf de DJ-booth POV
- Mensen in beweging - geen geposeerde foto's
- Avond en nacht setting, behalve bij bruiloft-overdag content
- Lichtbrug, lasers en moving heads zijn herkenbare elementen van JnA's setup
- Kleurpalet match: turquoise (#09A5CB) en donker (#093239) voor merk-consistente captions/overlays`;

const STRATEGIE = `Je bent de Marketing Director van JnA Events.
${JNA_MERK}

Maak een KORT, helder concept voor de gevraagde post (max 8 zinnen totaal). Lever vier korte blokken:
- 'Hoek:' (1-2 zinnen waarom dit werkt en welk gevoel je triggert)
- 'Doelgroep:' (1 zin - specifiek, niet 'iedereen')
- 'Gewenste actie:' (1 zin - liken/volgen/DM-en/boeken)
- 'Hoe het eruit ziet:' (2-3 zinnen die kort beschrijven wat de kijker te zien krijgt - sfeer, beeld, beweging)

Schrijf in spreektaal want het wordt mogelijk voorgelezen. Geen markdown, geen sterretjes, geen emoji.
Denk vanuit: 'wat zou een bruidspaar of bedrijfsfeest-organisator overtuigen om JnA te boeken?'`;

const COPYWRITER = `Je bent de Content Creator van JnA Events.
${JNA_MERK}

Schrijf op basis van het meegegeven concept een sterke social media caption in het Nederlands. Lever drie blokken:
- 'Hook:' (1 zin die scrollers stopt - meestal een spannende observatie, vraag, of belofte. GEEN 'check dit!' of 'kijk eens')
- 'Caption:' (max 4 zinnen, levendig, persoonlijk - lijkt alsof Jordi het zelf zegt)
- 'Hashtags:' (5-8 relevante tags zonder hekjes, gescheiden door spaties)

Mix algemene hashtags (bruiloft, feest, event) met lokale (Tilburg, Brabant, Noord-Brabant) en niche (DJlife, weddingdj). Geen markdown.`;

const VISUAL = `Je bent de Visual Director van JnA Events.
${JNA_MERK}
${VISUAL_STIJL}

Bedenk op basis van het meegegeven concept DRIE concrete visual-concepten. Voor elk:
- 'Concept N:' (1 zin idee in het Nederlands)
- 'Prompt:' (gedetailleerde Engelse image-generation prompt, fotografisch, met licht, hoek, sfeer en compositie - geschikt voor gpt-image-1)

In elke prompt:
- specificeer cinematic lighting met colored stage lights
- vermeld 'professional event photography' of 'concert photography style'
- benoem licht-kleur, sfeer, beweging
- voor bruiloft: warmer licht; voor club/feest: paars/cyaan
- voor materieel-shots: detail van moving heads, lichtbrug of rookmachine in actie

Geen markdown.`;

const REGIE = `Je bent de Video Director van JnA Events.
${JNA_MERK}
${VISUAL_STIJL}

Maak op basis van het meegegeven concept een uitvoerbaar regie-script voor een korte video (15-30 sec). Lever:
- 'Shotlist:' (4-6 shots, elk 1 regel: 'Shot 1: [shot type] - [wat - bv close-up moving head, wide shot dansvloer] - [duur in sec]')
- 'Voice-over of tekst-op-beeld:' (exacte zinnen, kort - max 2 regels per shot)
- 'Muziek-suggestie:' (genre/stijl/BPM die past)

Schrijf zo dat een telefooncamera dit kan filmen (iPhone met OIS). Geen drones tenzij specifiek voor outdoor. Geen markdown.`;

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST" });

  const apiKey = CONFIG.anthropicKey();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt." });

  try {
    const { phase, channel, topic, catalog, concept, snippets, eventContext } = req.body || {};
    if (!phase || !channel || !topic) return res.status(400).json({ error: "phase, channel en topic zijn verplicht" });

    const client = new Anthropic({ apiKey });

    const catalogTekst = Array.isArray(catalog) && catalog.length
      ? "\n\nApparatuur van JnA Events die in het materiaal mag voorkomen:\n" +
        catalog.map((p) => "- " + p.name + (p.category ? " (" + p.category + ")" : "") + (p.description ? ": " + p.description : "")).join("\n")
      : "";

    // Bedrijfssnippets: kleurpalet, tone-of-voice, NAW etc. die de gebruiker
    // zelf heeft opgeslagen in de Documenten-module.
    const snippetTekst = Array.isArray(snippets) && snippets.length
      ? "\n\nAanvullende bedrijfsgegevens (door eigenaar opgegeven):\n" +
        snippets.map((s) => `- ${s.label}: ${String(s.value).slice(0, 300)}`).join("\n")
      : "";

    // Event-context: als deze post bij een specifiek event hoort, geef datum + klant
    const eventTekst = eventContext && typeof eventContext === "object"
      ? `\n\nDeze post hoort bij een aankomend event op ${eventContext.date} voor ${eventContext.klant || "een klant"}${eventContext.subject ? ` (${eventContext.subject})` : ""}. Verwerk dat impliciet in de hoek (bijvoorbeeld: 'volgende week vrijdag op dit bedrijfsfeest...').`
      : "";

    const extraContext = catalogTekst + snippetTekst + eventTekst;

    // FASE 1: alleen Marketing Director
    if (phase === "concept") {
      const briefing = `Kanaal: ${channel}\nOnderwerp: ${topic}${extraContext}`;
      const strategie = await callAgent(client, STRATEGIE, briefing);
      return res.status(200).json({ phase: "concept", strategie });
    }

    // FASE 2: de drie productie-agents, parallel
    if (phase === "production") {
      if (!concept) return res.status(400).json({ error: "concept ontbreekt voor productie-fase" });
      const briefing = `Kanaal: ${channel}\nOnderwerp: ${topic}\n\nGoedgekeurd concept van de Marketing Director:\n${concept}${extraContext}`;

      const [copy, visual, regie] = await Promise.all([
        callAgent(client, COPYWRITER, briefing),
        callAgent(client, VISUAL, briefing),
        callAgent(client, REGIE, briefing),
      ]);

      const promptRegels = visual.split("\n").filter((l) => /^prompt\s*:/i.test(l.trim()));
      const imagePrompts = promptRegels.map((l) => l.replace(/^prompt\s*:\s*/i, "").trim()).filter(Boolean).slice(0, 3);

      return res.status(200).json({ phase: "production", copy, visual, regie, imagePrompts });
    }

    // FASE 3: een specialist herzien op basis van gebruikersfeedback
    if (phase === "revise") {
      const { role, feedback, concept, currentOutput } = req.body || {};
      if (!role || !feedback) return res.status(400).json({ error: "role en feedback zijn verplicht voor herziening" });

      // Marketing kijkt eerst of de feedback ook impact heeft op de andere specialisten
      const checkSystem = "Je bent de Marketing Director van JnA Events. Een gebruiker geeft feedback op het werk van een van je specialisten. Beoordeel kort of deze feedback ALLEEN impact heeft op die ene specialist, of dat ook de andere specialisten hun werk moeten aanpassen. Antwoord met EXACT één van: 'ALLEEN_DEZE' of 'OOK_ANDEREN: ...'(daarna kort welke en waarom, max 1 zin per specialist). Geen verdere tekst.";
      const checkInput = `Goedgekeurd concept:\n${concept}\n\nSpecialist die feedback krijgt: ${role}\nHuidige output van die specialist:\n${currentOutput}\n\nFeedback van de gebruiker:\n${feedback}`;
      let impactCheck = "ALLEEN_DEZE";
      try { impactCheck = await callAgent(client, checkSystem, checkInput); } catch { /* gebruik default */ }

      // De specialist herziet zijn werk
      const specialistSystem = role === "content" ? COPYWRITER : role === "visual" ? VISUAL : role === "video" ? REGIE : COPYWRITER;
      const reviseInput = `Goedgekeurd concept van de Marketing Director:\n${concept}${extraContext}\n\nJe vorige opzet was:\n${currentOutput}\n\nDe gebruiker geeft de volgende feedback. Pas je werk daarop aan en lever de complete nieuwe versie in hetzelfde formaat als voorheen.\n\nFeedback: ${feedback}`;
      const newOutput = await callAgent(client, specialistSystem, reviseInput);

      // Als impact ook anderen raakt, herzien we hen ook (parallel)
      const otherUpdates = {};
      if (impactCheck.startsWith("OOK_ANDEREN")) {
        const others = ["content", "visual", "video"].filter((r) => r !== role);
        const results = await Promise.all(others.map(async (otherRole) => {
          const sys = otherRole === "content" ? COPYWRITER : otherRole === "visual" ? VISUAL : REGIE;
          const inp = `Goedgekeurd concept van de Marketing Director:\n${concept}${extraContext}\n\nEr is een wijziging doorgevoerd in het werk van de ${role}-specialist op basis van gebruikersfeedback: "${feedback}". Pas jouw werk hier op aan en lever de complete nieuwe versie. Marketing's analyse: ${impactCheck}`;
          try { return [otherRole, await callAgent(client, sys, inp)]; }
          catch (e) { return [otherRole, null]; }
        }));
        results.forEach(([r, out]) => { if (out) otherUpdates[r] = out; });
      }

      // Extract nieuwe image prompts als visual is bijgewerkt
      let newImagePrompts = null;
      const visualOutput = role === "visual" ? newOutput : otherUpdates.visual;
      if (visualOutput) {
        const promptRegels = visualOutput.split("\n").filter((l) => /^prompt\s*:/i.test(l.trim()));
        newImagePrompts = promptRegels.map((l) => l.replace(/^prompt\s*:\s*/i, "").trim()).filter(Boolean).slice(0, 3);
      }

      return res.status(200).json({
        phase: "revised",
        role,
        newOutput,
        otherUpdates,
        impactCheck,
        marketingNote: impactCheck.startsWith("OOK_ANDEREN") ? impactCheck.replace(/^OOK_ANDEREN:?\s*/, "") : null,
        newImagePrompts,
      });
    }

    return res.status(400).json({ error: "Onbekende phase: " + phase });
  } catch (err) {
    console.error("Multi-agent fout:", err.message);
    return res.status(500).json({ error: "Workflow mislukte: " + (err.message || "onbekend") });
  }
}
