import crypto from "crypto";

// Beveiligde login. Het wachtwoord staat ALLEEN in Vercel (Environment Variables)
// als NOVA_PASSWORD, nooit in de code. De controle gebeurt hier serverside.
//
// We geven na een juist wachtwoord een ondertekend token terug (HMAC), dat de
// frontend bewaart en bij elke chat-aanvraag meestuurt. Zo blijft de bezoeker
// ingelogd zonder dat het wachtwoord steeds opnieuw nodig is.

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST" });
  }

  const expected = process.env.NOVA_PASSWORD;
  const secret = process.env.NOVA_SECRET || expected || "";

  if (!expected) {
    return res.status(500).json({
      error:
        "Wachtwoord niet ingesteld. Voeg NOVA_PASSWORD toe in Vercel (Settings > Environment Variables, scope Production) en deploy opnieuw zonder build-cache.",
    });
  }

  const { password } = req.body || {};
  if (typeof password !== "string" || password.length === 0) {
    return res.status(400).json({ error: "Vul een wachtwoord in." });
  }

  // Constante-tijd vergelijking om timing-aanvallen te voorkomen.
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ error: "Onjuist wachtwoord." });
  }

  // Token geldig voor 30 dagen.
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const token = sign({ ok: true, exp }, secret);
  res.status(200).json({ token });
}
