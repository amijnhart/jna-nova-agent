import { verifyToken } from "./_auth.js";
import { readData, writeData } from "./_config.js";

// Veilig opslaan van IMAP-instellingen in Vercel KV.
//
// Belangrijke veiligheidskeuzes:
//   - Alleen ingelogde gebruikers kunnen lezen/schrijven (token-check).
//   - Het wachtwoord wordt NOOIT teruggegeven aan de frontend.
//     Bij GET geven we alleen terug of het ingesteld is (passSet: true/false),
//     niet de waarde zelf. Zo kan een script dat in jouw browser draait
//     het wachtwoord nooit aflezen.
//   - Bij POST kun je het wachtwoord ALLEEN overschrijven, niet uitlezen.
//
// De inbox.js leest deze waarden serverside en gebruikt ze om verbinding
// te maken met de mailserver. Het wachtwoord verlaat de server nooit.

const KEY = "nova_imap_settings";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    if (req.method === "GET") {
      const data = await readData(KEY, null);
      if (!data) return res.status(200).json({ configured: false });
      // Geef wachtwoord NOOIT terug; alleen of het bestaat
      return res.status(200).json({
        configured: true,
        host: data.host || "",
        port: data.port || 993,
        user: data.user || "",
        passSet: !!data.pass,
        updated: data.updated || null,
      });
    }

    if (req.method === "POST") {
      const { host, port, user, pass } = req.body || {};
      if (!host || !user) {
        return res.status(400).json({ error: "Host en gebruiker zijn verplicht." });
      }
      // Bestaande data ophalen zodat we het wachtwoord behouden als er geen nieuw is meegestuurd
      const existing = (await readData(KEY, null)) || {};
      const next = {
        host: String(host).trim(),
        port: Number(port) || 993,
        user: String(user).trim(),
        pass: pass && pass.length > 0 ? pass : existing.pass || "",
        updated: new Date().toISOString(),
      };
      if (!next.pass) {
        return res.status(400).json({ error: "Wachtwoord is verplicht bij eerste keer instellen." });
      }
      await writeData(KEY, next);
      return res.status(200).json({ ok: true, configured: true, host: next.host, port: next.port, user: next.user, passSet: true, updated: next.updated });
    }

    if (req.method === "DELETE") {
      await writeData(KEY, null);
      return res.status(200).json({ ok: true, configured: false });
    }

    return res.status(405).json({ error: "Methode niet toegestaan" });
  } catch (err) {
    console.error("IMAP-instellingen fout:", err.message);
    return res.status(500).json({ error: "Kon instellingen niet verwerken." });
  }
}
