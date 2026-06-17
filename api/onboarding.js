import { verifyToken } from "./_auth.js";
import { readData, writeData, KEYS, CONFIG } from "./_config.js";

// Onboarding-checklist voor nieuwe koppelingen.
//
// De checklist zelf staat hier vast: dit is de bron van waarheid voor welke
// stappen er nodig zijn per integratie. De voortgang (welke stappen al gedaan
// zijn) wordt blijvend bewaard via _config.js.
//
// Toegevoegde waarde voor de eigenaar: zo zie je bij elke koppeling exact wat
// er nodig is, in welke volgorde, en wat er nog ontbreekt - in plaats van het
// in losse berichten te moeten uitzoeken.

const CHECKLISTS = {
  whatsapp: {
    title: "WhatsApp Business",
    intent: "Berichten ontvangen en automatisch beantwoorden via WhatsApp.",
    steps: [
      { id: "wa-1", title: "WhatsApp Business account aanmaken", help: "Ga naar business.whatsapp.com en maak een zakelijk account aan met een nummer dat NOG NIET in de gewone WhatsApp gebruikt wordt." },
      { id: "wa-2", title: "Provider kiezen: Twilio of 360dialog", help: "Twilio is bekender en heeft een Nederlandse interface. 360dialog is goedkoper voor hoge volumes. Voor JnA Events is Twilio het meest praktisch." },
      { id: "wa-3", title: "Account aanmaken bij de gekozen provider", help: "Bij Twilio: ga naar twilio.com, maak een account, en activeer WhatsApp Sender (Console > Messaging > WhatsApp)." },
      { id: "wa-4", title: "Sender goedkeuring afwachten", help: "Meta keurt elke afzender handmatig goed. Duurt meestal 1-3 dagen. Tot dan kun je alleen testen." },
      { id: "wa-5", title: "API-sleutel toevoegen in Vercel", help: "Eenmaal goedgekeurd: zet WHATSAPP_TOKEN in Vercel (Settings > Environment Variables) met de access token van Twilio of 360dialog." },
      { id: "wa-6", title: "Test bericht versturen", help: "Vraag NOVA om een testbericht te sturen naar jouw eigen WhatsApp. Werkt dat, dan is de koppeling actief." },
    ],
  },
  email: {
    title: "E-mail koppeling (Hostinger / IMAP)",
    intent: "Inkomende e-mails laten lezen en beantwoorden door NOVA.",
    steps: [
      { id: "em-1", title: "Open hPanel van Hostinger", help: "Ga naar hpanel.hostinger.com en log in. Klik bij jna-events.nl op 'Beheer' en daarna in het menu links op 'E-mail accounts'." },
      { id: "em-2", title: "Open instellingen van info@jna-events.nl", help: "Klik in de lijst op 'info@jna-events.nl' en daarna op 'Configuratie-instellingen' of 'IMAP/POP3 instellingen'. Noteer de IMAP-server, dat is meestal imap.hostinger.com." },
      { id: "em-3", title: "Maak in Hostinger een NIEUW app-wachtwoord aan", help: "Belangrijk: gebruik NIET je gewone wachtwoord. Klik bij het account op 'Wachtwoord wijzigen' OF gebruik een aparte 'App-wachtwoord' optie als die er staat. Maak een lang willekeurig wachtwoord aan dat je alleen voor NOVA gebruikt. Bewaar het ergens veilig - je hebt het zo nodig." },
      { id: "em-4", title: "Voeg de drie sleutels toe in Vercel", help: "In Vercel > Settings > Environment Variables, scope Production: IMAP_HOST met waarde imap.hostinger.com, IMAP_USER met waarde info@jna-events.nl, IMAP_PASS met het app-wachtwoord dat je net hebt gemaakt. NIEMAND anders hoeft dat wachtwoord ooit te zien, ook ik niet." },
      { id: "em-5", title: "Deploy opnieuw zonder build-cache", help: "Vercel > Deployments > drie puntjes bij de bovenste > Redeploy. Haal het vinkje bij 'Use existing Build Cache' weg. Wacht tot het groene vinkje verschijnt." },
      { id: "em-6", title: "Test door uit te loggen en opnieuw in te loggen", help: "NOVA haalt bij login automatisch je nieuwste mails op en noemt ze in haar begroeting. Werkt het niet? Check in Vercel onder Logs of er een IMAP-foutmelding staat." },
    ],
  },
  tiktok: {
    title: "TikTok Business",
    intent: "Content automatisch laten plaatsen op TikTok via NOVA.",
    steps: [
      { id: "tt-1", title: "Persoonlijk account omzetten naar Business", help: "In de TikTok-app: profiel > instellingen > account > overschakelen naar zakelijk account. Gratis." },
      { id: "tt-2", title: "Wachten op verificatie", help: "TikTok bekijkt het account handmatig. Duurt 1-3 werkdagen. Bij JnA loopt deze stap al." },
      { id: "tt-3", title: "TikTok for Business Developer-account aanmaken", help: "business.tiktok.com > developer portal > app aanmaken voor agent.jna-events.nl." },
      { id: "tt-4", title: "Access token toevoegen in Vercel", help: "Zet TIKTOK_TOKEN in Vercel zodra de developer-app goedgekeurd is." },
    ],
  },
  meta: {
    title: "Instagram & Facebook",
    intent: "Posts plaatsen op Instagram en Facebook via Meta Graph API.",
    steps: [
      { id: "me-1", title: "Facebook-pagina hebben voor JnA Events", help: "Verplicht: Instagram-zakelijk werkt alleen gekoppeld aan een Facebook-pagina." },
      { id: "me-2", title: "Meta Developer App aanmaken", help: "developers.facebook.com > maak een nieuwe app > type Business." },
      { id: "me-3", title: "Instagram Business Account koppelen aan de Facebook-pagina", help: "In Meta Business Suite onder Account Center." },
      { id: "me-4", title: "Permissies aanvragen: instagram_content_publish + pages_show_list", help: "Meta keurt dit handmatig goed (paar dagen)." },
      { id: "me-5", title: "Long-lived access token genereren", help: "Via Graph API Explorer. Geldig 60 dagen, daarna vernieuwen." },
      { id: "me-6", title: "Token toevoegen in Vercel", help: "Zet META_ACCESS_TOKEN in Vercel Environment Variables." },
    ],
  },
};

function buildItems(progress) {
  return Object.entries(CHECKLISTS).map(([key, list]) => {
    const connected =
      key === "whatsapp" ? CONFIG.hasWhatsApp() :
      key === "email" ? CONFIG.hasMailConnection() :
      key === "tiktok" ? CONFIG.hasTikTok() :
      key === "meta" ? CONFIG.hasMeta() : false;
    const done = list.steps.filter((s) => progress.includes(s.id)).length;
    return {
      key,
      title: list.title,
      intent: list.intent,
      connected,
      total: list.steps.length,
      done,
      steps: list.steps.map((s) => ({ ...s, done: progress.includes(s.id) })),
    };
  });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      const progress = await readData(KEYS.onboarding, []);
      return res.status(200).json({ items: buildItems(progress) });
    }
    if (req.method === "POST") {
      const { stepId, done } = req.body || {};
      if (typeof stepId !== "string") return res.status(400).json({ error: "stepId ontbreekt" });
      let progress = await readData(KEYS.onboarding, []);
      if (done) { if (!progress.includes(stepId)) progress = [...progress, stepId]; }
      else { progress = progress.filter((s) => s !== stepId); }
      await writeData(KEYS.onboarding, progress);
      return res.status(200).json({ items: buildItems(progress) });
    }
    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("Onboarding fout:", err.message);
    return res.status(500).json({ error: "Kon onboarding niet verwerken" });
  }
}
