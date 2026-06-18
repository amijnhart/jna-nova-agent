// ============================================================================
// CONFIG.JS - Centrale configuratie en opslag voor de Agent van JnA Events.
// ============================================================================
//
// Dit bestand is OPZETTELIJK gescheiden van de rest van de code, zodat je als
// eigenaar in EEN oogopslag kunt zien wat er ingesteld moet worden en waar de
// gegevens worden bewaard. Geen wachtwoorden of sleutels staan in deze code -
// die staan in Vercel onder Settings > Environment Variables.
//
// VEREISTE INSTELLINGEN (in Vercel Environment Variables, scope Production):
//   ANTHROPIC_API_KEY   het AI-brein van NOVA (begint met sk-ant-)
//   NOVA_PASSWORD       het toegangswachtwoord voor agent.jna-events.nl
//   NOVA_SECRET         lange willekeurige tekst die de inlogsessie beveiligt
//
// OPTIONEEL:
//   VITE_NOVA_NAME      je voornaam voor de begroeting (bijv. Jordi)
//   KV_REST_API_URL     blijvende opslag via Vercel KV (Storage > KV > Connect)
//   KV_REST_API_TOKEN   bijbehorend token (wordt door Vercel automatisch gezet)
//
// TOEKOMSTIGE KOPPELINGEN (nog niet actief, plek staat klaar):
//   IMAP_HOST + IMAP_USER + IMAP_PASS  voor mail via IMAP (werkt overal)
//   GMAIL_TOKEN / OUTLOOK_TOKEN        voor mail via officiele Google/MS API
//   TWILIO_SID + TWILIO_TOKEN + TWILIO_FROM  voor WhatsApp via Twilio
//   WHATSAPP_TOKEN + WHATSAPP_PHONE_ID       voor WhatsApp via 360dialog
//   OPENAI_API_KEY                           voor AI-beeldgeneratie (DALL-E / gpt-image-1)
//   TIKTOK_TOKEN                  voor TikTok Business posten
//   META_ACCESS_TOKEN             voor Instagram en Facebook posten
// ============================================================================

export const CONFIG = {
  authSecret: () => process.env.NOVA_SECRET || process.env.NOVA_PASSWORD || "",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || "",
  hasMailConnection: () => !!(process.env.GMAIL_TOKEN || process.env.OUTLOOK_TOKEN || (process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS)),
  hasWhatsApp: () => !!(process.env.WHATSAPP_TOKEN || (process.env.TWILIO_SID && process.env.TWILIO_TOKEN)),
  whatsappProvider: () => {
    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) return "twilio";
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) return "360dialog";
    return null;
  },
  hasIMAP: () => !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS),
  hasImageGen: () => !!process.env.OPENAI_API_KEY,
  openaiKey: () => process.env.OPENAI_API_KEY || "",
  hasTikTok: () => !!process.env.TIKTOK_TOKEN,
  hasMeta: () => !!process.env.META_ACCESS_TOKEN,
};

// ----------------------------------------------------------------------------
// OPSLAG - blijvend bewaren via Vercel KV, of tijdelijk in geheugen als KV nog
// niet gekoppeld is. Alle datalijsten van NOVA (verbeterpunten, productcatalogus,
// contentkalender, onboarding-voortgang) gebruiken deze laag.
// ----------------------------------------------------------------------------

const memoryStore = new Map();

function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json();
  if (!data || !data.result) return null;
  try { return JSON.parse(data.result); } catch { return null; }
}

async function kvSet(key, value) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

export async function readData(key, fallback = []) {
  if (hasKV()) {
    try {
      const v = await kvGet(key);
      return v === null ? fallback : v;
    } catch { /* val terug op geheugen */ }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : fallback;
}

export async function writeData(key, value) {
  if (hasKV()) {
    try { await kvSet(key, value); return; } catch { /* val terug */ }
  }
  memoryStore.set(key, value);
}

export const KEYS = {
  improvements: "nova_improvements",
  catalog: "nova_catalog",
  calendar: "nova_calendar",
  onboarding: "nova_onboarding",
  imapSettings: "nova_imap_settings",
  whatsappInbox: "nova_whatsapp_inbox",
};

// Lijst alle KV-keys op die bij deze app horen. Wordt gebruikt door de
// backup-functie om alle data in één keer te exporteren.
export async function listAllKeys() {
  if (!hasKV()) {
    return Array.from(memoryStore.keys());
  }
  try {
    // Vercel KV ondersteunt SCAN/KEYS via REST. We gebruiken hier alle bekende
    // keys uit KEYS plus eventuele andere via KEYS-lijst.
    return Object.values(KEYS);
  } catch {
    return Object.values(KEYS);
  }
}
