import crypto from "crypto";

// Verifieert het token dat door /api/login is uitgegeven.
// Gebruikt door /api/chat zodat alleen ingelogde bezoekers Claude kunnen aanroepen.
export function verifyToken(token) {
  try {
    const secret = process.env.NOVA_SECRET || process.env.NOVA_PASSWORD || "";
    if (!token || !secret) return false;
    const [data, sig] = token.split(".");
    if (!data || !sig) return false;
    const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!payload.ok || !payload.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}
