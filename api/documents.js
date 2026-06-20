import { verifyToken } from "./_auth.js";
import { readData, writeData } from "./_config.js";

// Bedrijfsdocumenten-module.
//
// Drie soorten content worden hier beheerd:
//
//   1. text-snippets   - kleurpalet, NAW-gegevens, bankrekening (klein, in Redis)
//   2. documents       - PDF-bestanden zoals rider, handleiding (groot, in Vercel Blob)
//   3. visuals         - logo, handtekening (klein, in Vercel Blob)
//
// Aanroepen:
//   GET  ?type=snippets           - haal alle tekst-snippets op
//   POST ?type=snippets           - sla een snippet op (key, value)
//   DELETE ?type=snippets&key=X   - verwijder een snippet
//
//   GET  ?type=files              - lijst alle opgeslagen documenten/visuals
//   POST ?type=files              - upload bestand (multipart of base64)
//   DELETE ?type=files&key=X      - verwijder bestand
//
//   GET  ?type=blob-status        - vertelt of Vercel Blob is geconfigureerd

const SNIPPETS_KEY = "nova_doc_snippets";
const FILES_INDEX_KEY = "nova_doc_files_index";

// --- SNIPPETS (tekst) ---

async function handleSnippets(req, res) {
  if (req.method === "GET") {
    const items = await readData(SNIPPETS_KEY, []);
    return res.status(200).json({ items });
  }
  if (req.method === "POST") {
    const { key, value, label, category } = req.body || {};
    if (!key || value === undefined) return res.status(400).json({ error: "key en value verplicht" });
    const items = await readData(SNIPPETS_KEY, []);
    const existing = items.findIndex((i) => i.key === key);
    const item = {
      key,
      value: String(value).slice(0, 5000), // limiet voor veiligheid
      label: label || key,
      category: category || "algemeen",
      updated: new Date().toISOString(),
    };
    if (existing >= 0) items[existing] = item;
    else items.push(item);
    await writeData(SNIPPETS_KEY, items);
    return res.status(200).json({ ok: true, items });
  }
  if (req.method === "DELETE") {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key verplicht" });
    const items = await readData(SNIPPETS_KEY, []);
    const filtered = items.filter((i) => i.key !== key);
    await writeData(SNIPPETS_KEY, filtered);
    return res.status(200).json({ ok: true, items: filtered });
  }
  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- FILES (PDF's, visuals via Vercel Blob) ---

// Zoek de Blob-token. Vercel kan deze onder verschillende namen opslaan:
// - BLOB_READ_WRITE_TOKEN (standaard)
// - jna_BLOB_READ_WRITE_TOKEN of andere prefix als gebruiker dat heeft aangepast
// - OIDC-modus: dan is er VERCEL_OIDC_TOKEN + BLOB_STORE_ID
function findBlobToken() {
  // Eerst de standaard
  if (process.env.BLOB_READ_WRITE_TOKEN) return { token: process.env.BLOB_READ_WRITE_TOKEN, name: "BLOB_READ_WRITE_TOKEN" };
  // Dan scannen op alles wat eindigt op _BLOB_READ_WRITE_TOKEN (custom prefix)
  for (const key of Object.keys(process.env)) {
    if (key.endsWith("BLOB_READ_WRITE_TOKEN") || key.endsWith("_BLOB_READ_WRITE_TOKEN")) {
      return { token: process.env[key], name: key };
    }
  }
  return { token: null, name: null };
}

function hasBlobToken() {
  return !!findBlobToken().token;
}

// Diagnose-info voor de gebruiker - welke Vercel-vars zijn aanwezig
function blobDiagnose() {
  const result = findBlobToken();
  const allBlobVars = Object.keys(process.env)
    .filter((k) => /blob/i.test(k))
    .map((k) => k);
  return {
    configured: !!result.token,
    foundUnder: result.name,
    allBlobEnvVars: allBlobVars,
    hasOidcToken: !!process.env.VERCEL_OIDC_TOKEN,
    hasBlobStoreId: !!process.env.BLOB_STORE_ID,
  };
}

async function blobPut(filename, body, contentType) {
  const { token } = findBlobToken();
  if (!token) throw new Error("Geen Blob-token gevonden in environment variables");
  // Vercel Blob API direct via fetch om geen extra package te hoeven installeren
  // (de @vercel/blob package kan ook, maar adds een dependency).
  const url = `https://blob.vercel-storage.com/${encodeURIComponent(filename)}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "x-content-type": contentType || "application/octet-stream",
      "x-add-random-suffix": "1",
    },
    body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Blob PUT mislukt: " + r.status + " " + t.slice(0, 200));
  }
  const data = await r.json();
  return data; // { url, downloadUrl, pathname, contentType, contentDisposition }
}

async function blobDelete(url) {
  const { token } = findBlobToken();
  if (!token) throw new Error("Geen Blob-token gevonden");
  const r = await fetch("https://blob.vercel-storage.com/delete", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls: [url] }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Blob DELETE mislukt: " + r.status + " " + t.slice(0, 200));
  }
  return await r.json();
}

async function handleFiles(req, res) {
  if (req.method === "GET") {
    const items = await readData(FILES_INDEX_KEY, []);
    const diag = blobDiagnose();
    return res.status(200).json({ items, blobConfigured: diag.configured, blobDiagnose: diag });
  }

  if (req.method === "POST") {
    if (!hasBlobToken()) {
      return res.status(503).json({ error: "Vercel Blob niet geconfigureerd. Voeg BLOB_READ_WRITE_TOKEN toe in Vercel." });
    }
    // Body verwacht: { filename, contentType, base64, label, category }
    const { filename, contentType, base64, label, category } = req.body || {};
    if (!filename || !base64) return res.status(400).json({ error: "filename en base64 verplicht" });

    // Decode base64 naar buffer
    const buf = Buffer.from(base64, "base64");
    if (buf.length === 0) return res.status(400).json({ error: "Lege base64-payload" });
    // Limiet voor veiligheid: max 10 MB per bestand
    if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: "Bestand te groot (max 10 MB)" });

    try {
      const blob = await blobPut(filename, buf, contentType || "application/octet-stream");
      const items = await readData(FILES_INDEX_KEY, []);
      const item = {
        id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        filename,
        contentType: contentType || "application/octet-stream",
        size: buf.length,
        url: blob.url,
        downloadUrl: blob.downloadUrl || blob.url,
        label: label || filename,
        category: category || "document",
        uploaded: new Date().toISOString(),
      };
      items.push(item);
      await writeData(FILES_INDEX_KEY, items);
      return res.status(200).json({ ok: true, item, items });
    } catch (err) {
      console.error("Blob upload fout:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    const id = req.query.key || req.query.id;
    if (!id) return res.status(400).json({ error: "id verplicht" });
    const items = await readData(FILES_INDEX_KEY, []);
    const target = items.find((i) => i.id === id);
    if (!target) return res.status(404).json({ error: "Bestand niet gevonden" });
    try {
      if (hasBlobToken() && target.url) {
        await blobDelete(target.url);
      }
    } catch (err) {
      // Index wel opruimen ook al was Blob-delete niet succesvol
      console.warn("Blob delete waarschuwing:", err.message);
    }
    const filtered = items.filter((i) => i.id !== id);
    await writeData(FILES_INDEX_KEY, filtered);
    return res.status(200).json({ ok: true, items: filtered });
  }

  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- ROUTER ---

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "Niet ingelogd." });

  try {
    const type = req.query.type || "";
    if (type === "snippets") return await handleSnippets(req, res);
    if (type === "files") return await handleFiles(req, res);
    if (type === "blob-status") {
      const diag = blobDiagnose();
      return res.status(200).json({
        configured: diag.configured,
        foundUnder: diag.foundUnder,
        allBlobEnvVars: diag.allBlobEnvVars,
        hasOidcToken: diag.hasOidcToken,
        hasBlobStoreId: diag.hasBlobStoreId,
        hint: diag.configured
          ? null
          : (diag.allBlobEnvVars.length > 0
              ? `Er staan Blob-vars in Vercel (${diag.allBlobEnvVars.join(", ")}) maar geen daarvan eindigt op BLOB_READ_WRITE_TOKEN. Mogelijk heeft Vercel een andere naam gebruikt. Controleer in Vercel Settings → Environment Variables welke naam je Blob-token heeft, en stuur die door zodat we de code kunnen aanpassen.`
              : "Geen Vercel Blob env-vars gevonden. Stappen: Vercel project → Storage → Create → Blob → bij koppelen 'Production' aanvinken → daarna Deployments → Redeploy."),
      });
    }
    return res.status(400).json({ error: "Onbekend type. Gebruik snippets, files of blob-status." });
  } catch (err) {
    console.error("Documents-fout:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Body parser - we accepteren JSON met base64-payload
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};
