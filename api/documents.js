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
    // Ook gecachte extractie verwijderen
    await writeData("doc_text_" + id, null);
    return res.status(200).json({ ok: true, items: filtered });
  }

  return res.status(405).json({ error: "Methode niet toegestaan" });
}

// --- EXTRACT: tekst uit PDF/DOCX uitlezen zodat NOVA de inhoud kan gebruiken ---
//
// Strategie: bij eerste aanvraag downloaden we het bestand uit Blob, parsen het
// met pdf-parse of mammoth (afhankelijk van extension/contenttype), en cachen
// de gestripte tekst in Redis. Volgende aanvragen halen direct uit cache.
async function handleExtract(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET vereist" });
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id verplicht" });

  // Cache eerst raadplegen
  const cacheKey = "doc_text_" + id;
  const cached = await readData(cacheKey);
  if (cached && cached.text) {
    return res.status(200).json({
      id,
      filename: cached.filename,
      text: cached.text,
      extracted: cached.extracted,
      fromCache: true,
    });
  }

  // Bestand opzoeken in index
  const items = await readData(FILES_INDEX_KEY, []);
  const target = items.find((i) => i.id === id);
  if (!target) return res.status(404).json({ error: "Bestand niet gevonden in index" });
  if (!target.url) return res.status(400).json({ error: "Geen download-URL beschikbaar" });

  // Download het bestand uit Blob
  let buffer;
  try {
    const r = await fetch(target.downloadUrl || target.url);
    if (!r.ok) throw new Error("Blob download faalde: " + r.status);
    buffer = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    return res.status(502).json({ error: "Download mislukt: " + err.message });
  }

  // Bepaal type op basis van filename of content-type
  const filename = target.filename || "";
  const lower = filename.toLowerCase();
  const isPDF = lower.endsWith(".pdf") || (target.contentType || "").includes("pdf");
  const isDOCX = lower.endsWith(".docx") || (target.contentType || "").includes("wordprocessingml");
  const isTXT = lower.endsWith(".txt") || lower.endsWith(".md") || (target.contentType || "").startsWith("text/");

  let text = "";
  try {
    if (isPDF) {
      // pdf-parse leest tekst uit PDF
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(buffer);
      text = (result.text || "").trim();
    } else if (isDOCX) {
      // mammoth converteert DOCX naar plain text
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = (result.value || "").trim();
    } else if (isTXT) {
      text = buffer.toString("utf-8").trim();
    } else {
      return res.status(415).json({ error: "Bestandstype niet ondersteund voor tekstextractie. Wel: PDF, DOCX, TXT, MD." });
    }
  } catch (err) {
    return res.status(500).json({ error: "Tekstextractie mislukt: " + err.message });
  }

  if (!text) {
    return res.status(200).json({
      id,
      filename,
      text: "",
      warning: "Geen tekst gevonden. Mogelijk een scan-PDF of beeldbestand zonder OCR.",
    });
  }

  // Cache het resultaat. Limiteer tot 100KB tekst om Redis niet vol te stoppen.
  const trimmed = text.length > 100000 ? text.slice(0, 100000) + "\n[...afgekapt op 100KB]" : text;
  const extracted = new Date().toISOString();
  await writeData(cacheKey, { filename, text: trimmed, extracted });

  return res.status(200).json({
    id,
    filename,
    text: trimmed,
    extracted,
    fromCache: false,
  });
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
    if (type === "extract") return await handleExtract(req, res);
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
    return res.status(400).json({ error: "Onbekend type. Gebruik snippets, files, extract of blob-status." });
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
