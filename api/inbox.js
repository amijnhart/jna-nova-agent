import { verifyToken } from "./_auth.js";

// E-mailoverzicht voor de welkomstbriefing.
// LET OP: een echte mailkoppeling (Gmail/Outlook) bestaat nog niet. Zodra die
// er is, leest deze functie echte mails. Tot die tijd meldt hij eerlijk dat
// de koppeling nog niet actief is, zodat NOVA niets voorspiegelt.
//
// Koppelen kan later via Gmail API of Microsoft Graph. Dan vult deze functie
// het veld 'emails' met echte berichten en zet 'connected' op true.

export default function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) {
    return res.status(401).json({ error: "Niet ingelogd." });
  }

  const connected = !!(process.env.GMAIL_TOKEN || process.env.OUTLOOK_TOKEN);

  if (!connected) {
    return res.status(200).json({
      connected: false,
      emails: [],
      note: "Mailkoppeling nog niet actief. Koppel Gmail of Outlook om binnenkomende mail hier te zien.",
    });
  }

  // Plek voor echte mail-ophaal-logica zodra de koppeling er is.
  return res.status(200).json({ connected: true, emails: [] });
}
