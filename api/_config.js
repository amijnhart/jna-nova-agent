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
//   REDIS_URL           blijvende opslag via Redis-connectiestring (Marketplace/Upstash)
//   KV_REST_API_URL     OF: blijvende opslag via oudere Vercel KV REST
//   KV_REST_API_TOKEN   bijbehorend token bij KV REST
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
// OPSLAG - blijvend bewaren. We ondersteunen drie manieren in deze volgorde:
//   1. REDIS_URL          standaard Redis-connectiestring (Vercel "Marketplace Redis",
//                         Upstash, of zelf-gehoste Redis). Werkt direct met het
//                         "redis" npm-pakket.
//   2. KV_REST_API_URL    Vercel KV REST API (oudere Vercel KV-product).
//   3. memoryStore        in-memory fallback als beide ontbreken. Verdwijnt bij
//                         elke serverless restart - alleen voor lokaal testen.
// ----------------------------------------------------------------------------

const memoryStore = new Map();

function hasRedisUrl() {
  return !!process.env.REDIS_URL;
}

function hasKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Redis client wordt eenmalig gemaakt en hergebruikt. In een serverless omgeving
// blijft de client bestaan zolang het lambda-proces leeft, wat verbindingen
// uitspaart.
let redisClient = null;
let redisConnecting = null;

async function getRedis() {
  if (!hasRedisUrl()) return null;
  if (redisClient && redisClient.isOpen) return redisClient;
  if (redisConnecting) return await redisConnecting;

  redisConnecting = (async () => {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis-fout:", err.message));
    await client.connect();
    redisClient = client;
    redisConnecting = null;
    return client;
  })();
  return await redisConnecting;
}

async function redisGet(key) {
  const c = await getRedis();
  if (!c) return null;
  const raw = await c.get(key);
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function redisSet(key, value) {
  const c = await getRedis();
  if (!c) return;
  await c.set(key, JSON.stringify(value));
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
  // Probeer eerst Redis-URL (standaard Redis), dan KV REST, dan geheugen.
  if (hasRedisUrl()) {
    try {
      const v = await redisGet(key);
      return v === null ? fallback : v;
    } catch (err) { console.error("Redis read fout:", err.message); /* val terug */ }
  }
  if (hasKV()) {
    try {
      const v = await kvGet(key);
      return v === null ? fallback : v;
    } catch { /* val terug */ }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : fallback;
}

export async function writeData(key, value) {
  if (hasRedisUrl()) {
    try { await redisSet(key, value); return; } catch (err) { console.error("Redis write fout:", err.message); /* val terug */ }
  }
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

// Vertelt eerlijk welke opslag op dit moment actief is.
// Probeert ook daadwerkelijk te schrijven en lezen om te bewijzen dat het werkt,
// zodat we niet alleen op env-variables vertrouwen maar ook op echte connectie.
export async function storageStatus() {
  const result = {
    type: "memory",
    persistent: false,
    redisConfigured: hasRedisUrl(),
    kvConfigured: hasKV(),
    healthy: false,
    error: null,
  };

  if (hasRedisUrl()) {
    result.type = "redis";
    try {
      const c = await getRedis();
      if (c) {
        const testKey = "nova_health_check";
        const stamp = Date.now().toString();
        await c.set(testKey, stamp);
        const got = await c.get(testKey);
        if (got === stamp) {
          result.persistent = true;
          result.healthy = true;
        } else {
          result.error = "Schrijf-lees test mislukte";
        }
      } else {
        result.error = "Redis client kon niet verbinden";
      }
    } catch (err) {
      result.error = "Redis fout: " + err.message;
    }
    return result;
  }

  if (hasKV()) {
    result.type = "kv";
    try {
      const testKey = "nova_health_check";
      const stamp = Date.now().toString();
      await kvSet(testKey, stamp);
      const got = await kvGet(testKey);
      if (got === stamp) {
        result.persistent = true;
        result.healthy = true;
      } else {
        result.error = "Schrijf-lees test mislukte";
      }
    } catch (err) {
      result.error = "KV fout: " + err.message;
    }
    return result;
  }

  // Geen opslag geconfigureerd
  result.error = "Geen REDIS_URL of KV_REST_API_URL ingesteld in Vercel - data verdwijnt bij elke serverless restart";
  return result;
}

// Lijst alle KV-keys op die bij deze app horen. Wordt gebruikt door de
// backup-functie om alle data in een keer te exporteren.
export async function listAllKeys() {
  return Object.values(KEYS);
}
