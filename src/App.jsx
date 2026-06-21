import { useState, useRef, useEffect, useCallback } from "react";

const CYAN = "#38E6FF";
const PURPLE = "#7F77DD";
const AMBER = "#EF9F27";

const CHAT_URL = "/api/chat";
const LOGIN_URL = "/api/login";
const IMPROVE_URL = "/api/data?type=improvements";
const INBOX_URL = "/api/mail?action=inbox";
const BOEKSY_URL = "/api/boeksy?action=overview";
const CATALOG_URL = "/api/data?type=catalog";
const CALENDAR_URL = "/api/data?type=calendar";
const ONBOARDING_URL = "/api/onboarding?action=status";
const BACKUP_URL = "/api/onboarding?action=backup";
const WHATSAPP_URL = "/api/whatsapp?action=send";
const POST_WORKFLOW_URL = "/api/post-workflow";
const IMAGE_URL = "/api/image-generate";
const TOKEN_KEY = "nova_token";
// Naam voor de begroeting. Stel in via Vercel: VITE_NOVA_NAME (bijv. "Jordi").
const NOVA_NAME = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_NOVA_NAME) || "";

function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#>~|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function parseReply(raw) {
  const lines = raw.split("\n");
  let actions = [];
  let task = null;
  let improve = null;
  let plan = null;
  let whatsapp = null;
  let post = null;
  let voice = null;
  let quote = null; // {relation, subject, eventDate, lines: [{description, quantity, unit_price, vat_rate}]}
  const kept = [];
  for (const line of lines) {
    const a = line.match(/^\s*ACTIES\s*:\s*(.+)$/i);
    const t = line.match(/^\s*TAAK\s*:\s*(.+)$/i);
    const v = line.match(/^\s*VERBETER\s*:\s*(.+)$/i);
    const p = line.match(/^\s*PLAN\s*:\s*(.+)$/i);
    const w = line.match(/^\s*STUUR_WA\s*:\s*(.+)$/i);
    const ps = line.match(/^\s*POST\s*:\s*(.+)$/i);
    const st = line.match(/^\s*STEM\s*:\s*(.+)$/i);
    const oq = line.match(/^\s*OFFERTE\s*:\s*(.+)$/i);
    if (a) {
      actions = a[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    } else if (t) {
      const parts = t[1].split("|").map((s) => s.trim());
      if (parts.length >= 2) task = { agent: parts[0], title: parts[1], brief: parts[2] || parts[1] };
    } else if (v) {
      improve = v[1].trim();
    } else if (p) {
      const parts = p[1].split("|").map((s) => s.trim());
      if (parts.length >= 3) plan = { channel: parts[0], title: parts[1], when: parts[2], body: parts[3] || "" };
    } else if (w) {
      const parts = w[1].split("|").map((s) => s.trim());
      if (parts.length >= 2) whatsapp = { to: parts[0], message: parts.slice(1).join(" | ") };
    } else if (ps) {
      const parts = ps[1].split("|").map((s) => s.trim());
      if (parts.length >= 2) post = { channel: parts[0], topic: parts[1] };
    } else if (oq) {
      // OFFERTE: klant | onderwerp | event_datum | lijn1@aantal@prijs@btw%%lijn2@...
      const parts = oq[1].split("|").map((s) => s.trim());
      if (parts.length >= 4) {
        const lineSpecs = parts[3].split("%%").map((s) => s.trim()).filter(Boolean);
        const lines2 = lineSpecs.map((spec) => {
          const f = spec.split("@").map((s) => s.trim());
          return {
            description: f[0] || "",
            quantity: parseFloat(f[1]) || 1,
            unit_price: parseFloat(f[2]) || 0,
            vat_rate: parseFloat(f[3]) || 21,
          };
        }).filter((l) => l.description);
        if (lines2.length) {
          quote = {
            relation: parts[0],
            subject: parts[1],
            event_date: parts[2] || null,
            lines: lines2,
          };
        }
      }
    } else if (st) {
      const cmd = st[1].trim().toLowerCase();
      if (/^rate\s*=/.test(cmd)) {
        const num = parseFloat(cmd.split("=")[1]);
        if (isFinite(num) && num >= 0.5 && num <= 2.0) voice = { rate: num };
      } else if (cmd === "uit" || cmd === "off") {
        voice = { on: false };
      } else if (cmd === "aan" || cmd === "on") {
        voice = { on: true };
      }
    } else {
      kept.push(line);
    }
  }
  return { reply: kept.join("\n").trim(), actions, task, improve, plan, whatsapp, post, voice, quote };
}

// Bereken aankomende events uit Boeksy-data. Een event is een offerte of factuur
// met een event_date. Per event berekenen we welk content-advies relevant is op
// basis van het aantal dagen tot het event. Output-formaat matcht de UI in het
// kalender-paneel (e.klant, e.subject, e.date, e.boeksySource, e.advice).
function deriveBoeksyEvents(boeksy) {
  if (!boeksy || !boeksy.configured) return [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const items = [];

  function add(source, type) {
    if (!Array.isArray(source)) return;
    for (const it of source) {
      if (!it.event_date) continue;
      const dt = new Date(it.event_date);
      if (isNaN(dt.getTime())) continue;
      const days = Math.round((dt.getTime() - now.getTime()) / 86400000);
      if (days < -7) continue; // events ouder dan 7 dagen niet meer tonen

      // Contentadvies per timing-fase. Elk advies heeft een datum (when) zodat
      // het zichtbaar wordt in de tijdlijn rond het event.
      const advice = [];
      const klant = it.relation || "deze klant";
      const subject = it.subject || "deze gig";
      const dayName = dt.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      const ev = new Date(dt);

      // Pre-build (5-7 dagen vooraf): voorbereidings-content
      if (days >= 4) {
        const when = new Date(ev); when.setDate(when.getDate() - 5);
        advice.push({
          type: "pre-build",
          title: `Pre-event teaser voor ${klant}`,
          body: `Heb je nieuwe apparatuur of opstelling sinds vorige keer? Toon dat. Of een korte introductie van de gig: "${subject}" op ${dayName}.`,
          when: when.toISOString(),
        });
      }
      // Teaser (1-3 dagen vooraf): aankondiging
      if (days >= 1 && days <= 3) {
        const when = new Date(ev); when.setDate(when.getDate() - 2);
        advice.push({
          type: "teaser",
          title: `Aankondiging "${subject}"`,
          body: `Tijd om je publiek te laten weten dat je ${dayName} bij ${klant} draait. Sfeerbeeld, mood, energie.`,
          when: when.toISOString(),
        });
      }
      // On-site (op de dag zelf): footage schieten
      if (days === 0) {
        advice.push({
          type: "on-site",
          title: `On-site footage vandaag`,
          body: `Schiet beeldmateriaal van je opstelling, de plek, het publiek en sfeerbeelden. Materiaal voor recap-posts deze week.`,
          when: dt.toISOString(),
        });
      }
      // Recap (1-3 dagen na): nawerk
      if (days >= -3 && days <= -1) {
        const when = new Date(ev); when.setDate(when.getDate() + 2);
        advice.push({
          type: "recap",
          title: `Recap-post over ${klant}`,
          body: `Recap-content over "${subject}". Gebruik beeldmateriaal van die avond. Bedank ${klant} en het publiek.`,
          when: when.toISOString(),
        });
      }

      items.push({
        id: type + "-" + it.id,
        boeksySource: type,
        klant: it.relation || "",
        subject: it.subject || "",
        date: it.event_date,
        days,
        number: it.number,
        total: it.total,
        status: it.status,
        advice,
      });
    }
  }
  add(boeksy.quotes, "quote");
  add(boeksy.invoices, "invoice");
  items.sort((a, b) => Math.abs(a.days) - Math.abs(b.days));
  return items;
}

// Offertes die follow-up nodig hebben: open status, ouder dan 14 dagen.
// We sturen GEEN automatische mail (Boeksy heeft die functie zelf) maar
// signaleren alleen welke aandacht verdienen.
function deriveFollowUpQuotes(boeksy) {
  if (!boeksy || !boeksy.configured || !Array.isArray(boeksy.quotes)) return [];
  const now = new Date();
  return boeksy.quotes.filter((q) => {
    const status = (q.status || "").toLowerCase();
    if (status.includes("accepted") || status.includes("geaccepteerd") || status.includes("rejected") || status.includes("afgewezen") || status.includes("declined")) return false;
    if (!q.date) return false;
    const sent = new Date(q.date);
    if (isNaN(sent.getTime())) return false;
    const daysOpen = Math.round((now.getTime() - sent.getTime()) / 86400000);
    return daysOpen >= 14;
  }).map((q) => ({
    id: q.id,
    number: q.number,
    klant: q.relation,
    subject: q.subject,
    daysOpen: Math.round((new Date().getTime() - new Date(q.date).getTime()) / 86400000),
    total: q.total,
  }));
}

// Actie-sterren plaatsen in een veilige zone rond de cirkel.
function orbitPos(index = 0, total = 1) {
  // Verdeel de actie-sterren over een ring vlak onder de cirkel (radius 28-32),
  // gespreid in een halve cirkel onderaan zodat ze niet overlappen met panel-iconen.
  // Start bij 30° (rechtsonder) en verdeel over 120° (tot 150° = linksonder).
  const startAngle = Math.PI * 0.15; // ~27°
  const totalAngle = Math.PI * 0.7;  // ~126°
  const step = total > 1 ? totalAngle / (total - 1) : 0;
  const a = startAngle + step * index;
  const r = 28;
  return { x: 50 + Math.cos(a) * r, y: 65 + Math.sin(a) * r * 0.5 };
}

const TASK_SLOTS = [
  { x: 50, y: 18 }, { x: 78, y: 32 }, { x: 78, y: 68 },
  { x: 50, y: 82 }, { x: 22, y: 68 }, { x: 22, y: 32 },
];

const AGENT_ICONS = {
  marketing: "📣", content: "✍️", strategie: "📊",
  whatsapp: "💬", social: "📱", planning: "🗓️", default: "⚙️",
};
function agentIcon(name) {
  const k = (name || "").toLowerCase();
  for (const key of Object.keys(AGENT_ICONS)) if (k.includes(key)) return AGENT_ICONS[key];
  return AGENT_ICONS.default;
}

function LoginScreen({ onLogin }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inloggen mislukt");
      onLogin(data.token);
    } catch (e) {
      setErr(e.message || "Inloggen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "radial-gradient(ellipse at 50% 0%, #0A1F44 0%, #04122B 55%, #020A1A 100%)", minHeight: "100vh", color: "#E8F1FF", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.9;transform:scale(1.04)}}
        @keyframes spinR{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes spinL{from{transform:rotate(360deg)}to{transform:rotate(0)}}
        .lring{position:absolute;border-radius:50%;border:1px solid rgba(56,230,255,.25)}
        input::placeholder{color:rgba(180,210,255,.4)}
      `}</style>
      <div style={{ width: "min(380px,100%)", textAlign: "center" }}>
        <div style={{ position: "relative", width: 130, height: 130, margin: "0 auto 28px" }}>
          <div className="lring" style={{ inset: 0, animation: "spinR 24s linear infinite", borderTopColor: CYAN, borderBottomColor: "transparent" }} />
          <div className="lring" style={{ inset: 14, animation: "spinL 30s linear infinite", borderBottomColor: PURPLE, borderTopColor: "transparent" }} />
          <div style={{ position: "absolute", inset: 34, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, rgba(56,230,255,.35), rgba(127,119,221,.25) 60%, rgba(4,18,43,.9) 100%)", border: "1px solid rgba(56,230,255,.4)", boxShadow: "0 0 30px rgba(56,230,255,.35)", display: "flex", alignItems: "center", justifyContent: "center", animation: "pulse 4s ease-in-out infinite" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1, textShadow: `0 0 18px ${CYAN}` }}>JnA</div>
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Agent van JnA Events</div>
        <div style={{ fontSize: 13, color: "rgba(180,210,255,.6)", marginBottom: 24 }}>Voer het wachtwoord in om NOVA te openen</div>
        <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Wachtwoord" style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 12, padding: "12px 16px", color: "#E8F1FF", fontSize: 14, outline: "none", fontFamily: "inherit", marginBottom: 12 }} />
        {err && <div style={{ color: "#FF8FA3", fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{ width: "100%", border: "none", borderRadius: 12, padding: "12px", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", fontSize: 14, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Bezig..." : "Inloggen"}</button>
      </div>
    </div>
  );
}

const SYSTEM_NOTE = ""; // systeemprompt staat serverside

// Bekende mailproviders met hun IMAP-instellingen.
// NOVA herkent op basis van het mailadres welke provider het is en vult alles in.
const MAIL_PROVIDERS = [
  { match: /@gmail\.com$/i, host: "imap.gmail.com", port: 993, name: "Gmail", note: "Gebruik een app-wachtwoord, niet je gewone Google-wachtwoord. Maak hem aan op myaccount.google.com onder Beveiliging." },
  { match: /@(outlook|hotmail|live|msn)\.(com|nl|be)$/i, host: "outlook.office365.com", port: 993, name: "Outlook / Hotmail", note: "Schakel IMAP in via Outlook-instellingen en maak een app-wachtwoord aan op account.microsoft.com." },
  { match: /@(yahoo)\.(com|nl|be)$/i, host: "imap.mail.yahoo.com", port: 993, name: "Yahoo", note: "Maak een app-wachtwoord aan in je Yahoo accountbeveiliging." },
  { match: /@(ziggo|upcmail|chello)\.nl$/i, host: "imap.ziggo.nl", port: 993, name: "Ziggo" },
  { match: /@(kpnmail|planet|hetnet)\.nl$/i, host: "mail.kpnmail.nl", port: 993, name: "KPN" },
  { match: /@xs4all\.nl$/i, host: "imap.xs4all.nl", port: 993, name: "XS4ALL" },
  { match: /@(home|quicknet|casema|tweakdsl|caiway)\.nl$/i, host: "imap.home.nl", port: 993, name: "Home.nl" },
  { match: /@(telenet|skynet|proximus|scarlet)\.be$/i, host: "imap.telenet.be", port: 993, name: "Telenet" },
  { match: /@icloud\.com$/i, host: "imap.mail.me.com", port: 993, name: "iCloud", note: "Apple vereist een app-specifiek wachtwoord. Maak hem aan op appleid.apple.com." },
  { match: /@(hostinger|jna-events)\.nl$/i, host: "imap.hostinger.com", port: 993, name: "Hostinger" },
];

function detectProvider(email) {
  const lower = (email || "").toLowerCase();
  for (const p of MAIL_PROVIDERS) {
    if (p.match.test(lower)) return p;
  }
  // Fallback: probeer imap.[domein] - werkt verrassend vaak voor hosting-mail
  const domain = lower.split("@")[1];
  if (domain && domain.includes(".")) {
    return { host: "imap." + domain, port: 993, name: domain, guessed: true };
  }
  return null;
}

function ImapForm({ current, onClose, onSave, onClear }) {
  const [user, setUser] = useState(current?.user || "");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hostOverride, setHostOverride] = useState(current?.host || "");
  const [portOverride, setPortOverride] = useState(current?.port || 993);

  const detected = detectProvider(user);
  const host = hostOverride || detected?.host || "";
  const port = portOverride || detected?.port || 993;

  async function submit() {
    if (!user.trim()) { setErr("Vul je mailadres in."); return; }
    if (!host) { setErr("Kon de server niet herkennen. Klik op 'geavanceerd' en vul handmatig in."); return; }
    if (!current?.passSet && !pass) { setErr("Vul je app-wachtwoord in."); return; }
    setBusy(true); setErr(""); setOkMsg("");
    const result = await onSave(host, port, user.trim(), pass);
    setBusy(false);
    if (result.ok) {
      setOkMsg("Opgeslagen. NOVA leest je mail bij de volgende login.");
      setPass("");
      setTimeout(() => onClose(), 1500);
    } else {
      setErr(result.error || "Opslaan mislukte.");
    }
  }

  async function handleClear() {
    if (!window.confirm("Mailinstellingen wissen? NOVA kan dan geen mail meer lezen tot je opnieuw instelt.")) return;
    setBusy(true);
    await onClear();
    setBusy(false);
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 26, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(56,230,255,.15)" }}>
          <span style={{ fontSize: 20 }}>📧</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>E-mail koppelen</div>
            <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>{current?.configured ? "Ingesteld - wijzig of wis hieronder" : "Voer je mailadres en app-wachtwoord in"}</div>
          </div>
          <button onClick={onClose} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", minWidth: 32, minHeight: 32 }}>×</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", lineHeight: 1.5, padding: "10px 12px", background: "rgba(56,230,255,.05)", borderRadius: 8, border: "1px solid rgba(56,230,255,.15)" }}>
            <strong style={{ color: "#A0E8FF" }}>Veilig:</strong> je wachtwoord blijft op de server en wordt nooit teruggestuurd naar je browser. Maak een <strong>app-wachtwoord</strong> aan in je mailprovider; gebruik niet je gewone wachtwoord.
          </div>

          <div>
            <label style={{ fontSize: 12, color: "rgba(180,210,255,.8)", display: "block", marginBottom: 6 }}>Je mailadres</label>
            <input
              type="email"
              autoCapitalize="off"
              autoCorrect="off"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="bijv. info@jna-events.nl"
              style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 10, padding: "12px 14px", color: "#E8F1FF", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box", minHeight: 44 }}
            />
          </div>

          {detected && (
            <div style={{ padding: "10px 12px", background: detected.guessed ? "rgba(239,159,39,.06)" : "rgba(29,158,117,.06)", border: "1px solid " + (detected.guessed ? "rgba(239,159,39,.25)" : "rgba(29,158,117,.25)"), borderRadius: 8, fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.5 }}>
              {detected.guessed ? (
                <>NOVA gokt: <strong>{detected.host}</strong> op poort {detected.port}. Werkt het niet? Klik op geavanceerd hieronder.</>
              ) : (
                <>Herkend: <strong>{detected.name}</strong> · server {detected.host}, poort {detected.port}.</>
              )}
              {detected.note && (<div style={{ marginTop: 6, fontSize: 11, color: "rgba(180,210,255,.7)" }}>{detected.note}</div>)}
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: "rgba(180,210,255,.8)", display: "block", marginBottom: 6 }}>
              App-wachtwoord {current?.passSet && <span style={{ color: "#5DCAA5", fontSize: 11 }}>(al ingesteld, alleen wijzigen indien nodig)</span>}
            </label>
            <input
              type="password"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={current?.passSet ? "•••••••• ingesteld" : "app-wachtwoord"}
              style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 10, padding: "12px 14px", color: "#E8F1FF", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box", minHeight: 44 }}
            />
          </div>

          <button onClick={() => setShowAdvanced((v) => !v)} style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.6)", fontSize: 11, cursor: "pointer", textAlign: "left", padding: 0 }}>
            {showAdvanced ? "▾" : "▸"} Geavanceerd: server handmatig instellen
          </button>

          {showAdvanced && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, color: "rgba(180,210,255,.7)", display: "block", marginBottom: 4 }}>IMAP-server</label>
                <input value={hostOverride} onChange={(e) => setHostOverride(e.target.value)} placeholder={detected?.host || "imap.voorbeeld.nl"} style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "10px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", minHeight: 40 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "rgba(180,210,255,.7)", display: "block", marginBottom: 4 }}>Poort</label>
                <input type="number" value={portOverride} onChange={(e) => setPortOverride(parseInt(e.target.value) || 993)} style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "10px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", minHeight: 40 }} />
              </div>
            </div>
          )}

          {err && <div style={{ fontSize: 12, color: "#FF8FA3" }}>{err}</div>}
          {okMsg && <div style={{ fontSize: 12, color: "#5DCAA5" }}>{okMsg}</div>}
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)", flexWrap: "wrap" }}>
          {current?.configured && (
            <button onClick={handleClear} disabled={busy} style={{ border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "10px 14px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 44 }}>Wissen</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(180,210,255,.2)", color: "rgba(180,210,255,.7)", borderRadius: 10, padding: "10px 14px", fontSize: 13, cursor: "pointer", minHeight: 44 }}>Annuleren</button>
          <button onClick={submit} disabled={busy} style={{ border: "none", borderRadius: 10, padding: "10px 18px", background: "linear-gradient(135deg, #38E6FF, #7F77DD)", color: "#04122B", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, minHeight: 44 }}>{busy ? "Bezig..." : "Opslaan"}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  });

  function handleLogin(t) {
    setToken(t);
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { void e; }
  }
  function logout() {
    setToken("");
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { void e; }
  }

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  return <Nova token={token} onLogout={logout} />;
}

// Kleine helper-component voor het toevoegen van een tekst-snippet aan bedrijfsdocumenten.
// State lokaal gehouden zodat de hoofdcomponent er niet door rendert bij elke toetsaanslag.
function SnippetAddForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("algemeen");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ width: "100%", padding: "10px 12px", background: "rgba(127,119,221,.08)", border: "1px dashed rgba(127,119,221,.4)", borderRadius: 10, color: "#B3ADEE", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Nieuw tekstfragment</button>
    );
  }
  return (
    <div style={{ padding: "12px 14px", background: "rgba(127,119,221,.06)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="text" value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Naam (bijv. IBAN, BTW-nummer, kleurpalet)"
        style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 6, padding: "8px 10px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit" }}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 6, padding: "8px 10px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit" }}
      >
        <option value="algemeen">Algemeen</option>
        <option value="naw">NAW-gegevens</option>
        <option value="bank">Bankgegevens</option>
        <option value="btw">BTW &amp; juridisch</option>
        <option value="kleur">Merkkleuren</option>
        <option value="tone">Tone of voice</option>
      </select>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Waarde of inhoud"
        rows={3}
        style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 6, padding: "8px 10px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={async () => {
            if (!label.trim() || !value.trim()) return;
            setBusy(true);
            const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
            const ok = await onAdd(key, value.trim(), label.trim(), category);
            setBusy(false);
            if (ok) {
              setLabel(""); setValue(""); setCategory("algemeen"); setOpen(false);
            }
          }}
          disabled={busy || !label.trim() || !value.trim()}
          style={{ flex: 1, border: "none", borderRadius: 6, padding: "8px", background: (label.trim() && value.trim()) ? "linear-gradient(135deg, #7F77DD, #5A52B5)" : "rgba(255,255,255,.08)", color: (label.trim() && value.trim()) ? "#fff" : "rgba(180,210,255,.4)", fontSize: 12, fontWeight: 700, cursor: (label.trim() && value.trim()) ? "pointer" : "not-allowed" }}
        >Opslaan</button>
        <button onClick={() => { setOpen(false); setLabel(""); setValue(""); }} style={{ border: "1px solid rgba(180,210,255,.2)", borderRadius: 6, padding: "8px 12px", background: "transparent", color: "rgba(220,238,255,.7)", fontSize: 12, cursor: "pointer" }}>Annuleren</button>
      </div>
    </div>
  );
}

function FileUploadForm({ onUpload }) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("rider");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  return (
    <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(56,230,255,.05)", border: "1px dashed rgba(56,230,255,.3)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)", marginBottom: 2 }}>Nieuw bestand uploaden</div>
      <input
        type="text" value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Naam (bijv. Rider DJ + apparatuur)"
        style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 6, padding: "8px 10px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit" }}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 6, padding: "8px 10px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit" }}
      >
        <option value="rider">Technical Rider</option>
        <option value="handleiding">Handleiding</option>
        <option value="logo">Logo</option>
        <option value="handtekening">Handtekening</option>
        <option value="presskit">Promotiemateriaal / Presskit</option>
        <option value="voorwaarden">Algemene voorwaarden</option>
        <option value="document">Overig document</option>
      </select>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx,.txt"
        style={{ fontSize: 11, color: "rgba(180,210,255,.7)" }}
      />
      <button
        onClick={async () => {
          const file = fileRef.current?.files?.[0];
          if (!file || !label.trim()) return;
          setBusy(true);
          const ok = await onUpload(file, label.trim(), category);
          setBusy(false);
          if (ok) {
            setLabel(""); setCategory("rider");
            if (fileRef.current) fileRef.current.value = "";
          }
        }}
        disabled={busy}
        style={{ border: "none", borderRadius: 6, padding: "8px", background: busy ? "rgba(255,255,255,.08)" : "linear-gradient(135deg, #38E6FF, #1B97AF)", color: busy ? "rgba(180,210,255,.4)" : "#04122B", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}
      >{busy ? "Uploaden..." : "Uploaden"}</button>
    </div>
  );
}

function Nova({ token, onLogout }) {
  const [justEntered, setJustEntered] = useState(true);
  useEffect(() => {
    // Reset het inlog-overgangseffect na 2 seconden zodat de cirkel weer normaal verder draait
    const t = setTimeout(() => setJustEntered(false), 2000);
    return () => clearTimeout(t);
  }, []);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Goedendag. Ik ben NOVA, de agent van JnA Events. Stel me een vraag of geef een opdracht. Vraag je iets dat werk vereist, dan zet ik een agent aan het werk en zie je die als taak rond de cirkel verschijnen." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voicePulse, setVoicePulse] = useState(0); // 0..1, golft tijdens spreken
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceRate, setVoiceRate] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("nova_voice_rate")); return isFinite(v) && v >= 0.5 && v <= 2.0 ? v : 1.15; }
    catch { return 1.15; }
  });
  // Door gebruiker gekozen stem (op naam) - leeg betekent automatische keuze
  const [voiceName, setVoiceName] = useState(() => {
    try { return localStorage.getItem("nova_voice_name") || ""; } catch { return ""; }
  });
  const [availableVoices, setAvailableVoices] = useState([]);
  // Externe TTS voorkeur (browser/openai)
  const [ttsProvider, setTtsProvider] = useState(() => {
    try { return localStorage.getItem("nova_tts_provider") || "browser"; } catch { return "browser"; }
  });
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [imapCfg, setImapCfg] = useState(null); // {configured, host, port, user, passSet}
  const [showImap, setShowImap] = useState(false);
  const [integrations, setIntegrations] = useState(null); // {mail:{active}, whatsapp:{active}, images:{active}, storage:{active}}
  const [emails, setEmails] = useState([]); // recente mails uit IMAP-inbox, meegestuurd naar chat als context
  const [boeksy, setBoeksy] = useState(null); // {configured, relations, invoices, quotes, profitLoss}
  const [showBoeksy, setShowBoeksy] = useState(false);
  const [openAgentDetail, setOpenAgentDetail] = useState(null); // {postId, role}
  const [agentFeedbackDraft, setAgentFeedbackDraft] = useState({}); // role -> tekst
  const [status, setStatus] = useState("Online · klaar voor je opdracht");
  const [micSupported, setMicSupported] = useState(true);
  // Altijd-luister modus: microfoon staat continu open, VAD activeert herkenning
  // wanneer stem boven drempel uit komt. localStorage onthoudt voorkeur.
  const [alwaysListen, setAlwaysListen] = useState(() => {
    try { return localStorage.getItem("nova_always_listen") === "1"; } catch { return false; }
  });
  const [micMuted, setMicMuted] = useState(false); // tijdelijk dempen tijdens always-listen
  // Ref houdt de actuele micMuted-waarde bij voor gebruik in de VAD-loop die
  // anders een stale closure heeft. Zonder deze ref blijft mute niet werken
  // omdat de animatieframe-callback de oude waarde blijft zien.
  const micMutedRef = useRef(false);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  const [micLevel, setMicLevel] = useState(0); // huidig volumeniveau 0-1, voor visuele feedback
  const [actions, setActions] = useState([]);
  const [idleStars, setIdleStars] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [openTask, setOpenTask] = useState(null);
  const [taskInput, setTaskInput] = useState("");
  const [improvements, setImprovements] = useState([]);
  const [showImprove, setShowImprove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]); // afgeronde activiteiten (historie-overzicht)
  const [showHistory, setShowHistory] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [calendar, setCalendar] = useState([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarView, setCalendarView] = useState("list"); // "list" of "week"
  const [orbMenuOpen, setOrbMenuOpen] = useState(false); // quick-action menu rond de cirkel
  const [showDashboard, setShowDashboard] = useState(false); // dashboard overzicht
  const [notifPermission, setNotifPermission] = useState(() => {
    try { return typeof Notification !== "undefined" ? Notification.permission : "default"; } catch { return "default"; }
  });
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem("nova_notif_enabled") === "1"; } catch { return false; }
  });
  // Refs voor het detecteren van nieuwe mails/WhatsApps - alleen NIEUWE items melden
  const seenMailIdsRef = useRef(new Set());
  const seenWAIdsRef = useRef(new Set());
  // Diagnose-info over de opslag - laat zien of we Redis/KV/geheugen gebruiken
  const [storageInfo, setStorageInfo] = useState(null);
  const [showStorageInfo, setShowStorageInfo] = useState(false);
  // Eén centraal instellingen-paneel voor stem, mic, notificaties en opslag
  const [showSettings, setShowSettings] = useState(false);
  // Bedrijfsdocumenten - tekst-snippets en bestanden (PDF's, logo etc.)
  const [snippets, setSnippets] = useState([]);
  const [docFiles, setDocFiles] = useState([]);
  const [blobConfigured, setBlobConfigured] = useState(false);
  const [blobDiagDetail, setBlobDiagDetail] = useState(null); // {foundUnder, allBlobEnvVars, hasOidcToken, hasBlobStoreId}
  // Financieel overzicht: bankstand, BTW, IB-schatting, besteedbaar
  const [financials, setFinancials] = useState(null);
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  // Mic-diagnose paneel om iOS Safari problemen op te sporen
  const [showMicDiag, setShowMicDiag] = useState(false);
  const [micDiag, setMicDiag] = useState(null);
  // Stemmen per agent-rol (verbeterpunt M). Default-keuzes komen uit OpenAI's stemmen.
  // Marketing = autoritaire mannelijke stem (onyx); Content = vrolijke vrouwelijke (nova);
  // Visual = warme verteller (fable); Video = bedachtzaam (sage).
  const [agentVoices, setAgentVoices] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nova_agent_voices") || "{}");
      return {
        nova: saved.nova || "",        // NOVA zelf - leeg = gebruik de hoofd-stem
        marketing: saved.marketing || "onyx",
        content: saved.content || "nova",
        visual: saved.visual || "fable",
        video: saved.video || "sage",
      };
    } catch {
      return { nova: "", marketing: "onyx", content: "nova", visual: "fable", video: "sage" };
    }
  });
  function updateAgentVoice(role, voice) {
    setAgentVoices((prev) => {
      const next = { ...prev, [role]: voice };
      try { localStorage.setItem("nova_agent_voices", JSON.stringify(next)); } catch { /* doorgaan */ }
      return next;
    });
  }
  const [calForm, setCalForm] = useState({ open: false, title: "", when: "", channel: "instagram", body: "" });
  // Modal voor beeld regenereren met extra instructies
  const [regenModal, setRegenModal] = useState(null); // { postId, promptIndex, instructions }
  // Briefing-kaart voor "wat staat er morgen/vandaag/deze week" - visueel overzicht
  const [briefing, setBriefing] = useState(null); // {when, events, mails, openQuotes, notes}
  // Laatst bekeken item voor context-bewustzijn van NOVA (verbeterpunt P)
  const [lastViewedContext, setLastViewedContext] = useState(null); // {type, label, data}
  const [toast, setToast] = useState(null); // {icon, text, color}
  const [improveJustAdded, setImproveJustAdded] = useState(false); // voor pulse-effect op ✨-icoon
  const [onboarding, setOnboarding] = useState([]);
  const [showOnboard, setShowOnboard] = useState(false);
  const [openOnboard, setOpenOnboard] = useState(null);
  const [pendingWA, setPendingWA] = useState(null); // {to, message} wachtend op akkoord
  const [pendingQuote, setPendingQuote] = useState(null); // {relation, subject, event_date, lines} wachtend op akkoord
  const [posts, setPosts] = useState([]); // multi-agent contentposts
  const [openPost, setOpenPost] = useState(null); // post-id dat geopend is
  const [prodName, setProdName] = useState("");
  const [prodCat, setProdCat] = useState("");
  const catalogRef = useRef([]);
  const greetedRef = useRef(false);
  const suggestedAlwaysListenRef = useRef(false);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  // VAD refs - Web Audio objecten leven hier zodat ze tussen renders bestaan
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const vadRafRef = useRef(null);
  const vadStateRef = useRef({ voiceCount: 0, silenceCount: 0, currentlyRecognizing: false });
  const voicesRef = useRef([]);
  const tasksRef = useRef([]);
  const integrationsRef = useRef({});
  const emailsRef = useRef([]);
  const boeksyRef = useRef(null);
  const snippetsRef = useRef([]);
  const docFilesRef = useRef([]);
  useEffect(() => { snippetsRef.current = snippets; }, [snippets]);
  useEffect(() => { docFilesRef.current = docFiles; }, [docFiles]);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { integrationsRef.current = integrations; }, [integrations]);
  useEffect(() => { emailsRef.current = emails; }, [emails]);
  useEffect(() => { boeksyRef.current = boeksy; }, [boeksy]);

  // Periodieke statuscheck (elke 30 sec). NOVA detecteert zelf wanneer een
  // integratie nieuw actief wordt en kondigt dat aan.
  useEffect(() => {
    if (!token) return;
    const checkStatus = async () => {
      try {
        const r = await fetch(ONBOARDING_URL, { headers: { Authorization: "Bearer " + token } });
        const d = await r.json();
        if (!d.integrations) return;
        const prev = integrationsRef.current || {};
        const next = d.integrations;
        // Detecteer overgangen van inactief naar actief
        const newlyActive = [];
        for (const key of ["mail", "whatsapp", "images", "storage"]) {
          if (next[key]?.active && !prev[key]?.active) {
            newlyActive.push(key);
          }
        }
        setIntegrations(next);
        if (newlyActive.length > 0) {
          const labels = { mail: "e-mailkoppeling", whatsapp: "WhatsApp", images: "beeldgeneratie", storage: "opslag" };
          const msg = newlyActive.length === 1
            ? `Je ${labels[newlyActive[0]]} is nu actief. Ik kan er meteen gebruik van maken.`
            : `Meerdere integraties zijn actief geworden: ${newlyActive.map((k) => labels[k]).join(", ")}.`;
          setMessages((m) => [...m, { role: "assistant", content: msg }]);
          if (voiceOn) speak(msg);
        }
      } catch (e) { void e; }
    };
    const iv = setInterval(checkStatus, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy]);

  // Bij het inloggen: NOVA spreekt een korte begroeting uit, zet openstaande acties
  // rond de cirkel, en schakelt dan terug naar luistermodus. Geen pop-up.
  useEffect(() => {
    async function boot() {
      if (greetedRef.current) return;
      greetedRef.current = true;

      // Helper die een fetch doet en altijd een waarde teruggeeft (geen exceptions).
      const safeFetch = async (url) => {
        try {
          const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
          return await r.json();
        } catch { return null; }
      };

      // Alle data parallel ophalen. Scheelt 2-3 seconden bij login op trage verbindingen.
      const [d1, d2, d3, d4, d5, d6, dB, dWA, dStorage, dSnip, dFiles] = await Promise.all([
        safeFetch(IMPROVE_URL),
        safeFetch(INBOX_URL),
        safeFetch(CATALOG_URL),
        safeFetch(CALENDAR_URL),
        safeFetch(ONBOARDING_URL),
        safeFetch("/api/mail?action=settings"),
        safeFetch(BOEKSY_URL),
        safeFetch("/api/whatsapp?action=inbox"),
        safeFetch("/api/data?type=storage"),
        safeFetch("/api/documents?type=snippets"),
        safeFetch("/api/documents?type=files"),
      ]);

      let imps = [];
      let inbox = { connected: false, emails: [] };
      let liveIntegrations = {};
      let waInbox = [];

      if (dStorage) setStorageInfo(dStorage);
      if (dSnip && Array.isArray(dSnip.items)) setSnippets(dSnip.items);
      if (dFiles) {
        if (Array.isArray(dFiles.items)) setDocFiles(dFiles.items);
        if (typeof dFiles.blobConfigured === "boolean") setBlobConfigured(dFiles.blobConfigured);
        if (dFiles.blobDiagnose) setBlobDiagDetail(dFiles.blobDiagnose);
      }
      if (d1 && Array.isArray(d1.items)) { imps = d1.items; setImprovements(d1.items); }
      if (d2) { inbox = d2; if (inbox.connected && Array.isArray(inbox.emails)) setEmails(inbox.emails); }
      if (d3 && Array.isArray(d3.items)) setCatalog(d3.items);
      if (d4 && Array.isArray(d4.items)) setCalendar(d4.items);
      if (d5) {
        if (Array.isArray(d5.items)) setOnboarding(d5.items);
        if (d5.integrations) { setIntegrations(d5.integrations); liveIntegrations = d5.integrations; }
      }
      if (d6) setImapCfg(d6);
      if (dB) {
        dB.events = deriveBoeksyEvents(dB);
        dB.followUps = deriveFollowUpQuotes(dB);
        setBoeksy(dB);
      }
      if (dWA && Array.isArray(dWA.items)) waInbox = dWA.items;

      const hour = new Date().getHours();
      const groet = hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";
      const naam = (typeof NOVA_NAME === "string" && NOVA_NAME) || "";

      // SEEN-tracking voor mails over sessies heen.
      // Bug: NOVA benoemde elke login dezelfde mails opnieuw omdat we niet bijhielden
      // wat al gezien was. Nu lezen we de set uit localStorage, vergelijken met huidige
      // inbox, en tellen alleen écht NIEUW én ongelezen.
      let mailSeen = new Set();
      try {
        const stored = localStorage.getItem("nova_mail_seen");
        if (stored) mailSeen = new Set(JSON.parse(stored));
      } catch (e) { void e; }
      const allEmails = (inbox.connected && Array.isArray(inbox.emails)) ? inbox.emails : [];
      const mailIdsNu = allEmails.map((m) => m.id || (m.from + m.subject));
      // Alleen écht nieuwe + ongelezen mails tellen
      const nieuweMails = allEmails.filter((m) => {
        const id = m.id || (m.from + m.subject);
        return !mailSeen.has(id) && m.unread;
      });
      const urgent = nieuweMails.filter((e) => e.urgent).length;
      const mailCount = nieuweMails.length;
      // De seen-set bijwerken zodat volgende sessie deze niet meer als nieuw benoemt
      for (const id of mailIdsNu) mailSeen.add(id);
      try {
        // Houd de set bewust niet onbeperkt groot - laatste 500 IDs is genoeg
        const arr = Array.from(mailSeen).slice(-500);
        localStorage.setItem("nova_mail_seen", JSON.stringify(arr));
      } catch (e) { void e; }

      const impCount = imps.length;

      // WhatsApp gebruikt eigen read-flag van backend, prima
      const waNieuw = waInbox.filter((m) => !m.read).length;

      // Formuleer het mail-stuk afhankelijk van aantal en urgentie
      const mailStuk = mailCount === 0 ? "" :
        mailCount === 1 ? `één nieuwe mail${urgent ? " die je aandacht vraagt" : ""}` :
        urgent > 0 ? `${mailCount} mails, waarvan ${urgent} die je aandacht vragen` :
        `${mailCount} nieuwe mails`;
      const impStuk = impCount === 0 ? "" :
        impCount === 1 ? "één verbeterpunt voor de volgende update" :
        `${impCount} verbeterpunten`;
      const waStuk = waNieuw === 0 ? "" :
        waNieuw === 1 ? "één WhatsApp-bericht" : `${waNieuw} WhatsApp-berichten`;

      const delen = [mailStuk, impStuk, waStuk].filter(Boolean);
      const groetMetNaam = `${groet}${naam ? ", " + naam : ""}`;

      // Verschillende openingsvarianten - random gekozen voor variatie
      const sluitvragen = [
        "Waar wil je mee beginnen?",
        "Waar zal ik je mee helpen?",
        "Wat staat er op het programma?",
        "Wat wil je als eerste oppakken?",
        "Zal ik ergens mee starten?",
      ];
      const sluit = sluitvragen[Math.floor(Math.random() * sluitvragen.length)];

      let tekst;
      if (delen.length === 0) {
        // Niets te melden - lichte variatie
        const lege = [
          `${groetMetNaam}. Niks dat schreeuwt om aandacht. ${sluit}`,
          `${groetMetNaam}. Geen openstaande zaken. ${sluit}`,
          `${groetMetNaam}. Alles staat rustig op zijn plek. ${sluit}`,
          `${groetMetNaam}. Klaar om weer aan de slag te gaan. ${sluit}`,
        ];
        tekst = lege[Math.floor(Math.random() * lege.length)];
      } else {
        // Lijst aan elkaar plakken: "x en y" of "x, y en z"
        const lijst = delen.length === 1 ? delen[0] :
          delen.length === 2 ? `${delen[0]} en ${delen[1]}` :
          `${delen.slice(0, -1).join(", ")} en ${delen.slice(-1)[0]}`;

        const intros = [
          `${groetMetNaam}. Sinds vorige keer zijn er ${lijst}. ${sluit}`,
          `${groetMetNaam}, fijn dat je er bent. Er liggen ${lijst}. ${sluit}`,
          `${groetMetNaam}. Ik heb ${lijst} voor je. ${sluit}`,
          `${groetMetNaam}. Even bijpraten: ${lijst}. ${sluit}`,
          `${groetMetNaam}. Een kort overzicht: ${lijst}. ${sluit}`,
        ];
        tekst = intros[Math.floor(Math.random() * intros.length)];
      }

      // Eenmalige hint als mail nog niet gekoppeld is - geen status-melding maar context
      if (!inbox.connected && !d6?.configured) {
        tekst += " Tip: koppel eerst je mail via het envelop-icoon rond de cirkel, dan kan ik over je inbox meedenken.";
      }

      // Toon de begroeting als bericht in de chat en spreek hem uit.
      setMessages((p) => [...p, { role: "assistant", content: tekst }]);
      speak(tekst);

      // Als de opslag niet persistent is, waarschuw expliciet zodat de gebruiker
      // weet dat data verloren gaat. Vandaag is gebleken dat NOVA dit "wist" maar
      // niet liet zien.
      if (dStorage && !dStorage.persistent) {
        const probleem = dStorage.error || "geen REDIS_URL of KV_REST_API_URL ingesteld";
        setMessages((p) => [...p, { role: "assistant", content: `⚠️ Let op: de opslag is op dit moment niet persistent. ${probleem}. Verbeterpunten, kalender-items en catalogus blijven niet bewaard tussen sessies. Klik op het 💾-icoon in de header voor details over hoe dit op te lossen.` }]);
      }

      // Microfoon-permissie check: vraag vriendelijk om toestemming bij eerste login.
      // Op die manier hoeft de gebruiker niet zelf in instellingen te grasduinen om
      // de browser-pop-up te activeren. We tonen alleen op desktop waar het zinvol is;
      // op iOS Safari is dit toch een andere weg.
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR && navigator.permissions && navigator.permissions.query) {
          const p = await navigator.permissions.query({ name: "microphone" });
          if (p.state === "prompt" || p.state === "default") {
            // Nog niet gevraagd of niet expliciet beslist. Toon een vriendelijk aanbod.
            setMessages((p2) => [...p2, { role: "assistant", content: "Ik kan met je praten als je dat wilt — vraag stelt, ik antwoord met spraak. Geef je microfoon-toestemming als je dit wilt activeren." , offerMicPermission: true }]);
          }
        }
      } catch (e) { void e; /* permissions API niet ondersteund, geen ramp */ }

      // Zet relevante acties rond de cirkel (zonder bestaande te verwijderen).
      const acts = [];
      if (imps.length) acts.push("Vat de verbeterpunten samen");
      if (inbox.connected && inbox.emails && inbox.emails.length) acts.push("Toon mails die aandacht vragen");
      else acts.push("Koppel mijn e-mail");
      acts.push("Wat kun je voor me doen?");
      setTimeout(() => placeActions(acts.slice(0, 4)), 600);
    }
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notificaties: vraag permissie en sla voorkeur op
  // Vraag actief microfoon-toestemming. Triggert browser-pop-up direct.
  // Wordt aangeroepen via de welkom-knop "🎙 Sta microfoon toe".
  async function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ Microfoon-API niet beschikbaar in deze browser." }]);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      stream.getTracks().forEach((t) => t.stop());
      setMessages((m) => [...m, { role: "assistant", content: "✓ Microfoon-toestemming gegeven. Klik op de mic-knop bij de chat om te praten, of zet 'Continu luisteren' aan in instellingen voor handsfree gebruik." }]);
      setToast({ icon: "🎙", text: "Microfoon toegestaan", color: "#5DCAA5" });
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      const reason = err.name === "NotAllowedError" ? "geweigerd" :
                     err.name === "NotFoundError" ? "geen microfoon gevonden" :
                     err.name === "NotReadableError" ? "in gebruik door andere app" :
                     err.message || "onbekend";
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ Microfoon-toestemming niet verkregen (${reason}). Je kunt het later opnieuw proberen via instellingen.` }]);
    }
  }

  async function toggleNotifications() {
    if (!notifEnabled) {
      // Aanvragen
      if (typeof Notification === "undefined") {
        setMessages((m) => [...m, { role: "assistant", content: "Notificaties worden niet ondersteund in deze browser." }]);
        return;
      }
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      setNotifPermission(perm);
      if (perm === "granted") {
        setNotifEnabled(true);
        try { localStorage.setItem("nova_notif_enabled", "1"); } catch { /* doorgaan */ }
        // Probeer een test-notificatie
        try { new Notification("NOVA", { body: "Notificaties staan aan. Ik laat je weten als er nieuwe mail of WhatsApp binnenkomt." }); } catch { /* doorgaan */ }
      } else {
        setMessages((m) => [...m, { role: "assistant", content: "Notificaties geblokkeerd. Sta ze toe in je browser-instellingen om gewaarschuwd te worden." }]);
      }
    } else {
      setNotifEnabled(false);
      try { localStorage.setItem("nova_notif_enabled", "0"); } catch { /* doorgaan */ }
    }
  }

  // Polling voor nieuwe mails en WhatsApp - elke 2 minuten checken
  useEffect(() => {
    if (!token || !notifEnabled) return;
    let stopped = false;

    // Initiële seen-set vullen zodat we niet ALLES als nieuw melden
    seenMailIdsRef.current = new Set((emailsRef.current || []).map((m) => m.id || (m.from + m.subject)));

    const poll = async () => {
      if (stopped) return;
      try {
        const rMail = await fetch(INBOX_URL, { headers: { Authorization: "Bearer " + token } });
        const dMail = await rMail.json();
        if (dMail.connected && Array.isArray(dMail.emails)) {
          const nieuwe = dMail.emails.filter((m) => {
            const id = m.id || (m.from + m.subject);
            return !seenMailIdsRef.current.has(id) && m.unread;
          });
          // Update seen set
          for (const m of dMail.emails) {
            seenMailIdsRef.current.add(m.id || (m.from + m.subject));
          }
          // Update emails-state met de nieuwe lijst
          setEmails(dMail.emails);
          // Notificeer nieuwe mails
          if (nieuwe.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const m of nieuwe.slice(0, 3)) {
              try {
                const n = new Notification(`📧 ${m.fromName || m.from}`, {
                  body: m.subject + (m.snippet ? "\n" + m.snippet.slice(0, 80) : ""),
                  tag: "nova-mail-" + (m.id || m.subject),
                });
                n.onclick = () => { window.focus(); n.close(); };
              } catch { /* doorgaan */ }
            }
          }
        }
      } catch { /* doorgaan */ }

      // WhatsApp polling
      try {
        const rWA = await fetch("/api/whatsapp?action=inbox", { headers: { Authorization: "Bearer " + token } });
        const dWA = await rWA.json();
        if (Array.isArray(dWA.items)) {
          const nieuwe = dWA.items.filter((m) => {
            const id = m.id || (m.from + m.timestamp);
            return !seenWAIdsRef.current.has(id) && !m.read;
          });
          for (const m of dWA.items) {
            seenWAIdsRef.current.add(m.id || (m.from + m.timestamp));
          }
          if (nieuwe.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const m of nieuwe.slice(0, 3)) {
              try {
                const n = new Notification(`💬 ${m.fromName || m.from}`, {
                  body: m.body ? m.body.slice(0, 120) : "Nieuw WhatsApp-bericht",
                  tag: "nova-wa-" + (m.id || m.timestamp),
                });
                n.onclick = () => { window.focus(); n.close(); };
              } catch { /* doorgaan */ }
            }
          }
        }
      } catch { /* doorgaan */ }
    };

    // Eerste poll direct, daarna elke 2 minuten
    poll();
    const iv = setInterval(poll, 120000);
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, notifEnabled]);

  async function loadFinancials(force = false) {
    if (financialsLoading) return;
    if (financials && !force) return;
    setFinancialsLoading(true);
    try {
      const r = await fetch("/api/boeksy?action=financials", { headers: { Authorization: "Bearer " + token } });
      const d = await r.json();
      if (r.ok) setFinancials(d);
      else setFinancials({ error: d.error || "Kon financieel overzicht niet ophalen" });
    } catch (e) {
      setFinancials({ error: e.message });
    } finally {
      setFinancialsLoading(false);
    }
  }

  function openFinancials() {
    setShowFinancials(true);
    loadFinancials();
  }

  async function addImprovement(text) {
    try {
      const res = await fetch(IMPROVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ text, source: "nova" }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setImprovements(d.items);
      // Visuele bevestiging: toast vliegt naar het ✨-icoon. Eerst meten we waar
      // het icoon zich bevindt. Op het moment van setImprovements is het icoon
      // (mogelijk net pas) zichtbaar; we wachten een frame zodat React kan
      // renderen voor we de positie meten.
      requestAnimationFrame(() => {
        const iconEl = improveIconRef.current;
        let target = null;
        if (iconEl) {
          const r = iconEl.getBoundingClientRect();
          target = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        setToast({ icon: "✨", text: "Verbeterpunt opgeslagen", color: AMBER, target });
        setTimeout(() => setToast(null), 2400);
        // Het icoon pulseert kort op aankomst van de toast
        setTimeout(() => setImproveJustAdded(true), 1400);
        setTimeout(() => setImproveJustAdded(false), 2900);
      });
    } catch (e) { void e; }
  }

  async function deleteImprovement(id, all) {
    try {
      const res = await fetch(IMPROVE_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(all ? { all: true } : { id }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setImprovements(d.items);
    } catch (e) { void e; }
  }

  function copyImprovements() {
    const txt =
      "Verbeterpunten voor de Agent van JnA Events (verzameld door NOVA):\n\n" +
      improvements.map((i, n) => `${n + 1}. ${i.text}`).join("\n") +
      "\n\nGraag deze punten verwerken in de volgende update.";
    navigator.clipboard?.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function addProduct() {
    const name = prodName.trim();
    if (!name) return;
    try {
      const res = await fetch(CATALOG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ name, category: prodCat.trim() }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) { setCatalog(d.items); setProdName(""); setProdCat(""); }
    } catch (e) { void e; }
  }
  async function deleteProduct(id) {
    try {
      const res = await fetch(CATALOG_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setCatalog(d.items);
    } catch (e) { void e; }
  }

  async function addToCalendar(plan) {
    try {
      const res = await fetch(CALENDAR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(plan),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setCalendar(d.items);
    } catch (e) { void e; }
  }
  async function deleteCalendarItem(id) {
    try {
      const res = await fetch(CALENDAR_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setCalendar(d.items);
    } catch (e) { void e; }
  }

  async function toggleOnboardStep(stepId, done) {
    try {
      const res = await fetch(ONBOARDING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ stepId, done }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setOnboarding(d.items);
      if (d.integrations) setIntegrations(d.integrations);
    } catch (e) { void e; }
  }

  // Download alle data als backup-JSON
  async function downloadBackup() {
    try {
      const res = await fetch(BACKUP_URL, { headers: { Authorization: "Bearer " + token } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "backup mislukte");
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nova-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Backup mislukt: " + err.message);
    }
  }

  // Haal status opnieuw op (gebruikt door NOVA-commando 'controleer integraties')
  async function refreshStatus() {
    try {
      const res = await fetch(ONBOARDING_URL, { headers: { Authorization: "Bearer " + token } });
      const d = await res.json();
      if (Array.isArray(d.items)) setOnboarding(d.items);
      if (d.integrations) setIntegrations(d.integrations);
      return d.integrations || {};
    } catch (e) { return {}; }
  }

  async function saveImapSettings(host, port, user, pass) {
    try {
      const res = await fetch("/api/mail?action=settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ host, port, user, pass }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "fout bij opslaan");
      setImapCfg(d);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function clearImapSettings() {
    try {
      const res = await fetch("/api/mail?action=settings", {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const d = await res.json();
      setImapCfg(d);
    } catch (e) { void e; }
  }

  // Maak een offerte aan in Boeksy als concept. Vereist een goedgekeurde
  // pendingQuote met klant-naam, lines, etc. We zoeken klant-naam op in de
  // bestaande relaties om de relation_id te vinden.
  async function createQuote(quote) {
    const b = boeksyRef.current;
    const klant = (b?.relations || []).find((r) =>
      r.name.toLowerCase() === quote.relation.toLowerCase() ||
      r.name.toLowerCase().includes(quote.relation.toLowerCase())
    );
    if (!klant) {
      setMessages((m) => [...m, { role: "assistant", content: `Klant "${quote.relation}" niet gevonden in Boeksy. Voeg de klant eerst toe via Boeksy, daarna probeer ik het opnieuw.` }]);
      return;
    }
    try {
      const res = await fetch("/api/boeksy?action=create-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          relation_id: klant.id,
          subject: quote.subject,
          event_date: quote.event_date || undefined,
          lines: quote.lines,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "kon offerte niet maken");
      const number = d.quote?.number || d.quote?.quote_number || "concept";
      const melding = `Offerte ${number} aangemaakt als concept in Boeksy voor ${klant.name}. Je kunt hem nu in Boeksy openen en versturen.`;
      setMessages((m) => [...m, { role: "assistant", content: melding }]);
      if (voiceOn) speak(melding);
      // Refresh Boeksy data
      try {
        const rB = await fetch(BOEKSY_URL, { headers: { Authorization: "Bearer " + token } });
        const dB = await rB.json();
        dB.events = deriveBoeksyEvents(dB);
        dB.followUps = deriveFollowUpQuotes(dB);
        setBoeksy(dB);
      } catch (e) { void e; }
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: "Kon offerte niet aanmaken: " + err.message }]);
    }
  }

  async function sendWhatsApp(to, message) {
    try {
      const res = await fetch(WHATSAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ to, message }),
      });
      const d = await res.json();
      if (!res.ok) {
        const reason = d.hint || d.error || "onbekende fout";
        setMessages((p) => [...p, { role: "assistant", content: "WhatsApp niet verstuurd: " + reason }]);
        return;
      }
      setMessages((p) => [...p, { role: "assistant", content: "WhatsApp verstuurd naar " + to + " via " + (d.provider || "provider") + "." }]);
    } catch (err) {
      setMessages((p) => [...p, { role: "assistant", content: "Kon WhatsApp niet versturen: " + (err.message || "onbekende fout") }]);
    }
  }

  // Start de multi-agent contentpost workflow.
  // Fase 1: alleen Marketing Director werkt, levert het concept.
  // Daarna vraagt NOVA goedkeuring. Pas dan start fase 2 (de andere drie agents).
  async function startPostWorkflow({ channel, topic }) {
    const id = "post-mag-" + Date.now();
    const placeholder = {
      id,
      channel,
      topic,
      phase: "concept-running", // concept-running, concept-awaiting, production-running, production-awaiting, approved, error
      created: new Date().toISOString(),
      agents: [{ name: "Marketing Director", role: "marketing", state: "running", progress: 6, slot: pickPostSlot([]) }],
      strategie: "",
      copy: "",
      visual: "",
      regie: "",
      imagePrompts: [],
      images: [],
    };
    setPosts((prev) => [placeholder, ...prev]);

    // Voortgangsbalk vult op terwijl Marketing Director werkt
    const prog = setInterval(() => {
      setPosts((prev) => prev.map((p) => {
        if (p.id !== id || p.phase !== "concept-running") return p;
        const agents = p.agents.map((a) => a.state === "running" ? { ...a, progress: Math.min(a.progress + Math.random() * 9 + 3, 94) } : a);
        return { ...p, agents };
      }));
    }, 700);

    try {
      // Helper: bouw extra context die alle drie de fases meekrijgen
      const extraBody = {
        snippets: snippetsRef.current || [],
        // Voor toekomstige uitbreiding: als de post gekoppeld is aan een event,
        // sturen we de event-context mee. Voor nu null - kan later toegevoegd
        // worden via de "post bij event"-flow.
        eventContext: null,
      };
      const res = await fetch(POST_WORKFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ phase: "concept", channel, topic, catalog: catalogRef.current, ...extraBody }),
      });
      const d = await res.json();
      clearInterval(prog);
      if (!res.ok) throw new Error(d.error || "concept fout");

      setPosts((prev) => prev.map((p) => p.id === id ? {
        ...p,
        phase: "concept-awaiting",
        strategie: d.strategie,
        agents: [{ name: "Marketing Director", role: "marketing", state: "awaiting", progress: 100, slot: p.agents[0].slot }],
      } : p));

      // NOVA meldt hardop dat het concept klaar is en biedt de keuze
      const melding = `Het plan voor de ${channel} over ${topic} staat klaar. Wil je dat ik het voorlees, of kom je er later op terug?`;
      setMessages((m) => [...m, { role: "assistant", content: melding }]);
      speak(melding);
      // Auto-open het concept-paneel zodat gebruiker direct ziet wat NOVA heeft.
      // Voorheen moest hij "Toon op scherm" kiezen — onnodige stap.
      setOpenPost(id);
      setTimeout(() => placeActions(["Lees voor", "Goedkeuren", "Later"]), 600);
    } catch (err) {
      clearInterval(prog);
      setPosts((prev) => prev.map((p) => p.id === id ? { ...p, phase: "error", error: err.message } : p));
    }
  }

  // Vrije slot rond de cirkel kiezen voor een postcard
  function pickPostSlot(usedSlots) {
    const taskSlotsUsed = tasksRef.current.map((t) => t.slot);
    const allUsed = [...taskSlotsUsed, ...usedSlots];
    const slot = TASK_SLOTS.findIndex((_, i) => !allUsed.includes(i));
    return slot < 0 ? Math.floor(Math.random() * TASK_SLOTS.length) : slot;
  }

  // Goedkeur het concept en start de productie-fase (3 agents parallel)
  async function approveConcept(postId) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    // Drie productie-agents toevoegen, elk op een eigen slot
    const slot1 = pickPostSlot([post.agents[0].slot]);
    const slot2 = pickPostSlot([post.agents[0].slot, slot1]);
    const slot3 = pickPostSlot([post.agents[0].slot, slot1, slot2]);

    setPosts((prev) => prev.map((p) => p.id === postId ? {
      ...p,
      phase: "production-running",
      agents: [
        { ...p.agents[0], state: "done", progress: 100 },
        { name: "Content Creator", role: "content", state: "running", progress: 6, slot: slot1 },
        { name: "Visual Director", role: "visual", state: "running", progress: 6, slot: slot2 },
        { name: "Video Director", role: "video", state: "running", progress: 6, slot: slot3 },
      ],
    } : p));

    const prog = setInterval(() => {
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId || p.phase !== "production-running") return p;
        const agents = p.agents.map((a) => a.state === "running" ? { ...a, progress: Math.min(a.progress + Math.random() * 7 + 2, 94) } : a);
        return { ...p, agents };
      }));
    }, 700);

    try {
      const res = await fetch(POST_WORKFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ phase: "production", channel: post.channel, topic: post.topic, concept: post.strategie, catalog: catalogRef.current, snippets: snippetsRef.current || [], eventContext: post.eventContext || null }),
      });
      const d = await res.json();
      clearInterval(prog);
      if (!res.ok) throw new Error(d.error || "productie fout");

      setPosts((prev) => prev.map((p) => p.id === postId ? {
        ...p,
        phase: "production-awaiting",
        copy: d.copy,
        visual: d.visual,
        regie: d.regie,
        imagePrompts: d.imagePrompts || [],
        agents: p.agents.map((a) => a.state === "running" ? { ...a, state: "done", progress: 100 } : a),
      } : p));

      const melding = `De content voor de ${post.channel} over ${post.topic} is klaar. Wil je dat ik het voorlees, of kom je er later op terug?`;
      setMessages((m) => [...m, { role: "assistant", content: melding }]);
      speak(melding);
      // Auto-open Marketing-detail zodra productie klaar. Vanaf daar ziet de gebruiker
      // de overzichtspagina en kan doorklikken naar Content, Visual of Video.
      setOpenAgentDetail({ postId, role: "marketing" });
      setTimeout(() => placeActions(["Lees voor", "Plaats", "Later"]), 600);
    } catch (err) {
      clearInterval(prog);
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, phase: "error", error: err.message } : p));
    }
  }

  function rejectConcept(postId, feedback) {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    const note = feedback && feedback.trim() ? feedback : "concept niet akkoord";
    setMessages((m) => [...m, { role: "user", content: `Concept afgewezen: ${note}` }]);
    setMessages((m) => [...m, { role: "assistant", content: "Begrepen. Geef aan wat je anders wilt, dan probeer ik het opnieuw." }]);
  }

  function speakConcept(postId) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    speak(post.strategie);
  }

  function speakFullContent(postId) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const tekst = `Het plan was: ${post.strategie}. De caption: ${post.copy}. En de video: ${post.regie}.`;
    speak(tekst);
  }

  // Genereer een AI-beeld voor een specifieke visual-prompt binnen een post.
  async function generateImage(postId, promptIndex, extraInstructions = "") {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const basePrompt = post.imagePrompts[promptIndex];
    if (!basePrompt) return;
    // Bij regenereren: voeg extra instructies toe aan de prompt
    const prompt = extraInstructions
      ? `${basePrompt}\n\nExtra: ${extraInstructions}`
      : basePrompt;

    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      const images = [...(p.images || [])];
      images[promptIndex] = { prompt, state: "generating", image: null, extraInstructions };
      return { ...p, images };
    }));

    try {
      const size = post.channel === "tiktok" || post.channel === "instagram" ? "1024x1536" : "1024x1024";
      const res = await fetch(IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ prompt, size, quality: "medium" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.hint || d.error || "beeld mislukte");
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        const images = [...(p.images || [])];
        images[promptIndex] = { prompt, state: "done", image: d.image, extraInstructions };
        return { ...p, images };
      }));
    } catch (err) {
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        const images = [...(p.images || [])];
        images[promptIndex] = { prompt, state: "error", error: err.message, extraInstructions };
        return { ...p, images };
      }));
    }
  }

  function approveContentPost(postId) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    addToCalendar({
      channel: post.channel,
      title: post.topic,
      when: new Date().toISOString(),
      body: post.copy || post.topic,
    });
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, phase: "approved" } : p));
  }

  // Specialist herzien op basis van gebruikersfeedback. Marketing kijkt of de
  // wijziging ook impact heeft op de andere specialisten en past die zo nodig aan.
  async function reviseAgent(postId, role, feedback) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const currentOutput = role === "content" ? post.copy : role === "visual" ? post.visual : role === "video" ? post.regie : "";

    // Zet de te herziene agent terug op "running"
    setPosts((prev) => prev.map((p) => {
      if (p.id !== postId) return p;
      return {
        ...p,
        phase: "production-running",
        agents: p.agents.map((a) => a.role === role ? { ...a, state: "running", progress: 12 } : a),
      };
    }));

    try {
      const res = await fetch(POST_WORKFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ phase: "revise", channel: post.channel, topic: post.topic, concept: post.strategie, role, feedback, currentOutput, catalog: catalogRef.current, snippets: snippetsRef.current || [], eventContext: post.eventContext || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "herziening fout");

      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId) return p;
        const next = { ...p, phase: "production-awaiting" };
        // Werk het hoofd-veld bij van de gevraagde rol
        if (role === "content") next.copy = d.newOutput;
        else if (role === "visual") next.visual = d.newOutput;
        else if (role === "video") next.regie = d.newOutput;
        // Werk eventuele andere specialisten bij als Marketing aangaf dat ze ook moeten worden aangepast
        if (d.otherUpdates) {
          if (d.otherUpdates.content) next.copy = d.otherUpdates.content;
          if (d.otherUpdates.visual) next.visual = d.otherUpdates.visual;
          if (d.otherUpdates.video) next.regie = d.otherUpdates.video;
        }
        // Nieuwe image prompts? Reset gegenereerde beelden zodat ze opnieuw gemaakt worden
        if (d.newImagePrompts && d.newImagePrompts.length) {
          next.imagePrompts = d.newImagePrompts;
          next.images = [];
        }
        next.agents = p.agents.map((a) => {
          if (a.role === role || (d.otherUpdates && d.otherUpdates[a.role])) {
            return { ...a, state: "done", progress: 100 };
          }
          return a;
        });
        next.marketingNote = d.marketingNote || null;
        return next;
      }));

      const melding = d.marketingNote
        ? `Aanpassing doorgevoerd. Marketing heeft ook de andere specialisten laten bijwerken: ${d.marketingNote}`
        : `Aanpassing doorgevoerd in ${role}. De andere onderdelen blijven ongewijzigd.`;
      setMessages((m) => [...m, { role: "assistant", content: melding }]);
      if (voiceOn) speak(melding);
    } catch (err) {
      setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, phase: "error", error: err.message } : p));
    }
  }

  useEffect(() => {
    setIdleStars(Array.from({ length: 6 }, (_, i) => ({ id: "idle-" + i, ...orbitPos(), delay: Math.random() * 7, dur: 7 + Math.random() * 4, size: 5 + Math.random() * 4 })));
    const iv = setInterval(() => { setIdleStars((prev) => prev.map((s) => (Math.random() < 0.4 ? { ...s, ...orbitPos() } : s))); }, 3500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function load() {
      const voices = window.speechSynthesis?.getVoices() || [];
      voicesRef.current = voices;
      // Filter op Nederlands en sorteer op kwaliteit
      const nl = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
      const scored = nl.map((v) => {
        let score = 0;
        if (/natural|neural|wavenet/i.test(v.name)) score += 100;
        if (/online|premium|enhanced/i.test(v.name)) score += 50;
        if (/google|microsoft/i.test(v.name)) score += 30;
        return { ...v, name: v.name, lang: v.lang, score };
      }).sort((a, b) => b.score - a.score);
      setAvailableVoices(scored.map((v) => ({ name: v.name, lang: v.lang })));
    }
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setMicSupported(false); return; }
    const rec = new SR();
    rec.lang = "nl-NL";
    rec.continuous = false;
    // Interim resultaten aan zodat we tijdens spreken al iets zien.
    // Op iOS Safari geeft dit veel responsievere feedback - de gebruiker ziet
    // zijn woorden meteen verschijnen in plaats van pas na het eindigen.
    rec.interimResults = true;
    // Maximale 1 alternatief - meer is overhead op mobiel.
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      // Loop door alle results - bij interim krijgen we tussentijdse versies
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      // Toon interim resultaat alvast in het invoer-veld
      if (interimText) setInput(interimText);
      if (finalText) {
        vadStateRef.current.currentlyRecognizing = false;
        setInput(finalText);
        setListening(false);
        // Bied always-listen aan na eerste push-to-talk uiting in deze sessie
        if (!alwaysListen && !suggestedAlwaysListenRef.current) {
          suggestedAlwaysListenRef.current = true;
          setTimeout(() => {
            const tip = "Wist je dat ik continu kan luisteren? Klik in het stem-paneel (🔊 rechtsboven) op 'Microfoon altijd aan', dan kun je vrij praten zonder telkens de mic-knop te drukken.";
            setMessages((m) => [...m, { role: "assistant", content: tip }]);
          }, 2000);
        }
        // Verstuur direct, geen vertraging meer
        sendMessage(finalText);
      }
    };

    rec.onerror = (e) => {
      vadStateRef.current.currentlyRecognizing = false;
      setListening(false);
      // Maak de fout zichtbaar zodat de gebruiker weet waarom er niks gebeurt
      const err = e.error || "onbekende fout";
      const uitleg =
        err === "no-speech" ? "Geen spraak gehoord. Probeer iets harder of dichter bij de microfoon te praten." :
        err === "audio-capture" ? "Geen microfoon-toegang. Check de permissies in je browser." :
        err === "not-allowed" ? "Microfoon-toegang geweigerd. Sta de microfoon toe in je browserinstellingen." :
        err === "network" ? "Netwerk-fout bij spraakherkenning. Op Android/Chrome wordt je stem naar Google's servers gestuurd voor analyse - dat lukt nu niet. Probeer een ander netwerk of probeer over een paar seconden opnieuw." :
        err === "service-not-allowed" ? "Spraakherkenning niet toegestaan in deze browser." :
        err === "aborted" ? null : // gebruiker stopte zelf - geen melding nodig
        `Spraakfout: ${err}`;
      if (uitleg) {
        // Niet steeds opnieuw tonen als always-listen elke paar seconden hetzelfde geeft
        if (!window._novaLastSpeechError || Date.now() - window._novaLastSpeechError > 8000) {
          window._novaLastSpeechError = Date.now();
          setStatus(uitleg);
          setMessages((m) => [...m, { role: "assistant", content: "⚠️ " + uitleg }]);
        }
      }
    };

    rec.onend = () => {
      vadStateRef.current.currentlyRecognizing = false;
      setListening(false);
    };
    recognitionRef.current = rec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // VAD (Voice Activity Detection) start de microfoon in continue modus.
  // We meten RMS-volume; als het boven de drempel komt EN NOVA niet zelf
  // aan het praten is EN we niet net herkennen, starten we spraakherkenning.
  async function startAlwaysListen() {
    if (!recognitionRef.current) { setStatus("Spraak niet ondersteund in deze browser"); return false; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,    // belangrijk: voorkomt dat NOVA's eigen stem haar triggert
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const VOICE_THRESHOLD = 0.045; // genormaliseerde RMS waarboven het stem lijkt
      const VOICE_FRAMES_TO_TRIGGER = 3; // ~150ms aanhoudend boven drempel
      const SILENCE_FRAMES_TO_RESET = 30; // ~1.5s stilte na uiting

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(buf);
        // RMS berekenen, genormaliseerd op 0-1
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel(rms);

        const st = vadStateRef.current;
        // Niet luisteren als gedempt, NOVA praat, of we al bezig zijn.
        // micMutedRef.current geeft altijd de actuele waarde - state via closure
        // gaf stale data en mute werkte daarom niet.
        if (!micMutedRef.current && !speaking && !st.currentlyRecognizing) {
          if (rms > VOICE_THRESHOLD) {
            st.voiceCount++;
            st.silenceCount = 0;
            if (st.voiceCount >= VOICE_FRAMES_TO_TRIGGER) {
              // Trigger spraakherkenning
              st.currentlyRecognizing = true;
              st.voiceCount = 0;
              setListening(true);
              setStatus("Luisteren...");
              try { recognitionRef.current.start(); }
              catch { st.currentlyRecognizing = false; setListening(false); }
            }
          } else {
            st.silenceCount++;
            if (st.silenceCount > SILENCE_FRAMES_TO_RESET) st.voiceCount = 0;
          }
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
      setStatus("Microfoon staat aan, ik luister naar je stem");
      return true;
    } catch (err) {
      console.error("VAD start mislukt:", err);
      setStatus("Geef toegang tot je microfoon en probeer opnieuw");
      return false;
    }
  }

  function stopAlwaysListen() {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    if (recognitionRef.current && vadStateRef.current.currentlyRecognizing) {
      try { recognitionRef.current.stop(); } catch { /* doorgaan */ }
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* doorgaan */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    vadStateRef.current = { voiceCount: 0, silenceCount: 0, currentlyRecognizing: false };
    setMicLevel(0);
    setListening(false);
  }

  async function toggleAlwaysListen() {
    if (alwaysListen) {
      stopAlwaysListen();
      setAlwaysListen(false);
      try { localStorage.setItem("nova_always_listen", "0"); } catch { /* doorgaan */ }
      setStatus("Klaar voor je opdracht");
    } else {
      const ok = await startAlwaysListen();
      if (ok) {
        setAlwaysListen(true);
        try { localStorage.setItem("nova_always_listen", "1"); } catch { /* doorgaan */ }
      }
    }
  }

  // Cleanup bij component unmount
  useEffect(() => () => stopAlwaysListen(), []);

  function pickVoice() {
    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis?.getVoices() || [];
    const nl = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
    if (!nl.length) return null;
    // Eerst: door gebruiker handmatig gekozen stem
    if (voiceName) {
      const hit = nl.find((v) => v.name === voiceName);
      if (hit) return hit;
    }
    // Anders: automatische keuze op kwaliteit-tiers
    const tiers = [
      /natural|neural|wavenet/i,
      /online|premium|enhanced/i,
      /google|microsoft/i,
      /fenna|colette|claire|lotte|saskia/i,
    ];
    for (const tier of tiers) {
      const hit = nl.find((v) => tier.test(v.name));
      if (hit) return hit;
    }
    return nl[0];
  }

  // Audio-element voor OpenAI TTS afspelen. Eén element dat we steeds hergebruiken.
  const ttsAudioRef = useRef(null);
  const improveIconRef = useRef(null); // referentie naar het ✨-icoon zodat de toast er heen kan vliegen
  useEffect(() => {
    ttsAudioRef.current = new Audio();
    ttsAudioRef.current.preload = "auto";
  }, []);

  // Spreek een tekst uit. Werkt via twee paden:
  // 1. browser (default, gratis, kwaliteit varieert per apparaat)
  // 2. openai (consistent over apparaten, kost ongeveer 1,5 cent per 1000 karakters)
  function speak(text, role = "nova") {
    if (!voiceOn) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;

    // Kies de juiste stem afhankelijk van de rol. Lege string = gebruik default.
    const roleVoice = agentVoices[role] || "";
    const effectiveVoice = roleVoice || voiceName || "nova";

    // OpenAI TTS pad
    if (ttsProvider === "openai") {
      if (ttsAudioRef.current) {
        try { ttsAudioRef.current.pause(); ttsAudioRef.current.currentTime = 0; } catch { /* doorgaan */ }
      }
      window.speechSynthesis?.cancel();
      setSpeaking(true);
      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ text: clean, voice: effectiveVoice, model: "tts-1" }),
      }).then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          // Toon de fout EEN keer per sessie in de chat zodat de gebruiker weet wat er gebeurt
          if (!window._novaTtsErrorShown) {
            window._novaTtsErrorShown = true;
            const detail = err.error || "onbekende fout";
            setMessages((m) => [...m, { role: "assistant", content: `⚠️ OpenAI-stem niet beschikbaar (${detail}). Ik val terug op de browser-stem. Check of OPENAI_API_KEY in Vercel staat en of api/tts.js is gedeployd.` }]);
          }
          console.warn("TTS via OpenAI mislukt:", err.error);
          setSpeaking(false);
          speakBrowser(clean, role);
          return;
        }
        const blob = await r.blob();
        // Sanity-check: een audio-blob hoort minimaal een paar KB te zijn
        if (blob.size < 200) {
          if (!window._novaTtsErrorShown) {
            window._novaTtsErrorShown = true;
            setMessages((m) => [...m, { role: "assistant", content: "⚠️ OpenAI gaf een lege audio-respons. Val terug op browser-stem." }]);
          }
          setSpeaking(false);
          speakBrowser(clean, role);
          return;
        }
        const url = URL.createObjectURL(blob);
        const audio = ttsAudioRef.current;
        audio.src = url;
        audio.playbackRate = voiceRate;
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        audio.play().catch((e) => {
          console.warn("Audio play mislukte:", e.message);
          setSpeaking(false);
          // Niet als fout tonen want dit gebeurt soms door autoplay-restricties
        });
      }).catch((e) => {
        if (!window._novaTtsErrorShown) {
          window._novaTtsErrorShown = true;
          setMessages((m) => [...m, { role: "assistant", content: `⚠️ Netwerkfout bij OpenAI-stem (${e.message}). Val terug op browser-stem.` }]);
        }
        console.warn("TTS netwerkfout:", e.message);
        setSpeaking(false);
        speakBrowser(clean, role);
      });
      return;
    }

    // Browser TTS pad (browser-stemmen zijn beperkter; we proberen op naam te matchen)
    speakBrowser(clean, role);
  }

  function speakBrowser(clean, role = "nova") {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const nl = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
    let voice = null;
    const roleVoice = agentVoices[role];
    if (roleVoice) {
      voice = nl.find((v) => v.name === roleVoice);
    }
    if (!voice) voice = pickVoice();

    // De hele tekst in één utterance plaatsen voorkomt onnatuurlijke
    // pauzes tussen zinnen. De voorganger die per zin een aparte utterance
    // maakte voegde elke keer een merkbare gap toe op vooral mobiel.
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "nl-NL";
    u.rate = voiceRate;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (voice) u.voice = voice;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }
  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); ttsAudioRef.current.currentTime = 0; } catch { /* doorgaan */ }
    }
    setSpeaking(false);
  }
  function toggleVoice() { if (voiceOn) stopSpeaking(); setVoiceOn((v) => !v); }

  // Pas spraaktempo aan en sla op zodat het bewaard blijft tussen sessies.
  function updateVoiceRate(rate) {
    setVoiceRate(rate);
    try { localStorage.setItem("nova_voice_rate", String(rate)); } catch (e) { void e; }
  }

  function updateVoiceName(name) {
    setVoiceName(name);
    try { localStorage.setItem("nova_voice_name", name || ""); } catch (e) { void e; }
  }

  function updateTtsProvider(p) {
    setTtsProvider(p);
    try { localStorage.setItem("nova_tts_provider", p); } catch (e) { void e; }
  }

  // Korte test-zin uitspreken zodat je het effect direct hoort.
  function testVoice(rate) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Zo klink ik bij dit tempo.");
    u.lang = "nl-NL";
    u.rate = rate;
    u.pitch = 1.0;
    const v = pickVoice(); if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }

  // Diagnose-functie die stap voor stap test waar de mic-keten breekt.
  // useNoiseReduction = true: stream met echoCancellation/noiseSuppression/autoGainControl
  // useNoiseReduction = false: stream met audio:true (basis, geen opties)
  async function runMicDiagnose(useNoiseReduction = true) {
    setShowMicDiag(true);
    setMicDiag({ running: true, steps: [] });
    const log = [];

    // Stap 1: Browser-detectie
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChrome = /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor || "");
    let browser = "onbekend";
    if (isIOS && isSafari) browser = "iPhone Safari";
    else if (isIOS) browser = "iPhone (andere browser - gebruikt ook Safari engine)";
    else if (isChrome) browser = "Chrome";
    else if (isSafari) browser = "Safari (desktop)";
    log.push({ stap: "1. Browser", status: "ok", detail: browser, info: ua.slice(0, 80) });

    // Stap 2: SpeechRecognition beschikbaar?
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      log.push({ stap: "2. SpeechRecognition API", status: "fout", detail: "Niet beschikbaar in deze browser", info: "Op iOS werkt dit alleen vanaf Safari 14.5+. Mogelijk staat je iOS niet up-to-date." });
      setMicDiag({ running: false, steps: log });
      return;
    }
    log.push({ stap: "2. SpeechRecognition API", status: "ok", detail: window.SpeechRecognition ? "standaard" : "webkitSpeechRecognition (Safari)" });

    // Stap 3: Permissions API ondersteund?
    let permStatus = "onbekend";
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const p = await navigator.permissions.query({ name: "microphone" });
        permStatus = p.state; // 'granted', 'denied', 'prompt'
      } catch (e) {
        permStatus = "niet ondersteund (iOS Safari kent dit niet)";
      }
    }
    log.push({ stap: "3. Microfoon-permissie", status: permStatus === "granted" ? "ok" : permStatus === "denied" ? "fout" : "wacht", detail: permStatus, info: permStatus === "denied" ? "Toestemming geweigerd. Ga naar Instellingen > Safari > Microfoon en sta agents.jna-events.nl toe." : null });

    // Stap 4: getUserMedia werkt? Met zelfde audio-instellingen als always-listen
    // omdat iOS Safari spraakherkenning vereist dat de stream actief is.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log.push({ stap: "4. getUserMedia", status: "fout", detail: "Niet beschikbaar", info: "Zonder dit kan geen microfoon-toegang worden gevraagd." });
      setMicDiag({ running: false, steps: log });
      return;
    }
    let stream = null;
    try {
      const audioOpts = useNoiseReduction
        ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioOpts });
      log.push({ stap: "4. Microfoon-toegang", status: "ok", detail: useNoiseReduction ? "Stream met ruisonderdrukking verkregen" : "Stream zonder audio-opties verkregen (basis)" });
    } catch (err) {
      log.push({ stap: "4. Microfoon-toegang", status: "fout", detail: err.name + ": " + err.message, info: err.name === "NotAllowedError" ? "Op iOS: ga naar Instellingen > Safari > Microfoon en sta de site toe. Daarna deze pagina vernieuwen." : null });
      setMicDiag({ running: false, steps: log });
      return;
    }

    // Stap 5: SpeechRecognition kan starten - MET stream nog open
    log.push({ stap: "5. Test recognizer", status: "wacht", detail: "Aan het proberen..." });
    setMicDiag({ running: true, steps: [...log] });

    const testRec = new SR();
    testRec.lang = "nl-NL";
    testRec.continuous = false;
    testRec.interimResults = false;
    testRec.maxAlternatives = 1;
    const promise = new Promise((resolve) => {
      let resolved = false;
      const finish = (result) => { if (!resolved) { resolved = true; resolve(result); } };
      testRec.onstart = () => finish({ ok: true, msg: "Recognizer gestart - WERKT" });
      testRec.onerror = (e) => finish({ ok: false, msg: "Recognizer-fout: " + (e.error || "onbekend"), errcode: e.error });
      testRec.onend = () => finish({ ok: false, msg: "Recognizer stopte direct zonder feedback" });
      setTimeout(() => finish({ ok: false, msg: "Geen reactie binnen 3 seconden", errcode: "timeout" }), 3000);
      try {
        testRec.start();
      } catch (err) {
        finish({ ok: false, msg: "start() faalde direct: " + err.message });
      }
    });
    const result = await promise;
    try { testRec.stop(); } catch (e) { void e; }
    // NU pas de stream opruimen
    try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { void e; }

    if (result.ok) {
      log[log.length - 1] = { stap: "5. Test recognizer", status: "ok", detail: result.msg, info: "Mic werkt - probeer nu te praten via de mic-knop." };
    } else {
      let info = null;
      if (result.errcode === "network") info = "Spraak wordt naar Apple's servers gestuurd voor analyse, en die verbinding lukt nu niet. Probeer ander netwerk.";
      else if (result.errcode === "service-not-allowed") info = "iOS Safari heeft spraakherkenning niet toegestaan. Mogelijk is dicteren uit in Instellingen > Algemeen > Toetsenbord > Dicteren inschakelen.";
      else if (result.errcode === "not-allowed") info = "Microfoon geweigerd op API-niveau ondanks dat getUserMedia werkte. Vreemd - herstart browser.";
      log[log.length - 1] = { stap: "5. Test recognizer", status: "fout", detail: result.msg, info };
    }
    setMicDiag({ running: false, steps: log });
  }

  async function toggleMic() {
    if (!micSupported) {
      setStatus("Spraakherkenning niet ondersteund in deze browser");
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ Deze browser ondersteunt geen spraakherkenning. Op Android: gebruik Chrome. Op iOS: spraakherkenning via Safari werkt niet, gebruik Chrome op iOS." }]);
      return;
    }
    // In altijd-luister modus is deze knop een dempen-knop
    if (alwaysListen) {
      setMicMuted((m) => {
        const next = !m;
        micMutedRef.current = next; // direct bijwerken zodat VAD-loop het meteen ziet
        if (next) {
          // Bij dempen: stop een eventueel lopende recognition zodat huidige spraak
          // niet alsnog wordt verstuurd na een 1-seconde pauze.
          try { recognitionRef.current?.stop(); } catch (e) { void e; }
          if (vadStateRef.current) {
            vadStateRef.current.currentlyRecognizing = false;
            vadStateRef.current.voiceCount = 0;
          }
          setListening(false);
        }
        setStatus(next ? "Gedempt - klik nogmaals om mij weer te laten luisteren" : "Microfoon staat aan, ik luister naar je stem");
        return next;
      });
      return;
    }
    // Klassieke push-to-talk modus
    if (listening) {
      try { recognitionRef.current?.stop(); } catch (e) { void e; }
      setListening(false);
      return;
    }
    // Bestaat de recognizer wel?
    if (!recognitionRef.current) {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ Spraakherkenning is niet geïnitialiseerd. Probeer de pagina opnieuw te laden (Ctrl+Shift+R)." }]);
      return;
    }
    // Op mobiel moet getUserMedia ABSOLUUT vanuit een directe gebruikersinteractie
    // worden aangeroepen, anders blokkeert iOS Safari het permanent.
    //
    // LES GELEERD: iOS Safari's webkitSpeechRecognition vereist een actieve audio-stream
    // tijdens recognition. In always-listen modus hielden we de stream open en werkte het.
    // In push-to-talk sloten we de stream meteen, en kreeg recognition.start() een
    // 'service-not-allowed' fout omdat er geen actieve audio-input meer was.
    // Daarom houden we de stream nu open tijdens de herkenning, met dezelfde
    // echo/noise-onderdrukking als always-listen.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
    } catch (err) {
      const reason = err.name === "NotAllowedError" ? "geweigerd door gebruiker of door browser-instelling" :
                     err.name === "NotFoundError" ? "geen microfoon gevonden op dit apparaat" :
                     err.name === "NotReadableError" ? "microfoon wordt door een andere app gebruikt" :
                     err.name === "OverconstrainedError" ? "microfoon-instelling niet ondersteund" :
                     err.message || "onbekend";
      setStatus("Microfoon-fout: " + reason);
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ Geen toegang tot microfoon (${reason}). Op iOS: ga naar Instellingen > Safari > Microfoon en sta 'agents.jna-events.nl' toe.` }]);
      return;
    }

    // Stream bewaren in een ref zodat we hem kunnen sluiten nadat herkenning klaar is.
    // We hergebruiken de micStreamRef die ook door always-listen wordt gebruikt.
    micStreamRef.current = stream;

    // Stop spraak die misschien nog speelt voor we beginnen te luisteren
    stopSpeaking();
    setListening(true);
    setStatus("Luisteren...");

    // Helper om stream op te ruimen wanneer herkenning eindigt
    const cleanupStream = () => {
      if (micStreamRef.current === stream) {
        stream.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
    };

    // Eenmalige cleanup-listeners die zichzelf weer verwijderen.
    // We hangen ze BOVENOP de bestaande onresult/onerror/onend uit de useEffect-setup.
    const rec = recognitionRef.current;
    const origEnd = rec.onend;
    const origError = rec.onerror;
    rec.onend = (e) => {
      cleanupStream();
      rec.onend = origEnd;
      rec.onerror = origError;
      if (origEnd) origEnd(e);
    };
    rec.onerror = (e) => {
      cleanupStream();
      rec.onend = origEnd;
      rec.onerror = origError;
      if (origError) origError(e);
    };

    // start() kan falen op iOS als de vorige sessie nog niet helemaal is opgeruimd.
    // Korte retry met delay.
    try {
      rec.start();
    } catch (err) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        rec.start();
      } catch (err2) {
        cleanupStream();
        rec.onend = origEnd;
        rec.onerror = origError;
        setListening(false);
        setStatus("Spraakherkenning kon niet starten");
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ Spraakherkenning kon niet starten: ${err2.name || err2.message || "onbekend"}. Soms helpt het om de pagina opnieuw te laden.` }]);
      }
    }
  }

  const placeActions = useCallback((list) => {
    setActions(list.map((label, i) => ({ id: "act-" + Date.now() + "-" + i, label, ...orbitPos(i, list.length) })));
  }, []);

  async function callBackend(msgs, mode) {
    // Stuur compacte versie van mails mee zodat NOVA bij doorvragen weet wat er staat
    const mailContext = (emailsRef.current || []).slice(0, 20).map((m) => ({
      from: m.fromName || m.from,
      subject: m.subject,
      snippet: m.snippet,
      unread: !!m.unread,
      urgent: !!m.urgent,
      received: m.received,
    }));
    // Compacte Boeksy-context: klanten, recente facturen/offertes, W&V, events, follow-ups
    const b = boeksyRef.current;
    const boeksyContext = (b && b.configured) ? {
      relations: (b.relations || []).slice(0, 30).map((r) => ({ name: r.name, type: r.type, email: r.email })),
      invoices: (b.invoices || []).slice(0, 15).map((i) => ({ number: i.number, date: i.date, event_date: i.event_date, subject: i.subject, total: i.total, status: i.status, klant: i.relation })),
      quotes: (b.quotes || []).slice(0, 15).map((q) => ({ number: q.number, date: q.date, event_date: q.event_date, subject: q.subject, total: q.total, status: q.status, klant: q.relation })),
      profitLoss: b.profitLoss || null,
      financials: b.financials || null, // bankstand + BTW per kwartaal/jaar
      boeksyProducts: b.boeksyProducts || null, // standaard productencatalogus voor offerteopzet
      events: (b.events || []).slice(0, 10).map((e) => ({ date: e.date, days: e.days, subject: e.subject, klant: e.klant, source: e.boeksySource })),
      followUps: (b.followUps || []).slice(0, 10).map((f) => ({ number: f.number, klant: f.klant, subject: f.subject, daysOpen: f.daysOpen, total: f.total })),
    } : null;
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ messages: msgs, mode, catalog: catalogRef.current, integrations, voiceRate, emails: mailContext, boeksy: boeksyContext, lastViewed: lastViewedContext, snippets: snippetsRef.current, files: docFilesRef.current }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { onLogout(); throw new Error("Sessie verlopen, log opnieuw in."); }
    if (!res.ok) throw new Error(data.error || `Serverfout (${res.status})`);
    return data.reply || "";
  }

  function startTask({ agent, title, brief }) {
    const usedSlots = tasksRef.current.map((t) => t.slot);
    let slot = TASK_SLOTS.findIndex((_, i) => !usedSlots.includes(i));
    if (slot < 0) slot = 0;
    const id = "task-" + Date.now();
    setTasks((prev) => [...prev, { id, agent, title, brief, progress: 6, state: "running", result: "", slot, chat: [] }]);
    const prog = setInterval(() => {
      setTasks((prev) => prev.map((t) => (t.id === id && t.state === "running" ? { ...t, progress: Math.min(t.progress + Math.random() * 9 + 3, 94) } : t)));
    }, 700);
    callBackend([{ role: "user", content: brief }], "worker")
      .then((result) => { clearInterval(prog); setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, progress: 100, state: "awaiting", result, chat: [{ role: "assistant", content: result }] } : t))); })
      .catch(() => { clearInterval(prog); setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "error", result: "Deze taak kon niet worden afgerond." } : t))); });
  }

  // Bouw een briefing-overzicht voor een specifieke dag of periode.
  // "morgen", "vandaag", of "deze-week" (komende 7 dagen).
  function buildBriefing(scope = "morgen") {
    const now = new Date();
    let startMs, endMs, label;
    if (scope === "vandaag") {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      startMs = s.getTime(); endMs = e.getTime();
      label = "vandaag";
    } else if (scope === "deze-week") {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setDate(e.getDate() + 7); e.setHours(23, 59, 59, 999);
      startMs = s.getTime(); endMs = e.getTime();
      label = "komende 7 dagen";
    } else { // morgen
      const s = new Date(now); s.setDate(s.getDate() + 1); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setHours(23, 59, 59, 999);
      startMs = s.getTime(); endMs = e.getTime();
      label = "morgen";
    }

    // Events uit Boeksy (offertes/facturen met event_date) binnen het venster
    const b = boeksyRef.current;
    const events = (b?.events || []).filter((ev) => {
      const ms = new Date(ev.date).getTime();
      return ms >= startMs && ms <= endMs;
    });

    // Mails die nog ongelezen of urgent zijn
    const mails = (emailsRef.current || []).filter((m) => m.unread || m.urgent).slice(0, 5);

    // Open offertes (status open, niet geannuleerd) - via b.followUps + andere actuele
    const openQuotes = (b?.quotes || []).filter((q) => {
      const s = (q.status || "").toLowerCase();
      return !(s.includes("accepted") || s.includes("rejected") || s.includes("declined") || s.includes("paid") || s.includes("voldaan") || s.includes("geaccepteerd"));
    }).slice(0, 5);

    return { scope, label, events, mails, openQuotes };
  }

  // --- BEDRIJFSDOCUMENTEN HELPERS ---

  async function saveSnippet(key, value, label, category) {
    try {
      const r = await fetch("/api/documents?type=snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ key, value, label, category }),
      });
      const d = await r.json();
      if (Array.isArray(d.items)) setSnippets(d.items);
      return d.ok;
    } catch (e) { console.error("Snippet opslaan mislukt:", e); return false; }
  }

  async function deleteSnippet(key) {
    if (!window.confirm("Dit fragment verwijderen?")) return;
    try {
      const r = await fetch("/api/documents?type=snippets&key=" + encodeURIComponent(key), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const d = await r.json();
      if (Array.isArray(d.items)) setSnippets(d.items);
    } catch (e) { console.error("Snippet verwijderen mislukt:", e); }
  }

  // Bestand uploaden: leest een File-object en stuurt het als base64 naar server
  async function uploadDocFile(file, label, category) {
    if (!file) return;
    // Lees naar base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // result is dataURL, strip prefix
        const dataUrl = reader.result;
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      };
      reader.onerror = () => reject(new Error("Lezen mislukt"));
      reader.readAsDataURL(file);
    });

    try {
      const r = await fetch("/api/documents?type=files", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          base64,
          label: label || file.name,
          category: category || "document",
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages((m) => [...m, { role: "assistant", content: "⚠️ Upload mislukt: " + (d.error || "onbekende fout") }]);
        return false;
      }
      if (Array.isArray(d.items)) setDocFiles(d.items);
      setToast({ icon: "📁", text: file.name + " opgeslagen", color: CYAN });
      setTimeout(() => setToast(null), 2500);
      return true;
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ Upload mislukt: " + e.message }]);
      return false;
    }
  }

  async function deleteDocFile(id) {
    if (!window.confirm("Dit document verwijderen?")) return;
    try {
      const r = await fetch("/api/documents?type=files&id=" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const d = await r.json();
      if (Array.isArray(d.items)) setDocFiles(d.items);
    } catch (e) { console.error("Bestand verwijderen mislukt:", e); }
  }

  async function sendMessage(forced) {
    const text = (forced ?? input).trim();
    if (!text || busy) return;

    // Briefing-vraag detecteren: "wat staat er morgen/vandaag/deze week"
    const lower = text.toLowerCase();
    const briefingMatch = lower.match(/wat\s+(staat\s+er|is\s+er|moet\s+ik)\s+(voor\s+)?(morgen|vandaag|deze\s+week|komende\s+week)/);
    if (briefingMatch) {
      const scopeWord = briefingMatch[3];
      const scope = scopeWord === "vandaag" ? "vandaag" : scopeWord.includes("week") ? "deze-week" : "morgen";
      const next = [...messages, { role: "user", content: text }];
      setMessages(next); setInput("");
      const bf = buildBriefing(scope);
      setBriefing(bf);
      // Spreek korte samenvatting
      const evCount = bf.events.length;
      const mailCount = bf.mails.length;
      let intro;
      if (evCount === 0 && mailCount === 0) {
        intro = `Voor ${bf.label} staat er niets bijzonders op de planning.`;
      } else {
        const delen = [];
        if (evCount) delen.push(`${evCount} ${evCount === 1 ? "event" : "events"}`);
        if (mailCount) delen.push(`${mailCount} ${mailCount === 1 ? "mail" : "mails"} die je aandacht vragen`);
        intro = `Voor ${bf.label}: ${delen.join(" en ")}. Ik heb een overzichtskaart voor je geopend.`;
      }
      setMessages((m) => [...m, { role: "assistant", content: intro }]);
      speak(intro);
      return;
    }

    // Financieel-vraag detecteren: bankstand, BTW, IB, besteedbaar
    const finMatch = lower.match(/\b(bankstand|wat\s+staat\s+er\s+op\s+de\s+bank|hoeveel\s+(staat|heb)\s+ik\s+(op\s+de\s+bank|nog|in\s+kas)|btw|omzetbelasting|inkomstenbelasting|\bib\b|besteedbaar|hoeveel\s+kan\s+ik\s+uitgeven|hoeveel\s+is\s+vrij|reservering)\b/);
    if (finMatch) {
      setMessages((m) => [...m, { role: "user", content: text }]);
      setInput("");
      openFinancials();
      const intro = "Ik open je financieel overzicht. Bankstand, BTW per periode en geschatte IB worden voor je berekend uit Boeksy.";
      setMessages((m) => [...m, { role: "assistant", content: intro }]);
      speak(intro);
      return;
    }

    const next = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setActions([]); setStatus("NOVA denkt na...");
    try {
      const raw = await callBackend(next.map((m) => ({ role: m.role, content: m.content })));
      const { reply, actions: acts, task, improve, plan, whatsapp, post, voice, quote } = parseReply(raw);
      const finalReply = reply || "Sorry, ik kon even niet reageren.";
      setMessages((p) => [...p, { role: "assistant", content: finalReply }]);
      setStatus("Online · klaar voor je opdracht");
      // Voice-commando eerst toepassen, dan spreken met het nieuwe tempo/staat
      if (voice) {
        if (voice.rate) updateVoiceRate(voice.rate);
        if (voice.on === true && !voiceOn) setVoiceOn(true);
        if (voice.on === false && voiceOn) { stopSpeaking(); setVoiceOn(false); }
      }
      speak(finalReply);
      if (task) startTask(task);
      if (improve) addImprovement(improve);
      if (plan) addToCalendar(plan);
      if (whatsapp) setPendingWA(whatsapp);
      if (post) startPostWorkflow(post);
      if (quote) setPendingQuote(quote);
      if (acts.length) setTimeout(() => placeActions(acts), 400);
    } catch (err) {
      setMessages((p) => [...p, { role: "assistant", content: "Er ging iets mis: " + (err.message || "onbekende fout") }]);
      setStatus("Verbindingsfout");
      // Fout-status verdwijnt vanzelf na 5 seconden zodat de balk weer "klaar" toont
      setTimeout(() => setStatus((s) => s === "Verbindingsfout" ? "Online · klaar voor je opdracht" : s), 5000);
    } finally { setBusy(false); }
  }

  function clickAction(a) {
    setActions((prev) => prev.filter((x) => x.id !== a.id));
    const label = a.label.toLowerCase();
    // Speciale acties die niet als chatbericht worden verstuurd
    if (label === "lees voor" || label === "lees voor mij" || label === "voorlezen") {
      const recent = posts.find((p) => p.phase === "concept-awaiting" || p.phase === "production-awaiting");
      if (recent) {
        if (recent.phase === "concept-awaiting") speakConcept(recent.id);
        else speakFullContent(recent.id);
        return;
      }
    }
    if (label === "toon op scherm" || label === "laat zien" || label === "open") {
      // In conceptfase tonen we de pop-up (één plek met concept).
      // In productiefase openen we direct het Marketing-detail; de gebruiker klikt
      // dan op specifieke specialisten als hij daar wil bijsturen.
      const recent = posts.find((p) => p.phase === "concept-awaiting" || p.phase === "production-awaiting");
      if (recent) {
        if (recent.phase === "concept-awaiting") setOpenPost(recent.id);
        else setOpenAgentDetail({ postId: recent.id, role: "marketing" });
        return;
      }
    }
    if (label === "later" || label === "later terug" || label === "kom later terug") {
      const melding = "Goed, ik kom er later op terug.";
      setMessages((m) => [...m, { role: "assistant", content: melding }]);
      speak(melding);
      return;
    }
    sendMessage(a.label);
  }

  async function sendToTask(taskId) {
    const text = taskInput.trim();
    if (!text) return;
    setTaskInput("");
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;
    const newChat = [...task.chat, { role: "user", content: text }];
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, chat: newChat, thinking: true } : t)));
    try {
      const reply = await callBackend(newChat.map((m) => ({ role: m.role, content: m.content })), "worker");
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, chat: [...newChat, { role: "assistant", content: reply }], thinking: false } : t)));
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, chat: [...newChat, { role: "assistant", content: "Kon niet reageren." }], thinking: false } : t)));
    }
  }

  function dismissTask(id) { setTasks((prev) => prev.filter((t) => t.id !== id)); if (openTask === id) setOpenTask(null); }

  // Goedkeuren: pas hier komt straks de echte koppeling (Instagram/WhatsApp plaatsen).
  function approveTask(id) {
    const task = tasksRef.current.find((t) => t.id === id);
    if (task) {
      setHistory((h) => [{ id: task.id, agent: task.agent, title: task.title, date: new Date().toISOString(), result: task.result }, ...h]);
    }
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "approved", chat: [...t.chat, { role: "assistant", content: "Goedgekeurd. Zodra de koppeling met het juiste kanaal actief is, plaats ik dit automatisch. Tot die tijd staat het klaar." }] } : t)));
  }

  // Afkeuren: terug naar de agent met jouw feedback, die maakt een nieuwe versie.
  async function rejectTask(id, feedback) {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    const note = (feedback && feedback.trim()) || "Niet akkoord, maak een betere versie.";
    const newChat = [...task.chat, { role: "user", content: note }];
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "running", progress: 20, chat: newChat, thinking: true } : t)));
    const prog = setInterval(() => {
      setTasks((prev) => prev.map((t) => (t.id === id && t.state === "running" ? { ...t, progress: Math.min(t.progress + Math.random() * 9 + 3, 94) } : t)));
    }, 700);
    try {
      const reply = await callBackend(newChat.map((m) => ({ role: m.role, content: m.content })), "worker");
      clearInterval(prog);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "awaiting", progress: 100, thinking: false, chat: [...newChat, { role: "assistant", content: reply }] } : t)));
    } catch {
      clearInterval(prog);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "error", thinking: false } : t)));
    }
  }

  const orbState = speaking ? "speaking" : busy ? "thinking" : listening ? "listening" : "idle";
  const stateLabel = { speaking: "NOVA spreekt...", thinking: "NOVA denkt na...", listening: "NOVA luistert...", idle: "NOVA staat klaar" }[orbState];

  // Visuele volumemeter: tijdens spraak laat de glow ritmisch pulseren met
  // realistisch klinkende amplitude. We hebben geen toegang tot het echte volume
  // van speechSynthesis, dus we simuleren een natuurlijk spraakritme.
  const [volumeLevel, setVolumeLevel] = useState(0);
  useEffect(() => {
    if (!speaking) { setVolumeLevel(0); return; }
    let raf;
    let lastUpdate = 0;
    // Puls-tempo loopt mee met spraaktempo: snellere stem = sneller pulserende glow
    const pulseInterval = Math.max(50, 100 / voiceRate);
    const tick = (t) => {
      if (t - lastUpdate > pulseInterval) {
        // Gewogen willekeurige amplitude die op spraakritme lijkt:
        // pieken in het middenbereik, met zo nu en dan een stille moment
        const base = 0.35 + Math.random() * 0.55;
        const drop = Math.random() < 0.15 ? 0.4 : 1.0; // soms een ademmoment
        setVolumeLevel(base * drop);
        lastUpdate = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking, voiceRate]);

  // Glow-intensiteit van de cirkel reageert op volumemeter tijdens spraak
  const speakingGlow = 35 + Math.round(volumeLevel * 35); // 35-70px
  const speakingInner = 20 + Math.round(volumeLevel * 18); // 20-38px
  const speakingOpacity = 0.45 + volumeLevel * 0.35; // 0.45-0.80
  const coreShadow = orbState === "speaking"
    ? `0 0 ${speakingGlow}px rgba(56,230,255,${speakingOpacity}), inset 0 0 ${speakingInner}px rgba(56,230,255,.4)`
    : orbState === "thinking" ? "0 0 40px rgba(127,119,221,.6), inset 0 0 24px rgba(127,119,221,.4)"
    : "0 0 30px rgba(56,230,255,.35), inset 0 0 20px rgba(56,230,255,.25)";
  const activeTask = tasks.find((t) => t.id === openTask);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "radial-gradient(ellipse at 50% 0%, #0A1F44 0%, #04122B 55%, #020A1A 100%)", height: "100dvh", maxHeight: "100vh", color: "#E8F1FF", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes spinR{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes spinL{from{transform:rotate(360deg)}to{transform:rotate(0)}}
        @keyframes pulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.9;transform:scale(1.04)}}
        @keyframes scan{0%{transform:translateY(-110px);opacity:0}50%{opacity:.6}100%{transform:translateY(110px);opacity:0}}
        @keyframes wave{0%,100%{height:6px}50%{height:22px}}
        @keyframes actIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        @keyframes starFade{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}20%{opacity:.85;transform:translate(-50%,-50%) scale(1)}55%{opacity:.85;transform:translate(-50%,-50%) scale(1)}80%{opacity:0;transform:translate(-50%,-50%) scale(.6)}100%{opacity:0;transform:translate(-50%,-50%) scale(.5)}}
        @keyframes taskIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        @keyframes orbEnter{0%{transform:scale(.5) translateY(-12px);opacity:.4;filter:brightness(1.8)}60%{transform:scale(1.08) translateY(0);opacity:1;filter:brightness(1.3)}100%{transform:scale(1) translateY(0);opacity:1;filter:brightness(1)}}
        @keyframes orbBloom{0%{box-shadow:0 0 0 0 rgba(56,230,255,.6),inset 0 0 20px rgba(56,230,255,.25)}50%{box-shadow:0 0 80px 20px rgba(56,230,255,.4),inset 0 0 30px rgba(56,230,255,.4)}100%{box-shadow:0 0 30px rgba(56,230,255,.35),inset 0 0 20px rgba(56,230,255,.25)}}
        @keyframes dashMove{from{stroke-dashoffset:0}to{stroke-dashoffset:-20}}
        @keyframes toastSlide{0%{opacity:0;transform:translateY(-12px)}10%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-8px)}}
        @keyframes toastFly{0%{opacity:0;transform:translate(0,-12px) scale(1)}8%{opacity:1;transform:translate(0,0) scale(1)}45%{opacity:1;transform:translate(0,0) scale(1)}75%{opacity:.9;transform:translate(var(--toast-dx),var(--toast-dy)) scale(.35)}100%{opacity:0;transform:translate(var(--toast-dx),var(--toast-dy)) scale(.15)}}
        @keyframes iconPulse{0%,100%{transform:scale(1);filter:brightness(1)}30%{transform:scale(1.35);filter:brightness(1.5)}60%{transform:scale(1.1);filter:brightness(1.2)}}
        .icon-just-saved .panel-icon-circle{animation:iconPulse 1.5s ease-out;box-shadow:0 0 24px ${AMBER}}
        .ring{position:absolute;border-radius:50%;border:1px solid rgba(56,230,255,.25)}
        .idle-star{position:absolute;border-radius:50%;background:${CYAN};box-shadow:0 0 8px ${CYAN},0 0 16px rgba(56,230,255,.5);transform:translate(-50%,-50%);transition:left 3s ease-in-out,top 3s ease-in-out;pointer-events:none;animation:starFade linear infinite}
        .act-star{position:absolute;transform:translate(-50%,-50%);animation:actIn .45s cubic-bezier(.2,1.3,.5,1) both;cursor:pointer;z-index:5}
        .act-dot{width:12px;height:12px;border-radius:50%;background:${CYAN};box-shadow:0 0 14px ${CYAN},0 0 26px rgba(56,230,255,.5);margin:0 auto}
        .act-label{margin-top:7px;font-size:11px;line-height:1.3;color:#Eaf6ff;background:rgba(8,26,54,.9);border:1px solid rgba(56,230,255,.4);padding:5px 10px;border-radius:14px;white-space:nowrap;text-align:center;transition:all .2s}
        .act-star:hover .act-label{background:rgba(56,230,255,.2);border-color:${CYAN};color:#fff}
        .act-star:hover .act-dot{transform:scale(1.3)}
        .task-node{position:absolute;transform:translate(-50%,-50%);animation:taskIn .4s ease both;cursor:pointer;z-index:6;width:124px}
        .task-card{background:rgba(8,26,54,.92);border:1px solid rgba(56,230,255,.35);border-radius:12px;padding:8px 10px;transition:all .2s}
        .task-node:hover .task-card{border-color:${CYAN};transform:translateY(-2px)}
        .task-node:hover .post-remove-btn{opacity:1}
        .task-node:focus-within .post-remove-btn{opacity:1}
        .nova-scroll::-webkit-scrollbar{width:6px}.nova-scroll::-webkit-scrollbar-thumb{background:rgba(56,230,255,.3);border-radius:3px}
        input::placeholder{color:rgba(180,210,255,.4)}
        .panel-icon{cursor:pointer}
        .panel-icon-circle{width:42px;height:42px;border-radius:50%;border:1px solid;background:rgba(6,24,47,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;transition:all .25s ease;box-shadow:0 2px 12px rgba(0,0,0,.3)}
        .panel-icon:hover .panel-icon-circle{transform:scale(1.12);background:rgba(8,28,56,.95);box-shadow:0 4px 18px rgba(56,230,255,.25)}
        .panel-icon-tooltip{position:absolute;top:50px;left:50%;transform:translateX(-50%);background:rgba(6,24,47,.95);border:1px solid;padding:4px 10px;border-radius:12px;font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .2s ease;backdrop-filter:blur(8px)}
        .panel-icon:hover .panel-icon-tooltip{opacity:1}
        .panel-icon:active .panel-icon-tooltip,.panel-icon:focus .panel-icon-tooltip{opacity:1}
        @media (max-width: 720px){
          .nova-main-flex{flex-direction:column!important;flex-wrap:nowrap!important;height:calc(100dvh - 70px)!important;overflow:hidden!important}
          .nova-orb-area{flex:0 0 auto!important;min-height:auto!important;height:60%!important;padding:20px!important;overflow:visible!important}
          .nova-chat-area{flex:1 1 auto!important;width:100%!important;border-left:none!important;border-top:1px solid rgba(56,230,255,.1)!important;min-height:0!important;max-height:none!important;height:40%!important;display:flex!important;flex-direction:column!important}
          .nova-orb-area .panel-icon-circle{width:38px;height:38px}
        }
        @media (max-width: 480px){
          .nova-orb-area{padding:12px!important;height:62%!important}
          .nova-chat-area{height:38%!important}
        }
        @media(prefers-reduced-motion:reduce){.idle-star{transition:opacity .4s}}
      `}</style>

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {[...Array(14)].map((_, i) => (<div key={i} style={{ position: "absolute", left: `${(i * 7.3) % 100}%`, top: `${30 + ((i * 13) % 60)}%`, width: 3, height: 3, borderRadius: "50%", background: i % 2 ? CYAN : PURPLE, opacity: 0.4, animation: `pulse ${4 + (i % 4)}s ease-in-out infinite` }} />))}
      </div>

      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", borderBottom: "1px solid rgba(56,230,255,.12)", position: "relative", zIndex: 7 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: CYAN, boxShadow: `0 0 12px ${CYAN}`, animation: "pulse 2s infinite" }} />
        <div>
          <div style={{ fontSize: 15, letterSpacing: 1, fontWeight: 800 }}>Agent van JnA Events</div>
          <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", letterSpacing: 1 }}>NOVA · engineering &amp; design</div>
        </div>
        <div className="nova-status-badge" style={{ marginLeft: "auto", fontSize: 11, color: CYAN, border: "1px solid rgba(56,230,255,.3)", padding: "4px 12px", borderRadius: 20, letterSpacing: 1 }}>{status}</div>
        <button
          onClick={() => setShowSettings(true)}
          aria-label="Instellingen"
          title="Instellingen"
          style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${(storageInfo && !storageInfo.persistent) ? "#FF8FA3" : "rgba(56,230,255,.3)"}`, background: (storageInfo && !storageInfo.persistent) ? "rgba(255,107,138,.1)" : "transparent", color: (storageInfo && !storageInfo.persistent) ? "#FF8FA3" : "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 16, position: "relative" }}
        >
          ⚙
          {(storageInfo && !storageInfo.persistent) && (
            <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%", background: "#FF8FA3", boxShadow: "0 0 6px #FF8FA3" }} />
          )}
        </button>
        <button onClick={onLogout} aria-label="Uitloggen" title="Uitloggen" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(56,230,255,.3)", background: "transparent", color: "rgba(180,210,255,.6)", cursor: "pointer", fontSize: 14 }}>⏻</button>
      </header>

      <div className="nova-main-flex" style={{ flex: 1, display: "flex", flexWrap: "wrap", position: "relative", zIndex: 2 }}>
        <div className="nova-orb-area" style={{ flex: "1 1 auto", minHeight: 480, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30 }}>
          {/* Quick-action menu rond de cirkel - vervangt de zwevende idle-sterren */}
          {orbMenuOpen && actions.length === 0 && tasks.length === 0 && (() => {
            const items = [
              { label: "📊 Dashboard", action: () => { setShowDashboard(true); setOrbMenuOpen(false); } },
              { label: "💰 Financieel", action: () => { openFinancials(); setOrbMenuOpen(false); } },
              { label: "Wat staat er morgen?", action: () => { sendMessage("Wat staat er morgen?"); setOrbMenuOpen(false); } },
              { label: "Maak een post", action: () => { sendMessage("Maak een post"); setOrbMenuOpen(false); } },
              { label: "Open boekhouding", action: () => { setShowBoeksy(true); setOrbMenuOpen(false); } },
              { label: "Open kalender", action: () => { setShowCalendar(true); setOrbMenuOpen(false); } },
            ];
            return items.map((it, i) => {
              // Plaats ze in een halve cirkel onder de orb, gelijk verdeeld
              const startAngle = Math.PI * 0.15;
              const totalAngle = Math.PI * 0.7;
              const step = items.length > 1 ? totalAngle / (items.length - 1) : 0;
              const a = startAngle + step * i;
              const r = 28;
              const x = 50 + Math.cos(a) * r;
              const y = 65 + Math.sin(a) * r * 0.5;
              return (
                <div key={i} className="act-star" style={{ left: `${x}%`, top: `${y}%`, zIndex: 5 }} onClick={it.action} role="button" tabIndex={0}>
                  <div className="act-dot" />
                  <div className="act-label">{it.label}</div>
                </div>
              );
            });
          })()}

          {actions.map((a) => (
            <div key={a.id} className="act-star" style={{ left: `${a.x}%`, top: `${a.y}%` }} onClick={() => clickAction(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && clickAction(a)}>
              <div className="act-dot" /><div className="act-label">{a.label}</div>
            </div>
          ))}

          {tasks.map((t) => {
            const slot = TASK_SLOTS[t.slot] || TASK_SLOTS[0];
            const col = t.state === "approved" ? "#1D9E75" : t.state === "awaiting" ? CYAN : t.state === "error" ? "#E24B4A" : AMBER;
            return (
              <div key={t.id} className="task-node" style={{ left: `${slot.x}%`, top: `${slot.y}%` }} onClick={() => setOpenTask(t.id)} role="button" tabIndex={0}>
                <div className="task-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 13 }}>{agentIcon(t.agent)}</span>
                    <span style={{ fontSize: 10, color: "rgba(180,210,255,.7)", textTransform: "uppercase", letterSpacing: ".5px" }}>{t.agent}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: col }}>{t.state === "approved" ? "goedgekeurd" : t.state === "awaiting" ? "akkoord?" : t.state === "error" ? "fout" : Math.round(t.progress) + "%"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#E8F1FF", lineHeight: 1.3, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.title}</div>
                  <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${t.progress}%`, background: col, borderRadius: 2, transition: "width .6s ease" }} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Post-agents rond de cirkel: Marketing als regisseur, drie specialisten
              eromheen verbonden met SVG-lijnen. Elke agent is los klikbaar voor zijn
              eigen detail-paneel. */}
          {posts.flatMap((post) => {
            // Posities voor de agent-kaarten. Marketing linksboven (de regisseur),
            // de drie specialisten in een ruime driehoek eromheen. De verbindings-
            // lijnen krommen om de cirkel heen via bezier curves zodat ze niet door
            // de planeet snijden.
            const POSITIONS = {
              marketing: { x: 16, y: 18 },  // linksboven (regisseur)
              content:   { x: 84, y: 18 },  // rechtsboven (zelfde hoogte als marketing)
              visual:    { x: 84, y: 82 },  // rechtsonder
              video:     { x: 16, y: 82 },  // linksonder
            };
            const marketingPos = POSITIONS.marketing;
            const hasProduction = post.agents.some((a) => a.role !== "marketing");

            return [
              // SVG-laag met lijnen van Marketing naar de drie specialisten, ALLEEN
              // wanneer de productie-fase actief is.
              hasProduction && (
                <svg key={post.id + "-lines"} viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} preserveAspectRatio="none">
                  {["content", "visual", "video"].map((role) => {
                    const target = POSITIONS[role];
                    const agent = post.agents.find((a) => a.role === role);
                    if (!agent) return null;
                    const active = agent.state === "running";
                    const done = agent.state === "done";
                    const stroke = done ? "#1D9E75" : active ? AMBER : "rgba(127,119,221,.4)";

                    // Bereken een controlepunt dat de bocht om de cirkel heen duwt.
                    // We pakken het midden van Marketing-naar-doel, en duwen dat punt
                    // radiaal naar buiten weg van het centrum (50,50).
                    const mx = (marketingPos.x + target.x) / 2;
                    const my = (marketingPos.y + target.y) / 2;
                    // Vector vanaf centrum naar middenpunt
                    let vx = mx - 50;
                    let vy = my - 50;
                    const len = Math.sqrt(vx * vx + vy * vy) || 1;
                    // Normaliseer en schaal: bocht duwt 32 procentpunt naar buiten
                    const push = 32;
                    const cx = mx + (vx / len) * push;
                    const cy = my + (vy / len) * push;
                    const path = `M ${marketingPos.x} ${marketingPos.y} Q ${cx} ${cy} ${target.x} ${target.y}`;

                    return (
                      <path
                        key={role}
                        d={path}
                        fill="none"
                        stroke={stroke}
                        strokeWidth="1.5"
                        strokeDasharray={active ? "6 4" : "none"}
                        opacity="0.55"
                        vectorEffect="non-scaling-stroke"
                        style={active ? { animation: "dashMove 1.2s linear infinite" } : {}}
                      />
                    );
                  })}
                </svg>
              ),
              // De agent-kaartjes zelf
              ...post.agents.map((agent) => {
                const pos = POSITIONS[agent.role] || { x: 50, y: 50 };
                const col = agent.state === "done" ? "#1D9E75" : agent.state === "awaiting" ? CYAN : agent.state === "error" ? "#E24B4A" : AMBER;
                const icon = agent.role === "marketing" ? "📣" : agent.role === "content" ? "✍️" : agent.role === "visual" ? "🎨" : agent.role === "video" ? "🎥" : "⚙️";
                const label = agent.role === "marketing" ? "marketing" : agent.role;
                const key = post.id + "-" + agent.role;
                const isMarketing = agent.role === "marketing";
                return (
                  <div key={key} className="task-node" style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 3 }} role="button" tabIndex={0}>
                    {isMarketing && (
                      <button
                        className="post-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Deze post verwijderen?")) {
                            setPosts((prev) => prev.filter((p) => p.id !== post.id));
                          }
                        }}
                        title="Post verwijderen"
                        style={{ position: "absolute", top: -8, right: -8, width: 20, height: 20, borderRadius: "50%", background: "rgba(255,107,138,.9)", color: "#fff", border: "1px solid rgba(255,107,138,1)", fontSize: 11, lineHeight: 1, cursor: "pointer", padding: 0, opacity: 0, transition: "opacity .15s ease", zIndex: 4 }}
                      >×</button>
                    )}
                    <div onClick={() => setOpenAgentDetail({ postId: post.id, role: agent.role })} className="task-card" style={{ borderColor: agent.state === "awaiting" ? CYAN : (isMarketing ? "rgba(127,119,221,.45)" : undefined), background: isMarketing ? "rgba(127,119,221,.08)" : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ fontSize: 13 }}>{icon}</span>
                        <span style={{ fontSize: 10, color: "rgba(180,210,255,.7)", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: col }}>{agent.state === "done" ? "klaar" : agent.state === "awaiting" ? "akkoord?" : agent.state === "error" ? "fout" : Math.round(agent.progress) + "%"}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#E8F1FF", lineHeight: 1.3, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{agent.name}</div>
                      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${agent.progress}%`, background: col, borderRadius: 2, transition: "width .6s ease" }} />
                      </div>
                    </div>
                  </div>
                );
              })
            ].filter(Boolean);
          })}

          {/* Panel-iconen rond de cirkel - alleen icoon, label en badge bij hover.
              Verschijnen alleen als er inhoud is. */}
          {(() => {
            const open = onboarding.reduce((n, k) => n + (k.total - k.done), 0);
            const panels = [
              improvements.length > 0 && { key: "imp", icon: "✨", color: AMBER, label: "Verbeteringen", count: improvements.length, onClick: () => setShowImprove(true) },
              history.length > 0 && { key: "his", icon: "✓", color: "#5DCAA5", label: "Historie", count: history.length, onClick: () => setShowHistory(true) },
              { key: "mail", icon: "📧", color: imapCfg?.configured ? "#5DCAA5" : AMBER, label: imapCfg?.configured ? "E-mail" : "E-mail instellen", count: 0, onClick: () => setShowImap(true) },
              boeksy?.configured && { key: "boeksy", icon: "💼", color: "#5DCAA5", label: "Boekhouding", count: 0, onClick: () => setShowBoeksy(true) },
              { key: "cat", icon: "📦", color: CYAN, label: "Materieel", count: catalog.length, onClick: () => setShowCatalog(true) },
              { key: "cal", icon: "🗓️", color: "#B3ADEE", label: "Kalender", count: calendar.length, onClick: () => setShowCalendar(true) },
              open > 0 && { key: "set", icon: "🧭", color: "rgba(220,238,255,.85)", label: "Setup", count: open, onClick: () => setShowOnboard(true) },
              posts.length > 0 && { key: "pst", icon: "🎨", color: CYAN, label: "Posts", count: posts.length, onClick: () => setOpenPost(posts[0].id) },
            ].filter(Boolean);

            // Positioneer in een ruime ring rond de cirkel (radius 38% van het gebied)
            return panels.map((p, i) => {
              const angle = (i / panels.length) * Math.PI * 2 - Math.PI / 2; // start bovenaan
              const radius = 42;
              const x = 50 + Math.cos(angle) * radius;
              const y = 50 + Math.sin(angle) * radius * 0.78;
              return (
                <div key={p.key} ref={p.key === "imp" ? improveIconRef : null} className={`panel-icon${p.key === "imp" && improveJustAdded ? " icon-just-saved" : ""}`} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: 4 }} onClick={p.onClick} role="button" tabIndex={0}>
                  <div className="panel-icon-circle" style={{ borderColor: `${p.color}55`, color: p.color }}>
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                  </div>
                  <div className="panel-icon-tooltip" style={{ borderColor: `${p.color}66`, color: "#E8F1FF" }}>
                    {p.label}{p.count > 0 ? <span style={{ marginLeft: 6, opacity: 0.7 }}>· {p.count}</span> : null}
                  </div>
                </div>
              );
            });
          })()}

          {(() => {
            // Bereken hoe 'druk' NOVA is - dat bepaalt hoe snel de ringen draaien.
            // Niet exact, maar voor het visuele effect: stilteweerspiegeling tot meervoud bij druk werk.
            const activeAgents = tasks.filter((t) => t.state === "running").length
              + posts.reduce((n, p) => n + p.agents.filter((a) => a.state === "running").length, 0);
            const intensity = speaking ? 4 : (orbState === "thinking" ? 3 : (activeAgents > 0 ? 1.5 + Math.min(activeAgents, 4) * 0.4 : 1));
            // Basis rotatieduur 24s/30s/18s gedeeld door intensiteit. Hoe lager de duur, hoe sneller.
            const dur1 = (24 / intensity).toFixed(1);
            const dur2 = (30 / intensity).toFixed(1);
            const dur3 = (18 / intensity).toFixed(1);
            return (
              <div style={{ position: "relative", width: 320, height: 320, animation: justEntered ? "orbEnter 1.6s cubic-bezier(.2,1.1,.3,1) both" : "float 6s ease-in-out infinite", zIndex: 2 }}>
                <div className="ring" style={{ inset: 0, animation: `spinR ${dur1}s linear infinite`, borderTopColor: CYAN, borderBottomColor: "transparent", transition: "animation-duration 1.5s ease" }} />
                <div className="ring" style={{ inset: 20, animation: `spinL ${dur2}s linear infinite`, borderBottomColor: PURPLE, borderTopColor: "transparent", transition: "animation-duration 1.5s ease" }} />
                <div className="ring" style={{ inset: 44, animation: `spinR ${dur3}s linear infinite`, borderColor: "rgba(56,230,255,.12)", borderTopColor: "rgba(56,230,255,.4)", transition: "animation-duration 1.5s ease" }} />
                <div onClick={() => setOrbMenuOpen((v) => !v)} title="Snelacties" style={{ position: "absolute", inset: 90, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, rgba(56,230,255,.35), rgba(127,119,221,.25) 60%, rgba(4,18,43,.9) 100%)", border: "1px solid rgba(56,230,255,.4)", boxShadow: coreShadow, display: "flex", alignItems: "center", justifyContent: "center", transition: orbState === "speaking" ? "box-shadow .1s ease-out" : "box-shadow .4s", animation: justEntered ? "orbBloom 1.6s ease-out both" : (orbState === "idle" ? "pulse 4s ease-in-out infinite" : "none"), cursor: "pointer" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, textAlign: "center", lineHeight: 1.1, letterSpacing: 1, color: "#fff", textShadow: `0 0 18px ${CYAN}` }}>
                    JnA<div style={{ fontSize: 10, letterSpacing: 3, color: CYAN, marginTop: 2 }}>EVENTS</div>
                  </div>
                  <div style={{ position: "absolute", left: "10%", right: "10%", height: 1, background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)`, animation: "scan 3s ease-in-out infinite" }} />
                </div>
                {(speaking || listening) && (
                  <div style={{ position: "absolute", bottom: -24, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 4, height: 24 }}>
                    {[...Array(7)].map((_, i) => (<div key={i} style={{ width: 3, background: listening ? "#FF6B8A" : CYAN, borderRadius: 2, animation: `wave ${0.6 + (i % 3) * 0.2}s ease-in-out infinite`, animationDelay: `${i * 0.08}s` }} />))}
              </div>
            )}
          </div>
            );
          })()}
          <div style={{ marginTop: 40, fontSize: 13, color: "rgba(180,210,255,.75)", letterSpacing: 1, zIndex: 2 }}>{stateLabel}</div>
          {tasks.filter((t) => t.state === "running").length > 0 && (<div style={{ marginTop: 8, fontSize: 11, color: AMBER, zIndex: 2 }}>{tasks.filter((t) => t.state === "running").length} agent(s) aan het werk</div>)}
        </div>

        <div className="nova-chat-area" style={{ flex: "0 0 300px", width: 300, display: "flex", flexDirection: "column", borderLeft: "1px solid rgba(56,230,255,.1)", minHeight: 480, maxHeight: "calc(100vh - 70px)", minWidth: 0 }}>
          <div ref={scrollRef} className="nova-scroll" style={{ flex: "1 1 0", overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.role === "user" ? `linear-gradient(135deg, ${PURPLE}, #5A52B5)` : "rgba(56,230,255,.08)", border: m.role === "user" ? "none" : "1px solid rgba(56,230,255,.2)", fontSize: 13, lineHeight: 1.5, color: m.role === "user" ? "#fff" : "#DCEEFF", whiteSpace: "pre-wrap" }}>{m.content}</div>
                {m.offerMicPermission && (
                  <button
                    onClick={requestMicPermission}
                    style={{ alignSelf: "flex-start", border: `1px solid ${CYAN}66`, borderRadius: 10, padding: "8px 14px", background: "rgba(56,230,255,.1)", color: CYAN, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >🎙 Sta microfoon toe</button>
                )}
              </div>
            ))}
            {busy && (<div style={{ alignSelf: "flex-start", padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "rgba(56,230,255,.08)", border: "1px solid rgba(56,230,255,.2)", display: "flex", gap: 5 }}>{[0, 1, 2].map((d) => (<span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: CYAN, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}</div>)}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)", alignItems: "center" }}>
            <button
              onClick={toggleMic}
              aria-label={alwaysListen ? (micMuted ? "Microfoon dempen opheffen" : "Microfoon dempen") : "Spraak"}
              title={alwaysListen ? (micMuted ? "Gedempt - klik om te luisteren" : "Luistert continu - klik om te dempen") : "Klik om te spreken"}
              style={{
                width: 40, height: 40, borderRadius: "50%",
                border: `1px solid ${alwaysListen ? (micMuted ? "rgba(255,107,138,.6)" : "#5DCAA5") : (listening ? "#FF6B8A" : "rgba(56,230,255,.4)")}`,
                background: alwaysListen
                  ? (micMuted ? "rgba(255,107,138,.15)" : `rgba(29,158,117,${0.10 + Math.min(micLevel * 4, 0.35)})`)
                  : (listening ? "rgba(255,107,138,.15)" : "rgba(56,230,255,.08)"),
                color: alwaysListen ? (micMuted ? "#FF6B8A" : "#5DCAA5") : (listening ? "#FF6B8A" : CYAN),
                cursor: "pointer", fontSize: 17, flexShrink: 0,
                transition: "background .15s ease",
              }}
            >{alwaysListen ? (micMuted ? "🔇" : "🎙") : (listening ? "■" : "🎙")}</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Praat met NOVA of typ een opdracht..." style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "10px 15px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => sendMessage()} disabled={busy} aria-label="Versturen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: busy ? "not-allowed" : "pointer", fontSize: 17, flexShrink: 0, opacity: busy ? 0.5 : 1, fontWeight: 700 }}>↑</button>
          </div>
        </div>
      </div>

      {activeTask && (
        <div onClick={() => setOpenTask(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(56,230,255,.15)" }}>
              <span style={{ fontSize: 18 }}>{agentIcon(activeTask.agent)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{activeTask.title}</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".5px" }}>{activeTask.agent}-agent · {activeTask.state === "approved" ? "goedgekeurd" : activeTask.state === "awaiting" ? "wacht op je akkoord" : activeTask.state === "error" ? "fout" : "bezig " + Math.round(activeTask.progress) + "%"}</div>
              </div>
              <button onClick={() => dismissTask(activeTask.id)} title="Taak verwijderen" style={{ background: "transparent", border: "1px solid rgba(255,255,255,.2)", color: "rgba(180,210,255,.7)", borderRadius: 8, cursor: "pointer", padding: "4px 10px", fontSize: 12 }}>verwijder</button>
              <button onClick={() => setOpenTask(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            {activeTask.state === "running" && (
              <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(56,230,255,.1)" }}>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.12)", overflow: "hidden" }}><div style={{ height: "100%", width: `${activeTask.progress}%`, background: AMBER, borderRadius: 2, transition: "width .6s ease" }} /></div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 6 }}>De {activeTask.agent}-agent werkt aan je opdracht...</div>
              </div>
            )}
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
              <div style={{ fontSize: 11, color: "rgba(180,210,255,.5)" }}>Opdracht: {activeTask.brief}</div>
              {activeTask.chat.map((m, i) => (<div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%", padding: "10px 13px", borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px", background: m.role === "user" ? `linear-gradient(135deg, ${PURPLE}, #5A52B5)` : "rgba(56,230,255,.08)", border: m.role === "user" ? "none" : "1px solid rgba(56,230,255,.2)", fontSize: 13, lineHeight: 1.5, color: m.role === "user" ? "#fff" : "#DCEEFF", whiteSpace: "pre-wrap" }}>{m.content}</div>))}
              {activeTask.thinking && (<div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px 12px 12px 4px", background: "rgba(56,230,255,.08)", border: "1px solid rgba(56,230,255,.2)", display: "flex", gap: 5 }}>{[0, 1, 2].map((d) => (<span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: CYAN, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}</div>)}
            </div>
            {activeTask.state === "awaiting" && (
              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.15)", background: "rgba(56,230,255,.04)" }}>
                <div style={{ flex: 1, fontSize: 12, color: "rgba(180,210,255,.8)", alignSelf: "center" }}>NOVA is klaar. Geef je akkoord?</div>
                <button onClick={() => rejectTask(activeTask.id, taskInput)} style={{ border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "9px 14px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Afkeuren</button>
                <button onClick={() => approveTask(activeTask.id)} style={{ border: "none", borderRadius: 10, padding: "9px 16px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Goedkeuren</button>
              </div>
            )}
            {activeTask.state === "approved" && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(29,158,117,.3)", background: "rgba(29,158,117,.08)", fontSize: 12, color: "#7FE3C0", display: "flex", alignItems: "center", gap: 8 }}>
                <span>✓</span> Goedgekeurd. Klaar om te plaatsen zodra het kanaal gekoppeld is.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)" }}>
              <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendToTask(activeTask.id)} placeholder={activeTask.state === "running" ? "Even wachten tot de agent klaar is..." : activeTask.state === "awaiting" ? "Typ feedback en klik Afkeuren, of keur goed..." : "Stuur de agent een aanpassing of vraag..."} disabled={activeTask.state === "running"} style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "10px 15px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", opacity: activeTask.state === "running" ? 0.5 : 1 }} />
              <button onClick={() => sendToTask(activeTask.id)} disabled={activeTask.state === "running"} aria-label="Sturen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: "pointer", fontSize: 17, flexShrink: 0, opacity: activeTask.state === "running" ? 0.4 : 1, fontWeight: 700 }}>↑</button>
            </div>
          </div>
        </div>
      )}

      {showImprove && (
        <div onClick={() => setShowImprove(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(239,159,39,.35)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(239,159,39,.2)" }}>
              <span style={{ fontSize: 18 }}>✨</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Verbeterlijst</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Ideeen die NOVA zelf verzamelt voor de volgende update</div>
              </div>
              <button onClick={() => setShowImprove(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {improvements.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "30px 10px" }}>Nog geen verbeterpunten. NOVA voegt hier vanzelf ideeen toe zodra haar iets opvalt dat beter of nieuwer gebouwd kan worden.</div>
              )}
              {improvements.map((it) => (
                <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.2)", borderRadius: 10 }}>
                  <span style={{ color: AMBER, fontSize: 13, marginTop: 1 }}>✨</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.5 }}>{it.text}</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.4)", marginTop: 3 }}>{new Date(it.date).toLocaleString("nl-NL")}</div>
                  </div>
                  <button onClick={() => deleteImprovement(it.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(239,159,39,.2)" }}>
              <button onClick={copyImprovements} disabled={improvements.length === 0} style={{ flex: 1, border: "none", borderRadius: 10, padding: "10px", background: improvements.length ? `linear-gradient(135deg, ${AMBER}, #BA7517)` : "rgba(255,255,255,.08)", color: improvements.length ? "#04122B" : "rgba(180,210,255,.4)", fontSize: 13, fontWeight: 700, cursor: improvements.length ? "pointer" : "not-allowed" }}>{copied ? "Gekopieerd!" : "Kopieer voor Claude"}</button>
              {improvements.length > 0 && (<button onClick={() => deleteImprovement(null, true)} title="Hele lijst wissen" style={{ border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "10px 14px", background: "transparent", color: "rgba(180,210,255,.7)", fontSize: 12, cursor: "pointer" }}>Wis alles</button>)}
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div onClick={() => setShowHistory(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(29,158,117,.35)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(29,158,117,.2)" }}>
              <span style={{ fontSize: 18 }}>✓</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Afgeronde activiteiten</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Taken die je hebt goedgekeurd</div>
              </div>
              <button onClick={() => setShowHistory(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {history.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "30px 10px" }}>Nog geen afgeronde activiteiten. Zodra je een taak goedkeurt, verschijnt die hier in de historie.</div>
              )}
              {history.map((h) => (
                <div key={h.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(29,158,117,.06)", border: "1px solid rgba(29,158,117,.2)", borderRadius: 10 }}>
                  <span style={{ fontSize: 13 }}>{agentIcon(h.agent)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.4 }}>{h.title}</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.4)", marginTop: 2 }}>{h.agent} · {new Date(h.date).toLocaleString("nl-NL")}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCatalog && (
        <div onClick={() => setShowCatalog(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(56,230,255,.15)" }}>
              <span style={{ fontSize: 18 }}>📦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Materieel & apparatuur</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>NOVA gebruikt dit automatisch bij aankondigingen en content</div>
              </div>
              <button onClick={() => setShowCatalog(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid rgba(56,230,255,.1)" }}>
              <input value={prodName} onChange={(e) => setProdName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProduct()} placeholder="Naam (bijv. Rookmachine)" style={{ flex: 2, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 10, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
              <input value={prodCat} onChange={(e) => setProdCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProduct()} placeholder="Categorie" style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 10, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
              <button onClick={addProduct} style={{ border: "none", borderRadius: 10, padding: "0 16px", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {catalog.length === 0 && (<div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "26px 10px" }}>Nog geen materieel toegevoegd. Voeg je apparatuur toe, dan kent NOVA die voortaan automatisch.</div>)}
              {catalog.map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.18)", borderRadius: 10 }}>
                  <span style={{ fontSize: 13 }}>🔊</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF" }}>{p.name}</div>
                    {p.category && (<div style={{ fontSize: 10, color: "rgba(180,210,255,.45)", marginTop: 1 }}>{p.category}</div>)}
                  </div>
                  <button onClick={() => deleteProduct(p.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCalendar && (
        <div onClick={() => setShowCalendar(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 100%)", maxHeight: "86vh", background: "#06182F", border: "1px solid rgba(127,119,221,.35)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(127,119,221,.2)" }}>
              <span style={{ fontSize: 18 }}>🗓️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Contentkalender</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Jouw geplande content + events uit Boeksy met contentadvies</div>
              </div>
              <div style={{ display: "flex", gap: 4, background: "rgba(127,119,221,.1)", borderRadius: 8, padding: 3 }}>
                <button onClick={() => setCalendarView("list")} style={{ border: "none", borderRadius: 6, padding: "5px 10px", background: calendarView === "list" ? "rgba(127,119,221,.4)" : "transparent", color: calendarView === "list" ? "#fff" : "rgba(180,210,255,.6)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Lijst</button>
                <button onClick={() => setCalendarView("week")} style={{ border: "none", borderRadius: 6, padding: "5px 10px", background: calendarView === "week" ? "rgba(127,119,221,.4)" : "transparent", color: calendarView === "week" ? "#fff" : "rgba(180,210,255,.6)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>2 weken</button>
              </div>
              <button onClick={() => setCalForm((f) => ({ ...f, open: !f.open }))} title="Handmatig event toevoegen" style={{ background: "rgba(127,119,221,.15)", border: "1px solid rgba(127,119,221,.5)", color: "#B3ADEE", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>{calForm.open ? "× sluit" : "+ event"}</button>
              <button onClick={() => setShowCalendar(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            {calForm.open && (
              <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(127,119,221,.15)", background: "rgba(127,119,221,.04)", display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  type="text" value={calForm.title}
                  onChange={(e) => setCalForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Wat (bijv. bruiloft Jan en Lisa)"
                  style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="datetime-local" value={calForm.when}
                    onChange={(e) => setCalForm((f) => ({ ...f, when: e.target.value }))}
                    style={{ flex: 2, background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", colorScheme: "dark" }}
                  />
                  <select
                    value={calForm.channel}
                    onChange={(e) => setCalForm((f) => ({ ...f, channel: e.target.value }))}
                    style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }}
                  >
                    <option value="event">event (geen post)</option>
                    <option value="instagram">instagram</option>
                    <option value="tiktok">tiktok</option>
                    <option value="facebook">facebook</option>
                    <option value="linkedin">linkedin</option>
                  </select>
                </div>
                <input
                  type="text" value={calForm.body}
                  onChange={(e) => setCalForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Korte notitie (optioneel) — bijv. neem rookmachine mee"
                  style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(127,119,221,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }}
                />
                <button
                  onClick={() => {
                    if (!calForm.title.trim() || !calForm.when) return;
                    addToCalendar({
                      title: calForm.title.trim(),
                      when: new Date(calForm.when).toISOString(),
                      channel: calForm.channel,
                      body: calForm.body.trim(),
                    });
                    setCalForm({ open: false, title: "", when: "", channel: "instagram", body: "" });
                  }}
                  disabled={!calForm.title.trim() || !calForm.when}
                  style={{ border: "none", borderRadius: 8, padding: "9px 14px", background: (calForm.title && calForm.when) ? "linear-gradient(135deg, #7F77DD, #5A52B5)" : "rgba(255,255,255,.08)", color: (calForm.title && calForm.when) ? "#fff" : "rgba(180,210,255,.4)", fontSize: 13, fontWeight: 700, cursor: (calForm.title && calForm.when) ? "pointer" : "not-allowed", alignSelf: "flex-end" }}
                >Toevoegen</button>
              </div>
            )}
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, minHeight: 120 }}>
              {calendarView === "week" && (() => {
                // Bouw twee weken vooruit. Voor elke dag verzamel je alle events
                // (Boeksy events + handmatige calendar items) op die dag.
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const days = [];
                for (let i = 0; i < 14; i++) {
                  const d = new Date(today); d.setDate(d.getDate() + i);
                  const dayItems = [];
                  // Boeksy events op deze dag
                  (boeksy?.events || []).forEach((ev) => {
                    const evDate = new Date(ev.date);
                    if (evDate.toDateString() === d.toDateString()) {
                      dayItems.push({ kind: "event", color: "#5DCAA5", title: ev.klant || ev.subject, subject: ev.subject, source: "Boeksy" });
                    }
                  });
                  // Handmatige calendar items
                  (calendar || []).forEach((c) => {
                    const cDate = new Date(c.when);
                    if (cDate.toDateString() === d.toDateString()) {
                      dayItems.push({ kind: "post", color: "#B3ADEE", title: c.title, channel: c.channel, time: cDate.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) });
                    }
                  });
                  // Content-advies vanuit events (advice items met "when" op deze dag)
                  (boeksy?.events || []).forEach((ev) => {
                    (ev.advice || []).forEach((adv) => {
                      const advDate = new Date(adv.when);
                      if (advDate.toDateString() === d.toDateString()) {
                        const advColor = adv.type === "pre-build" ? "#B3ADEE" : adv.type === "teaser" ? AMBER : adv.type === "on-site" ? CYAN : "#5DCAA5";
                        dayItems.push({ kind: "advice", color: advColor, title: adv.title, hint: adv.type });
                      }
                    });
                  });
                  days.push({ date: d, items: dayItems });
                }
                const isToday = (d) => d.toDateString() === today.toDateString();
                const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                    {days.map((day) => (
                      <div key={day.date.toISOString()} style={{
                        padding: "8px 6px",
                        background: isToday(day.date) ? "rgba(56,230,255,.08)" : isWeekend(day.date) ? "rgba(255,255,255,.02)" : "rgba(127,119,221,.04)",
                        border: isToday(day.date) ? `1px solid ${CYAN}55` : "1px solid rgba(127,119,221,.15)",
                        borderRadius: 8,
                        minHeight: 80,
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".3px" }}>{day.date.toLocaleDateString("nl-NL", { weekday: "short" })}</span>
                          <span style={{ fontSize: 14, color: isToday(day.date) ? CYAN : "#E8F1FF", fontWeight: isToday(day.date) ? 700 : 500 }}>{day.date.getDate()}</span>
                        </div>
                        {day.items.length === 0 && (
                          <div style={{ fontSize: 9, color: "rgba(180,210,255,.25)", textAlign: "center", paddingTop: 4 }}>—</div>
                        )}
                        {day.items.map((it, i) => (
                          <div key={i} title={it.title} style={{
                            padding: "3px 5px",
                            background: `${it.color}15`,
                            borderLeft: `2px solid ${it.color}`,
                            borderRadius: 3,
                            fontSize: 9,
                            color: "#E8F1FF",
                            lineHeight: 1.25,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {it.kind === "advice" && "💡 "}{it.kind === "post" && "🎨 "}{it.title}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {calendarView === "list" && (<></>)}

              {calendarView === "list" && (
                <>
              {/* Boeksy events bovenaan - dat zijn de "harde" data waar omheen content komt */}
              {boeksy?.events && boeksy.events.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#5DCAA5", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>💼</span> Events uit Boeksy ({boeksy.events.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {boeksy.events.map((e) => {
                      const eventDate = new Date(e.date);
                      const isPast = eventDate.getTime() < Date.now() - 12 * 60 * 60 * 1000;
                      const dateStr = isNaN(eventDate.getTime()) ? e.date : eventDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
                      return (
                        <div key={e.id} style={{ padding: "12px 14px", background: "rgba(29,158,117,.07)", border: "1px solid rgba(29,158,117,.25)", borderRadius: 10, opacity: isPast ? 0.7 : 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 600 }}>{e.klant || "?"}</span>
                            {e.boeksySource === "quote" && <span style={{ fontSize: 9, color: "#B3ADEE", background: "rgba(127,119,221,.15)", padding: "1px 6px", borderRadius: 4, letterSpacing: ".4px", fontWeight: 600 }}>OFFERTE</span>}
                            {e.boeksySource === "invoice" && <span style={{ fontSize: 9, color: CYAN, background: "rgba(56,230,255,.12)", padding: "1px 6px", borderRadius: 4, letterSpacing: ".4px", fontWeight: 600 }}>FACTUUR</span>}
                          </div>
                          {e.subject && <div style={{ fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.4 }}>{e.subject}</div>}
                          <div style={{ fontSize: 11, color: "#5DCAA5", marginTop: 4 }}>{dateStr}</div>
                          {!isPast && e.advice && e.advice.length > 0 && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(29,158,117,.18)" }}>
                              <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>📣 Contentadvies van NOVA</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {e.advice.map((a, i) => {
                                  const adviceDate = new Date(a.when);
                                  const adviceStr = isNaN(adviceDate.getTime()) ? a.when : adviceDate.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
                                  const colorByType = a.type === "pre-build" ? "#B3ADEE" : a.type === "teaser" ? AMBER : a.type === "on-site" ? CYAN : "#5DCAA5";
                                  return (
                                    <div key={i} style={{ padding: "8px 10px", background: "rgba(4,18,43,.4)", borderLeft: `2px solid ${colorByType}`, borderRadius: 6 }}>
                                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                                        <span style={{ fontSize: 11, color: colorByType, fontWeight: 600 }}>{a.title}</span>
                                        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(180,210,255,.5)" }}>{adviceStr}</span>
                                      </div>
                                      <div style={{ fontSize: 11, color: "rgba(220,238,255,.75)", lineHeight: 1.4 }}>{a.body}</div>
                                      <button
                                        onClick={() => {
                                          // Start een multi-agent workflow met deze suggestie als onderwerp
                                          const channel = a.type === "on-site" ? "instagram-story" : "instagram";
                                          startPostWorkflow({ channel, topic: a.title });
                                          setShowCalendar(false);
                                        }}
                                        style={{ marginTop: 6, border: "none", borderRadius: 6, padding: "4px 10px", background: `${colorByType}22`, color: colorByType, fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                                      >Laat NOVA dit maken →</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Handmatige kalender-items */}
              {calendar.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#B3ADEE", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, marginTop: boeksy?.events?.length ? 6 : 0 }}>🎨 Jouw geplande content</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {calendar.map((c) => (
                      <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.22)", borderRadius: 10 }}>
                        <span style={{ fontSize: 13 }}>{agentIcon(c.channel)}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.4 }}>{c.title}</div>
                          <div style={{ fontSize: 10, color: "rgba(180,210,255,.5)", marginTop: 2 }}>{c.channel} · {(() => { try { return new Date(c.when).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return c.when; } })()} · {c.status}</div>
                          {c.body && (<div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 4, lineHeight: 1.4 }}>{c.body}</div>)}
                        </div>
                        <button onClick={() => deleteCalendarItem(c.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {calendar.length === 0 && (!boeksy?.events || boeksy.events.length === 0) && (
                <div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "26px 10px" }}>Nog geen content of events. Vraag NOVA om een post in te plannen, of voeg in Boeksy een offerte/factuur met een event_date toe - dan verschijnt het hier met contentadvies.</div>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showOnboard && (
        <div onClick={() => { setShowOnboard(false); setOpenOnboard(null); }} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 22, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "86vh", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(56,230,255,.12)" }}>
              <span style={{ fontSize: 20 }}>🧭</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{openOnboard ? openOnboard.title : "Setup & koppelingen"}</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>{openOnboard ? openOnboard.intent : "Stap voor stap door wat nodig is per koppeling. Vink af zodra je een stap hebt gedaan."}</div>
              </div>
              {openOnboard && (<button onClick={() => setOpenOnboard(null)} style={{ background: "transparent", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, color: CYAN, cursor: "pointer", padding: "4px 10px", fontSize: 11 }}>← terug</button>)}
              <button onClick={() => { setShowOnboard(false); setOpenOnboard(null); }} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
              {!openOnboard && (
                <>
                  {/* Totale voortgang */}
                  {(() => {
                    const totalDone = onboarding.reduce((n, c) => n + c.done, 0);
                    const totalSteps = onboarding.reduce((n, c) => n + c.total, 0);
                    const pct = totalSteps > 0 ? Math.round((totalDone / totalSteps) * 100) : 0;
                    const activeIntegrations = Object.values(integrations).filter(Boolean).length;
                    const totalIntegrations = Object.keys(integrations).length;
                    return (
                      <div style={{ marginBottom: 16, padding: "14px 16px", background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                          <span style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 600 }}>Setup-voortgang</span>
                          <span style={{ fontSize: 12, color: CYAN, fontWeight: 700 }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${CYAN}, #7F77DD)`, borderRadius: 3, transition: "width .5s ease" }} />
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 8 }}>
                          {totalDone} van {totalSteps} stappen afgerond · {activeIntegrations} van {totalIntegrations} koppelingen actief
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginBottom: 12, lineHeight: 1.5, padding: "10px 12px", background: "rgba(56,230,255,.05)", borderRadius: 8, border: "1px solid rgba(56,230,255,.15)" }}>
                    <strong style={{ color: CYAN }}>Veilig:</strong> wachtwoorden en sleutels staan in Vercel of in NOVA's eigen opslag - niet in deze checklist. NOVA detecteert zelf of een koppeling actief is en zet hem groen.
                  </div>
                  {onboarding.map((c) => {
                    const statusLabel = c.complete ? "Actief" : c.done > 0 ? "In uitvoering" : "Nog niet gestart";
                    const statusColor = c.complete ? "#5DCAA5" : c.done > 0 ? AMBER : "rgba(180,210,255,.5)";
                    const statusBg = c.complete ? "rgba(29,158,117,.15)" : c.done > 0 ? "rgba(239,159,39,.12)" : "rgba(180,210,255,.08)";
                    return (
                      <div key={c.key} onClick={() => setOpenOnboard(c)} role="button" tabIndex={0} style={{ display: "flex", gap: 12, padding: "14px 14px", marginBottom: 8, background: c.complete ? "rgba(29,158,117,.06)" : "rgba(255,255,255,.025)", border: `1px solid ${c.complete ? "rgba(29,158,117,.25)" : "rgba(180,210,255,.12)"}`, borderRadius: 10, cursor: "pointer", alignItems: "center" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.complete ? "#1D9E75" : "rgba(255,255,255,.08)", color: c.complete ? "#fff" : "rgba(180,210,255,.5)", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: c.complete ? "none" : "1px solid rgba(180,210,255,.2)" }}>{c.complete ? "✓" : c.done}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, color: "#fff", fontWeight: 500 }}>{c.title}</span>
                            <span style={{ fontSize: 10, color: statusColor, background: statusBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>{statusLabel}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 4, lineHeight: 1.5 }}>{c.intent}</div>
                          <div style={{ marginTop: 8, height: 3, borderRadius: 2, background: "rgba(255,255,255,.1)" }}>
                            <div style={{ height: "100%", width: `${Math.round((c.done / c.total) * 100)}%`, background: c.complete ? "#1D9E75" : c.done > 0 ? AMBER : CYAN, borderRadius: 2, transition: "width .4s ease" }} />
                          </div>
                          <div style={{ fontSize: 10, color: "rgba(180,210,255,.45)", marginTop: 4 }}>{c.done} van {c.total} stappen</div>
                        </div>
                        <span style={{ color: "rgba(180,210,255,.5)", fontSize: 18 }}>›</span>
                      </div>
                    );
                  })}
                </>
              )}

              {openOnboard && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {openOnboard.steps.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", gap: 12, padding: "12px 14px", background: s.done ? "rgba(29,158,117,.07)" : "rgba(255,255,255,.025)", border: `1px solid ${s.done ? "rgba(29,158,117,.25)" : "rgba(180,210,255,.12)"}`, borderRadius: 10, alignItems: "flex-start" }}>
                      <button onClick={() => !s.auto && toggleOnboardStep(s.id, !s.done)} disabled={s.auto} title={s.auto ? "NOVA detecteert deze stap automatisch" : "Klik om af te vinken"} style={{ width: 22, height: 22, borderRadius: 6, background: s.done ? "#1D9E75" : "transparent", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, border: s.done ? "none" : "1.5px solid rgba(180,210,255,.3)", cursor: s.auto ? "default" : "pointer", opacity: s.auto && !s.done ? 0.5 : 1 }}>{s.done ? "✓" : ""}</button>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, color: s.done ? "rgba(180,210,255,.55)" : "#fff", fontWeight: 500, textDecoration: s.done ? "line-through" : "none" }}>{i + 1}. {s.title}</span>
                          {s.auto && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, color: s.done ? "#5DCAA5" : CYAN, background: s.done ? "rgba(29,158,117,.12)" : "rgba(56,230,255,.1)", padding: "1px 8px", borderRadius: 4, letterSpacing: ".4px", fontWeight: 600 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.done ? "#5DCAA5" : "rgba(180,210,255,.4)", boxShadow: s.done ? "0 0 6px #5DCAA5" : "none", animation: s.done ? "pulse 2.5s ease-in-out infinite" : "none" }} />
                              {s.done ? "AUTO · gedetecteerd" : "AUTO · wacht"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 4, lineHeight: 1.55 }}>{s.help}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!openOnboard && (
              <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(56,230,255,.1)", display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={downloadBackup} style={{ background: "rgba(127,119,221,.12)", border: "1px solid rgba(127,119,221,.4)", color: "#B3ADEE", borderRadius: 10, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>💾</span> Backup downloaden
                </button>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.5)", lineHeight: 1.4, flex: 1 }}>
                  Maak vóór grote wijzigingen een backup. NOVA bewaart alle instellingen, lijsten en data.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {openPost && (() => {
        const post = posts.find((p) => p.id === openPost);
        if (!post) return null;
        // In de productie-fase tonen we GEEN pop-up meer - de gebruiker klikt
        // direct op de agents rond de cirkel. Wel in de conceptfase.
        if (post.phase === "production-running" || post.phase === "production-awaiting" || post.phase === "approved") {
          // Direct sluiten en doorsturen naar Marketing-detail
          setTimeout(() => { setOpenPost(null); setOpenAgentDetail({ postId: post.id, role: "marketing" }); }, 0);
          return null;
        }

        const headerStatus = post.phase === "concept-running" ? "Marketing Director werkt aan het plan..."
          : post.phase === "concept-awaiting" ? "Concept klaar - wacht op je akkoord"
          : post.phase === "production-running" ? "Drie agents werken parallel aan de productie..."
          : post.phase === "production-awaiting" ? "Productie klaar - wacht op je akkoord"
          : post.phase === "approved" ? "Goedgekeurd en in kalender"
          : "Fout";

        return (
          <div onClick={() => setOpenPost(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", maxHeight: "90vh", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>

              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(56,230,255,.15)" }}>
                <span style={{ fontSize: 22 }}>🎨</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{post.topic}</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".5px" }}>{post.channel} · {headerStatus}</div>
                </div>
                <button onClick={() => setOpenPost(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>

              {/* Fase 1: concept loopt */}
              {post.phase === "concept-running" && (
                <div style={{ padding: "30px 20px", textAlign: "center" }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                    {[0, 1, 2].map((d) => (<span key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: "#B3ADEE", animation: `pulse 1s ${d * 0.2}s infinite` }} />))}
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(180,210,255,.75)" }}>De Marketing Director werkt aan het strategisch plan...</div>
                </div>
              )}

              {/* Fase 1: concept klaar, vraag om goedkeuring */}
              {post.phase === "concept-awaiting" && (
                <>
                  <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                    <div style={{ padding: "14px 16px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: "#B3ADEE", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>📣</span> Marketing Director - het plan
                        <button onClick={() => speakConcept(post.id)} title="Voorlezen" style={{ marginLeft: "auto", background: "transparent", border: "1px solid rgba(127,119,221,.4)", color: "#B3ADEE", borderRadius: 8, padding: "3px 10px", fontSize: 10, cursor: "pointer" }}>🔊 voorlezen</button>
                      </div>
                      <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{post.strategie}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.15)", background: "rgba(56,230,255,.04)" }}>
                    <div style={{ flex: 1, fontSize: 12, color: "rgba(180,210,255,.8)", alignSelf: "center" }}>Akkoord met dit plan? Dan gaat het team het maken.</div>
                    <button onClick={() => rejectConcept(post.id)} style={{ border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "9px 14px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Afwijzen</button>
                    <button onClick={() => { approveConcept(post.id); setOpenPost(null); }} style={{ border: "none", borderRadius: 10, padding: "9px 18px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Akkoord → laat ze maken</button>
                  </div>
                </>
              )}

              {/* Fase 2: productie loopt */}
              {post.phase === "production-running" && (
                <div style={{ padding: "20px" }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".5px" }}>Productie - drie agents werken parallel</div>
                  {post.agents.filter((a) => a.role !== "marketing").map((agent) => (
                    <div key={agent.role} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", marginBottom: 8, background: "rgba(56,230,255,.06)", border: "1px solid rgba(56,230,255,.18)", borderRadius: 10 }}>
                      <span style={{ fontSize: 18 }}>{agent.role === "content" ? "✍️" : agent.role === "visual" ? "🎨" : "🎥"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 500 }}>{agent.name}</div>
                        <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: "rgba(255,255,255,.12)" }}>
                          <div style={{ height: "100%", width: `${agent.progress}%`, background: agent.state === "done" ? "#1D9E75" : AMBER, borderRadius: 2, transition: "width .6s ease" }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: agent.state === "done" ? "#5DCAA5" : AMBER, fontWeight: 600 }}>{agent.state === "done" ? "klaar" : Math.round(agent.progress) + "%"}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Fase 2: productie klaar */}
              {(post.phase === "production-awaiting" || post.phase === "approved") && (
                <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>

                    <div style={{ padding: "14px 16px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: "#B3ADEE", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><span>📣</span> Goedgekeurd plan</div>
                      <div style={{ fontSize: 12, color: "#E8F1FF", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{post.strategie}</div>
                    </div>

                    <div style={{ padding: "14px 16px", background: "rgba(56,230,255,.06)", border: "1px solid rgba(56,230,255,.22)", borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: CYAN, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><span>✍️</span> Content Creator</div>
                      <div style={{ fontSize: 12, color: "#E8F1FF", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{post.copy}</div>
                    </div>

                    <div style={{ padding: "14px 16px", background: "rgba(239,159,39,.07)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><span>🎨</span> Visual Director</div>
                      <div style={{ fontSize: 12, color: "#E8F1FF", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{post.visual}</div>
                      {post.imagePrompts && post.imagePrompts.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                          {post.imagePrompts.map((p, i) => {
                            const img = (post.images || [])[i];
                            return (
                              <div key={i} style={{ aspectRatio: post.channel === "tiktok" || post.channel === "instagram" ? "2/3" : "1/1", borderRadius: 10, background: "rgba(0,0,0,.3)", border: "1px solid rgba(239,159,39,.3)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", cursor: "pointer" }} onClick={() => {
                                if (img?.state === "generating") return;
                                if (img?.image) {
                                  setRegenModal({ postId: post.id, promptIndex: i, instructions: "" });
                                } else {
                                  generateImage(post.id, i);
                                }
                              }}>
                                {img?.image && (
                                  <>
                                    <img src={img.image} alt="Visual" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity .2s" }} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(0,0,0,.5)"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.style.background = "rgba(0,0,0,0)"; }}>
                                      <span style={{ color: AMBER, fontSize: 11, fontWeight: 700, background: "rgba(4,18,43,.85)", padding: "5px 10px", borderRadius: 6, border: `1px solid ${AMBER}` }}>🔄 opnieuw</span>
                                    </div>
                                  </>
                                )}
                                {img?.state === "generating" && (<div style={{ textAlign: "center" }}><div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 6 }}>{[0, 1, 2].map((d) => (<span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: AMBER, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}</div><div style={{ fontSize: 10, color: AMBER }}>Genereren...</div></div>)}
                                {img?.state === "error" && (<div style={{ fontSize: 10, color: "#FF8FA3", padding: 10, textAlign: "center" }}>{img.error}</div>)}
                                {!img && (<div style={{ textAlign: "center", padding: 12 }}><div style={{ fontSize: 22, marginBottom: 4 }}>✨</div><div style={{ fontSize: 10, color: AMBER, fontWeight: 600 }}>Klik om te genereren</div><div style={{ fontSize: 9, color: "rgba(180,210,255,.5)", marginTop: 2 }}>~10 cent</div></div>)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ padding: "14px 16px", background: "rgba(29,158,117,.06)", border: "1px solid rgba(29,158,117,.22)", borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: "#5DCAA5", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><span>🎥</span> Video Director</div>
                      <div style={{ fontSize: 12, color: "#E8F1FF", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{post.regie}</div>
                    </div>
                  </div>
                </div>
              )}

              {post.phase === "production-awaiting" && (
                <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.15)", background: "rgba(56,230,255,.04)" }}>
                  <button onClick={() => speakFullContent(post.id)} title="Voorlezen" style={{ background: "transparent", border: "1px solid rgba(56,230,255,.4)", color: CYAN, borderRadius: 10, padding: "9px 12px", fontSize: 12, cursor: "pointer" }}>🔊</button>
                  <div style={{ flex: 1, fontSize: 12, color: "rgba(180,210,255,.8)", alignSelf: "center" }}>Goedkeuren plaatst de post in je kalender.</div>
                  <button onClick={() => setPosts((prev) => prev.filter((p) => p.id !== post.id))} style={{ border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "9px 14px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Verwijder</button>
                  <button onClick={() => { approveContentPost(post.id); setOpenPost(null); }} style={{ border: "none", borderRadius: 10, padding: "9px 18px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Goedkeuren → kalender</button>
                </div>
              )}

              {post.phase === "approved" && (
                <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(29,158,117,.3)", background: "rgba(29,158,117,.08)", fontSize: 12, color: "#7FE3C0", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>✓</span> Goedgekeurd en in de contentkalender gezet.
                </div>
              )}

              {post.phase === "error" && (
                <div style={{ padding: "20px", color: "#FF8FA3", fontSize: 13 }}>Workflow mislukte: {post.error || "onbekende fout"}</div>
              )}

            </div>
          </div>
        );
      })()}

      {openAgentDetail && (() => {
        const post = posts.find((p) => p.id === openAgentDetail.postId);
        if (!post) return null;
        const agent = post.agents.find((a) => a.role === openAgentDetail.role);
        if (!agent) return null;
        const isMarketing = agent.role === "marketing";
        const isContent = agent.role === "content";
        const isVisual = agent.role === "visual";
        const isVideo = agent.role === "video";
        const title = isMarketing ? "Marketing Director" : isContent ? "Content Creator" : isVisual ? "Visual Director" : "Video Director";
        const subtitle = isMarketing ? "het complete verhaal en strategisch plan" : isContent ? "de tekst, caption en hashtags" : isVisual ? "de beeldconcepten en prompts" : "de shotlist en voice-over";
        const icon = isMarketing ? "📣" : isContent ? "✍️" : isVisual ? "🎨" : "🎥";
        const color = isMarketing ? "#B3ADEE" : isContent ? CYAN : isVisual ? AMBER : "#5DCAA5";
        const content = isMarketing ? post.strategie : isContent ? post.copy : isVisual ? post.visual : post.regie;
        const canRevise = !isMarketing && agent.state === "done" && (post.phase === "production-awaiting" || post.phase === "production-running");
        return (
          <div onClick={() => setOpenAgentDetail(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 27, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(580px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${color}55`, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${color}33` }}>
                <span style={{ fontSize: 22 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{title}</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>{subtitle} · {post.topic}</div>
                </div>
                {content && agent.state === "done" && (
                  <button
                    onClick={() => {
                      if (speaking) { stopSpeaking(); return; }
                      speak(content, agent.role);
                    }}
                    title={speaking ? "Stop met voorlezen" : `Voorgelezen door ${title}`}
                    style={{ background: `${color}15`, border: `1px solid ${color}66`, color: color, borderRadius: 8, padding: "6px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                  >{speaking ? "⏹ stop" : "🔊 voorlezen"}</button>
                )}
                <button onClick={() => setOpenAgentDetail(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", minWidth: 32, minHeight: 32 }}>×</button>
              </div>

              <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {agent.state === "running" ? (
                  <div style={{ textAlign: "center", padding: 24 }}>
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 12 }}>
                      {[0, 1, 2].map((d) => (<span key={d} style={{ width: 8, height: 8, borderRadius: "50%", background: color, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(180,210,255,.75)" }}>{title} is aan het werk...</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{content || "(nog geen inhoud)"}</div>
                    {isVisual && post.imagePrompts && post.imagePrompts.length > 0 && (
                      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                        {post.imagePrompts.map((p, i) => {
                          const img = (post.images || [])[i];
                          return (
                            <div key={i} style={{ aspectRatio: post.channel === "tiktok" || post.channel === "instagram" ? "2/3" : "1/1", borderRadius: 10, background: "rgba(0,0,0,.3)", border: `1px solid ${AMBER}55`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", cursor: "pointer" }} onClick={() => {
                              if (img?.state === "generating") return;
                              if (img?.image) {
                                setRegenModal({ postId: post.id, promptIndex: i, instructions: "" });
                              } else {
                                generateImage(post.id, i);
                              }
                            }}>
                              {img?.image && (
                                <>
                                  <img src={img.image} alt="Visual" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity .2s" }} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(0,0,0,.5)"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; e.currentTarget.style.background = "rgba(0,0,0,0)"; }}>
                                    <span style={{ color: AMBER, fontSize: 11, fontWeight: 700, background: "rgba(4,18,43,.85)", padding: "5px 10px", borderRadius: 6, border: `1px solid ${AMBER}` }}>🔄 opnieuw</span>
                                  </div>
                                </>
                              )}
                              {img?.state === "generating" && (<div style={{ textAlign: "center" }}><div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 6 }}>{[0, 1, 2].map((d) => (<span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: AMBER, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}</div><div style={{ fontSize: 10, color: AMBER }}>Genereren...</div></div>)}
                              {img?.state === "error" && (<div style={{ fontSize: 10, color: "#FF8FA3", padding: 10, textAlign: "center" }}>{img.error}</div>)}
                              {!img && (<div style={{ textAlign: "center", padding: 12 }}><div style={{ fontSize: 22, marginBottom: 4 }}>✨</div><div style={{ fontSize: 10, color: AMBER, fontWeight: 600 }}>Klik om te genereren</div><div style={{ fontSize: 9, color: "rgba(180,210,255,.5)", marginTop: 2 }}>~10 cent</div></div>)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {canRevise && (
                  <div style={{ marginTop: 18, padding: "12px 14px", background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Wijziging voorstellen</div>
                    <div style={{ fontSize: 11, color: "rgba(220,238,255,.75)", marginBottom: 8, lineHeight: 1.5 }}>Beschrijf wat je anders wilt. Marketing kijkt of de andere specialisten ook aangepast moeten worden en geeft het door.</div>
                    <textarea
                      value={agentFeedbackDraft[agent.role] || ""}
                      onChange={(e) => setAgentFeedbackDraft((d) => ({ ...d, [agent.role]: e.target.value }))}
                      placeholder={isContent ? "bijv. 'maak de toon enthousiaster' of 'hashtags korter'" : isVisual ? "bijv. 'meer rook in het beeld' of 'donkerder licht'" : "bijv. 'minder shots, meer focus op de machine'"}
                      rows={3}
                      style={{ width: "100%", background: "rgba(4,18,43,.6)", border: `1px solid ${AMBER}44`, borderRadius: 8, padding: "10px 12px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <button
                      onClick={() => {
                        const fb = (agentFeedbackDraft[agent.role] || "").trim();
                        if (!fb) return;
                        reviseAgent(post.id, agent.role, fb);
                        setAgentFeedbackDraft((d) => ({ ...d, [agent.role]: "" }));
                        setOpenAgentDetail(null);
                      }}
                      style={{ marginTop: 8, border: "none", borderRadius: 8, padding: "8px 14px", background: `linear-gradient(135deg, ${AMBER}, #C97A1A)`, color: "#04122B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      Stuur naar Marketing →
                    </button>
                  </div>
                )}

                {post.marketingNote && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: "#B3ADEE", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>📣 Notitie van Marketing</div>
                    <div style={{ fontSize: 12, color: "#E8F1FF", lineHeight: 1.5 }}>{post.marketingNote}</div>
                  </div>
                )}
              </div>

              {post.phase === "production-awaiting" && !isMarketing && (
                <div style={{ padding: "10px 16px", borderTop: `1px solid ${color}22`, fontSize: 11, color: "rgba(180,210,255,.6)" }}>
                  Open de andere agents om hun werk te bekijken, of keur alles goed via de Marketing-kaart.
                </div>
              )}
              {post.phase === "production-awaiting" && isMarketing && (
                <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${color}22` }}>
                  <button onClick={() => speakFullContent(post.id)} title="Voorlezen" style={{ background: "transparent", border: "1px solid rgba(56,230,255,.4)", color: CYAN, borderRadius: 10, padding: "9px 12px", fontSize: 12, cursor: "pointer" }}>🔊</button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => { setPosts((prev) => prev.filter((p) => p.id !== post.id)); setOpenAgentDetail(null); }} style={{ border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "9px 14px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Verwijder</button>
                  <button onClick={() => { approveContentPost(post.id); setOpenAgentDetail(null); }} style={{ border: "none", borderRadius: 10, padding: "9px 18px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Goedkeuren → kalender</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showFinancials && (() => {
        const fmt = (n) => n == null ? "—" : "€ " + Math.round(n).toLocaleString("nl-NL");
        const errBox = financials?.error ? (
          <div style={{ padding: "12px 14px", background: "rgba(255,107,138,.1)", border: "1px solid rgba(255,143,163,.4)", borderRadius: 10, marginBottom: 14, fontSize: 12, color: "#FF8FA3" }}>{financials.error}</div>
        ) : null;

        return (
          <div onClick={() => setShowFinancials(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 32, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}66`, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
                <span style={{ fontSize: 22 }}>📊</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Financieel overzicht</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Bankstand, BTW, IB-schatting · afgeleid uit Boeksy</div>
                </div>
                <button onClick={() => loadFinancials(true)} disabled={financialsLoading} title="Opnieuw berekenen" style={{ background: "transparent", border: `1px solid ${CYAN}55`, color: CYAN, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: financialsLoading ? "wait" : "pointer", marginRight: 6 }}>{financialsLoading ? "⏳" : "🔄"}</button>
                <button onClick={() => setShowFinancials(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
              </div>
              <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {financialsLoading && !financials && (
                  <div style={{ padding: 30, textAlign: "center", color: "rgba(180,210,255,.55)", fontSize: 13 }}>Berekenen uit boekhouding...</div>
                )}
                {errBox}

                {financials && !financials.error && (
                  <>
                    {/* BESTEEDBAAR - hoofdkaart */}
                    <div style={{ padding: "16px 18px", marginBottom: 16, background: "linear-gradient(135deg, rgba(56,230,255,.08), rgba(127,119,221,.08))", border: `1px solid ${CYAN}40`, borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: CYAN, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 6 }}>💰 Vrij te besteden (geschat)</div>
                      <div style={{ fontSize: 28, color: financials.besteedbaar?.besteedbaar !== null && financials.besteedbaar.besteedbaar >= 0 ? "#5DCAA5" : "#FF8FA3", fontWeight: 800, lineHeight: 1 }}>
                        {fmt(financials.besteedbaar?.besteedbaar)}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(180,210,255,.65)", marginTop: 6, lineHeight: 1.5 }}>
                        Bank {fmt(financials.besteedbaar?.bankSaldo)} — BTW reservering {fmt(financials.besteedbaar?.minBtw)} — IB geprojecteerd {fmt(financials.besteedbaar?.minIbGeprojecteerd)}
                      </div>
                    </div>

                    {/* BANKSTAND */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: "#5DCAA5", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>🏦 Bankstand</div>
                      {financials.bank?.saldo !== null ? (
                        <div style={{ padding: "12px 14px", background: "rgba(29,158,117,.07)", border: "1px solid rgba(29,158,117,.25)", borderRadius: 10 }}>
                          <div style={{ fontSize: 22, color: "#5DCAA5", fontWeight: 700 }}>{fmt(financials.bank.saldo)}</div>
                          {financials.bank.accounts && financials.bank.accounts.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              {financials.bank.accounts.map((a, i) => (
                                <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, color: "rgba(220,238,255,.75)", padding: "3px 0" }}>
                                  <span style={{ fontFamily: "monospace", color: "rgba(180,210,255,.55)", minWidth: 50 }}>{a.code}</span>
                                  <span style={{ flex: 1 }}>{a.name}</span>
                                  <span>{fmt(a.saldo)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: "10px 12px", background: "rgba(239,159,39,.07)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 8, fontSize: 12, color: "rgba(220,238,255,.8)" }}>
                          {financials.bank?.reason || "Bankstand kon niet bepaald worden"}
                        </div>
                      )}
                    </div>

                    {/* BTW */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📋 BTW per periode</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {[
                          { label: "Deze maand", data: financials.btw?.maand },
                          { label: "Lopend kwartaal", data: financials.btw?.kwartaal },
                          { label: "Dit jaar", data: financials.btw?.jaar },
                        ].map((c, i) => (
                          <div key={i} style={{ padding: "10px 12px", background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.22)", borderRadius: 8 }}>
                            <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)", marginBottom: 4 }}>{c.label}</div>
                            <div style={{ fontSize: 15, color: AMBER, fontWeight: 700 }}>{fmt(c.data?.teBetalen)}</div>
                            <div style={{ fontSize: 9, color: "rgba(180,210,255,.5)", marginTop: 4, lineHeight: 1.4 }}>
                              In {fmt(c.data?.uitgaand)}<br/>Uit {fmt(c.data?.inkomend)}
                            </div>
                          </div>
                        ))}
                      </div>
                      {financials.btw?.jaar?.reason && (
                        <div style={{ fontSize: 11, color: AMBER, marginTop: 6, lineHeight: 1.4 }}>⚠️ {financials.btw.jaar.reason}</div>
                      )}
                    </div>

                    {/* IB SCHATTING */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: PURPLE, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📈 Inkomstenbelasting (schatting)</div>
                      <div style={{ padding: "12px 14px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)" }}>Winst dit jaar (YTD)</div>
                            <div style={{ fontSize: 15, color: "#E8F1FF", fontWeight: 600 }}>{fmt(financials.ib?.ytdWinst)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)" }}>Projectie jaarwinst</div>
                            <div style={{ fontSize: 15, color: "#B3ADEE", fontWeight: 600 }}>{fmt(financials.ib?.geprojecteerdeJaarwinst)}</div>
                          </div>
                        </div>
                        <div style={{ paddingTop: 10, borderTop: "1px solid rgba(127,119,221,.15)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(220,238,255,.85)", marginBottom: 3 }}>
                            <span>Zelfstandigenaftrek</span>
                            <span>- {fmt(financials.ib?.ibGeprojecteerd?.zelfstandigenaftrek)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(220,238,255,.85)", marginBottom: 3 }}>
                            <span>MKB-winstvrijstelling (12,03%)</span>
                            <span>- {fmt(financials.ib?.ibGeprojecteerd?.mkbVrijstelling)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(220,238,255,.85)", marginBottom: 3 }}>
                            <span>Belastbare winst</span>
                            <span>{fmt(financials.ib?.ibGeprojecteerd?.belastbareWinst)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(220,238,255,.85)", marginBottom: 3 }}>
                            <span>Heffingskortingen</span>
                            <span>- {fmt(financials.ib?.ibGeprojecteerd?.heffingskortingen)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(127,119,221,.2)", color: PURPLE }}>
                            <span>Geschatte IB jaar 2026</span>
                            <span>{fmt(financials.ib?.ibGeprojecteerd?.totalTax)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* WAARSCHUWING */}
                    <div style={{ padding: "10px 12px", background: "rgba(56,230,255,.04)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 8, fontSize: 11, color: "rgba(180,210,255,.75)", lineHeight: 1.5 }}>
                      <strong style={{ color: CYAN }}>Schatting, geen aangifte.</strong> Cijfers zijn afgeleid uit Boeksy-boekhouding op basis van Nederlandse 2026-tarieven (zelfstandigenaftrek €1.200, MKB-vrijstelling 12,03%, schijven 35,82% / 37,48% / 49,50%). Werkelijke aangifte hangt af van factoren die we niet kennen (partner, hypotheek, toeslagen). Raadpleeg je accountant.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showBoeksy && boeksy && (
        <div onClick={() => setShowBoeksy(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 26, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: "1px solid rgba(29,158,117,.3)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(29,158,117,.2)" }}>
              <span style={{ fontSize: 22 }}>💼</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Boekhouding (Boeksy)</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Live alleen-lezen koppeling · klanten, facturen, offertes, W&amp;V</div>
              </div>
              <button onClick={openFinancials} title="Bankstand, BTW, IB-schatting" style={{ background: "rgba(56,230,255,.1)", border: `1px solid ${CYAN}55`, color: CYAN, borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, marginRight: 6 }}>📊 Financieel</button>
              <button onClick={async () => {
                setStatus("Boeksy-endpoints testen...");
                try {
                  const r = await fetch("/api/boeksy?action=diagnose", { headers: { Authorization: "Bearer " + token } });
                  const d = await r.json();
                  const werkend = d.results.filter((x) => x.ok).map((x) => `✓ ${x.endpoint} (${x.path})\n   → ${x.detail}`).join("\n");
                  const niet = d.results.filter((x) => !x.ok).map((x) => `✗ ${x.endpoint} (${x.path}) → ${x.status} ${x.detail}`).join("\n");
                  const tekst = `BOEKSY API DIAGNOSE\n${d.samenvatting.werkend} van ${d.samenvatting.totaal} endpoints werken.\n\nWERKEND:\n${werkend}\n\nNIET WERKEND:\n${niet}`;
                  setMessages((m) => [...m, { role: "assistant", content: tekst }]);
                  setStatus("Klaar");
                } catch (e) {
                  setMessages((m) => [...m, { role: "assistant", content: "Diagnose mislukt: " + e.message }]);
                }
              }} title="Test welke Boeksy endpoints werken" style={{ background: "rgba(239,159,39,.1)", border: `1px solid ${AMBER}55`, color: AMBER, borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600, marginRight: 6 }}>🔍 Diagnose</button>
              <button onClick={() => setShowBoeksy(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", minWidth: 32, minHeight: 32 }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {boeksy.followUps && boeksy.followUps.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>⚠️</span> Follow-up benodigd ({boeksy.followUps.length})
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginBottom: 8, lineHeight: 1.5 }}>
                    Deze offertes staan 14 dagen of langer open zonder reactie. Follow-up kan via Boeksy zelf, of vraag NOVA om een concept.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {boeksy.followUps.map((f) => (
                      <div key={f.id} style={{ padding: "10px 12px", background: "rgba(239,159,39,.07)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 8, fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                          <span style={{ color: AMBER, fontWeight: 600 }}>{f.number || "concept"}</span>
                          <span style={{ color: "#E8F1FF" }}>{f.klant || ""}</span>
                          <span style={{ marginLeft: "auto", fontSize: 10, color: AMBER }}>{f.daysOpen} dagen open</span>
                        </div>
                        {f.subject && <div style={{ color: "rgba(220,238,255,.7)", fontSize: 11 }}>{f.subject}{f.total ? ` · € ${f.total}` : ""}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {boeksy.relations && boeksy.relations.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#5DCAA5", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>👥 Klanten en leveranciers ({boeksy.relations.length})</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6 }}>
                    {boeksy.relations.slice(0, 30).map((r) => (
                      <div key={r.id} style={{ padding: "8px 10px", background: "rgba(29,158,117,.06)", border: "1px solid rgba(29,158,117,.18)", borderRadius: 8, fontSize: 12 }}>
                        <div style={{ color: "#E8F1FF", fontWeight: 600 }}>{r.name}</div>
                        <div style={{ color: "rgba(180,210,255,.55)", fontSize: 10 }}>{r.type}{r.email ? ` · ${r.email}` : ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {boeksy.invoices && boeksy.invoices.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: CYAN, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>🧾 Recente facturen</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {boeksy.invoices.slice(0, 15).map((i) => (
                      <div key={i.id} onClick={() => setLastViewedContext({ type: "factuur", label: `${i.number || "concept"} - ${i.relation || ""}`, data: i })} style={{ padding: "8px 12px", background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.15)", borderRadius: 8, fontSize: 12, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                        <span style={{ color: CYAN, fontWeight: 600, minWidth: 70 }}>{i.number || "concept"}</span>
                        <span style={{ flex: 1, color: "#E8F1FF" }}>{i.relation || ""}{i.subject ? ` · ${i.subject}` : ""}</span>
                        <span style={{ color: "rgba(180,210,255,.7)" }}>{i.total ? `€ ${i.total}` : ""}</span>
                        <span style={{ fontSize: 10, color: "rgba(180,210,255,.5)" }}>{i.status || ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {boeksy.quotes && boeksy.quotes.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#B3ADEE", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📋 Recente offertes</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {boeksy.quotes.slice(0, 15).map((q) => (
                      <div key={q.id} onClick={() => setLastViewedContext({ type: "offerte", label: `${q.number || "concept"} - ${q.relation || ""}`, data: q })} style={{ padding: "8px 12px", background: "rgba(127,119,221,.05)", border: "1px solid rgba(127,119,221,.18)", borderRadius: 8, fontSize: 12, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                        <span style={{ color: "#B3ADEE", fontWeight: 600, minWidth: 70 }}>{q.number || "concept"}</span>
                        <span style={{ flex: 1, color: "#E8F1FF" }}>{q.relation || ""}{q.subject ? ` · ${q.subject}` : ""}</span>
                        <span style={{ color: "rgba(180,210,255,.7)" }}>{q.total ? `€ ${q.total}` : ""}</span>
                        <span style={{ fontSize: 10, color: "rgba(180,210,255,.5)" }}>{q.status || ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {boeksy.profitLoss && (() => {
                const pl = boeksy.profitLoss || {};
                const plPrev = boeksy.profitLossPrev || {};
                const findIn = (obj, ...keys) => {
                  for (const k of keys) {
                    const v = obj[k];
                    if (typeof v === "number") return v;
                    if (typeof v === "string" && !isNaN(parseFloat(v))) return parseFloat(v);
                  }
                  return null;
                };
                const revenue = findIn(pl, "revenue", "omzet", "income", "total_revenue", "total_income");
                const expenses = findIn(pl, "expenses", "kosten", "total_expenses", "total_costs");
                const profit = findIn(pl, "profit", "winst", "net_profit", "result");
                const computedProfit = (revenue != null && expenses != null) ? revenue - expenses : null;
                const profitFinal = profit != null ? profit : computedProfit;

                const prevRevenue = findIn(plPrev, "revenue", "omzet", "income", "total_revenue", "total_income");
                const prevExpenses = findIn(plPrev, "expenses", "kosten", "total_expenses", "total_costs");
                const prevProfit = findIn(plPrev, "profit", "winst", "net_profit", "result");
                const prevComputedProfit = (prevRevenue != null && prevExpenses != null) ? prevRevenue - prevExpenses : null;
                const prevProfitFinal = prevProfit != null ? prevProfit : prevComputedProfit;

                const fmt = (n) => n == null ? "—" : "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

                // Bereken verschil-percentage tov vorige periode
                const calcDelta = (now, prev) => {
                  if (now == null || prev == null || prev === 0) return null;
                  return Math.round(((now - prev) / Math.abs(prev)) * 100);
                };
                const deltaRev = calcDelta(revenue, prevRevenue);
                const deltaExp = calcDelta(expenses, prevExpenses);
                const deltaProf = calcDelta(profitFinal, prevProfitFinal);

                // Toon delta met kleur: groen voor positief, rood voor negatief
                const Delta = ({ value, inverse = false }) => {
                  if (value == null) return null;
                  // Voor kosten is positief delta slecht; voor revenue/winst is positief goed
                  const isGood = inverse ? value < 0 : value > 0;
                  const color = value === 0 ? "rgba(180,210,255,.5)" : (isGood ? "#5DCAA5" : "#FF8FA3");
                  const sign = value > 0 ? "+" : "";
                  return <span style={{ fontSize: 10, color, fontWeight: 600, marginLeft: 4 }}>{sign}{value}% vs vorig kwartaal</span>;
                };

                const anyKnown = revenue != null || expenses != null || profit != null;
                return (
                  <div>
                    <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📊 Winst en verlies (lopend kwartaal)</div>
                    {anyKnown ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
                        <div style={{ padding: "10px 12px", background: "rgba(29,158,117,.07)", border: "1px solid rgba(29,158,117,.2)", borderRadius: 8 }}>
                          <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Omzet</div>
                          <div style={{ fontSize: 16, color: "#5DCAA5", fontWeight: 700 }}>{fmt(revenue)}</div>
                          <Delta value={deltaRev} />
                        </div>
                        <div style={{ padding: "10px 12px", background: "rgba(239,159,39,.07)", border: "1px solid rgba(239,159,39,.2)", borderRadius: 8 }}>
                          <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Kosten</div>
                          <div style={{ fontSize: 16, color: AMBER, fontWeight: 700 }}>{fmt(expenses)}</div>
                          <Delta value={deltaExp} inverse />
                        </div>
                        <div style={{ padding: "10px 12px", background: "rgba(56,230,255,.07)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 8 }}>
                          <div style={{ fontSize: 10, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Winst</div>
                          <div style={{ fontSize: 16, color: CYAN, fontWeight: 700 }}>{fmt(profitFinal)}</div>
                          <Delta value={deltaProf} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginBottom: 8 }}>
                        Boeksy gaf een onbekend rapport-formaat terug. Hieronder de ruwe gegevens.
                      </div>
                    )}
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ fontSize: 10, color: "rgba(180,210,255,.5)", cursor: "pointer", padding: "4px 0" }}>Toon ruwe gegevens van Boeksy</summary>
                      <pre style={{ fontSize: 10, color: "rgba(220,238,255,.75)", padding: "10px 12px", background: "rgba(4,18,43,.5)", border: "1px solid rgba(180,210,255,.1)", borderRadius: 8, overflow: "auto", margin: "6px 0 0", whiteSpace: "pre-wrap", maxHeight: 200 }}>{JSON.stringify(boeksy.profitLoss, null, 2)}</pre>
                    </details>
                  </div>
                );
              })()}

              {boeksy.relationsError && <div style={{ fontSize: 11, color: "#FF8FA3" }}>Fout bij ophalen klanten: {boeksy.relationsError}</div>}
              {boeksy.invoicesError && <div style={{ fontSize: 11, color: "#FF8FA3" }}>Fout bij ophalen facturen: {boeksy.invoicesError}</div>}
              {boeksy.quotesError && <div style={{ fontSize: 11, color: "#FF8FA3" }}>Fout bij ophalen offertes: {boeksy.quotesError}</div>}
              {boeksy.profitLossError && <div style={{ fontSize: 11, color: "#FF8FA3" }}>Fout bij ophalen W&amp;V: {boeksy.profitLossError}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(29,158,117,.15)", fontSize: 11, color: "rgba(180,210,255,.6)" }}>
              NOVA kan over deze gegevens praten. Aanmaken van facturen of offertes is nog niet geactiveerd; dat volgt in een volgende stap met goedkeuring.
            </div>
          </div>
        </div>
      )}

      {showImap && (
        <ImapForm
          current={imapCfg}
          onClose={() => setShowImap(false)}
          onSave={saveImapSettings}
          onClear={clearImapSettings}
        />
      )}

      {pendingQuote && (() => {
        const totalExBtw = pendingQuote.lines.reduce((sum, l) => sum + (l.quantity * l.unit_price), 0);
        const totalBtw = pendingQuote.lines.reduce((sum, l) => sum + (l.quantity * l.unit_price * l.vat_rate / 100), 0);
        const totalIncBtw = totalExBtw + totalBtw;
        return (
          <div onClick={() => setPendingQuote(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#06182F", border: "1px solid rgba(29,158,117,.45)", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(29,158,117,.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>📋</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Offerte naar Boeksy?</div>
                    <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Wordt als concept aangemaakt - jij kunt 'm daar nog aanpassen en versturen</div>
                  </div>
                  <button onClick={() => setPendingQuote(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
                </div>
              </div>
              <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 4 }}>Klant</div>
                  <div style={{ fontSize: 14, color: "#E8F1FF" }}>{pendingQuote.relation}</div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 4 }}>Onderwerp</div>
                  <div style={{ fontSize: 14, color: "#E8F1FF" }}>{pendingQuote.subject}</div>
                </div>
                {pendingQuote.event_date && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 4 }}>Event-datum</div>
                    <div style={{ fontSize: 14, color: "#E8F1FF" }}>{new Date(pendingQuote.event_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 6 }}>Regels</div>
                  {pendingQuote.lines.map((l, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", marginBottom: 4, background: "rgba(29,158,117,.05)", border: "1px solid rgba(29,158,117,.2)", borderRadius: 6, fontSize: 12 }}>
                      <span style={{ flex: 1, color: "#E8F1FF" }}>{l.description}</span>
                      <span style={{ color: "rgba(180,210,255,.6)" }}>{l.quantity}×</span>
                      <span style={{ color: "rgba(180,210,255,.8)" }}>€ {l.unit_price}</span>
                      <span style={{ color: "rgba(180,210,255,.5)", fontSize: 10 }}>{l.vat_rate}% BTW</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "10px 12px", background: "rgba(29,158,117,.1)", border: "1px solid rgba(29,158,117,.3)", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ color: "rgba(180,210,255,.7)" }}>Subtotaal ex. BTW</span>
                    <span style={{ color: "#E8F1FF" }}>€ {totalExBtw.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ color: "rgba(180,210,255,.7)" }}>BTW</span>
                    <span style={{ color: "#E8F1FF" }}>€ {totalBtw.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, marginTop: 4, borderTop: "1px solid rgba(29,158,117,.3)" }}>
                    <span style={{ color: "#5DCAA5", fontWeight: 700 }}>Totaal</span>
                    <span style={{ color: "#5DCAA5", fontWeight: 700 }}>€ {totalIncBtw.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(29,158,117,.15)" }}>
                <button onClick={() => setPendingQuote(null)} style={{ flex: 1, border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "10px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Annuleren</button>
                <button onClick={() => { const q = pendingQuote; setPendingQuote(null); createQuote(q); }} style={{ flex: 1, border: "none", borderRadius: 10, padding: "10px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Naar Boeksy →</button>
              </div>
            </div>
          </div>
        );
      })()}

      {pendingWA && (
        <div onClick={() => setPendingWA(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "#06182F", border: "1px solid rgba(29,158,117,.35)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(29,158,117,.2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>💬</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>WhatsApp versturen?</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>NOVA wacht op je akkoord</div>
                </div>
                <button onClick={() => setPendingWA(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ padding: "14px 20px" }}>
              <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 6 }}>Aan</div>
              <div style={{ fontSize: 13, color: "#E8F1FF", marginBottom: 14, fontFamily: "monospace" }}>{pendingWA.to}</div>
              <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 6 }}>Bericht</div>
              <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.5, padding: "10px 12px", background: "rgba(56,230,255,.06)", border: "1px solid rgba(56,230,255,.18)", borderRadius: 10, whiteSpace: "pre-wrap" }}>{pendingWA.message}</div>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(29,158,117,.15)" }}>
              <button onClick={() => setPendingWA(null)} style={{ flex: 1, border: "1px solid rgba(255,107,138,.5)", borderRadius: 10, padding: "10px", background: "rgba(255,107,138,.1)", color: "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Annuleren</button>
              <button onClick={() => { const wa = pendingWA; setPendingWA(null); sendWhatsApp(wa.to, wa.message); }} style={{ flex: 1, border: "none", borderRadius: 10, padding: "10px", background: "linear-gradient(135deg, #1D9E75, #0F6E56)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Versturen</button>
            </div>
          </div>
        </div>
      )}
      {showDocs && (
        <div onClick={() => setShowDocs(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}55`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
              <span style={{ fontSize: 22 }}>📁</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Bedrijfsdocumenten</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Tekst-snippets, riders, logo, handtekening</div>
              </div>
              <button onClick={() => setShowDocs(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

              {/* SNIPPETS */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>📝</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Tekst-fragmenten</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2 }}>Kleurpalet, NAW, BTW, bankrekening - NOVA gebruikt deze actief</div>
                  </div>
                </div>

                {snippets.length === 0 && (
                  <div style={{ padding: "12px 14px", background: "rgba(127,119,221,.05)", border: "1px dashed rgba(127,119,221,.3)", borderRadius: 10, fontSize: 12, color: "rgba(180,210,255,.6)", textAlign: "center", marginBottom: 10 }}>
                    Nog geen fragmenten. Voeg er een toe — bijvoorbeeld je IBAN, BTW-nummer of merkkleuren.
                  </div>
                )}

                {snippets.map((s) => (
                  <div key={s.key} style={{ padding: "10px 12px", marginBottom: 6, background: "rgba(127,119,221,.06)", border: "1px solid rgba(127,119,221,.22)", borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#B3ADEE", fontWeight: 700, flex: 1 }}>{s.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(180,210,255,.5)", padding: "1px 6px", background: "rgba(127,119,221,.15)", borderRadius: 4 }}>{s.category}</span>
                      <button onClick={() => deleteSnippet(s.key)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(255,143,163,.7)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(220,238,255,.9)", whiteSpace: "pre-wrap", fontFamily: s.category === "kleur" || s.category === "code" ? "monospace" : "inherit", maxHeight: 120, overflow: "auto" }}>{s.value}</div>
                  </div>
                ))}

                <SnippetAddForm onAdd={saveSnippet} />
              </div>

              {/* FILES */}
              <div style={{ paddingTop: 18, borderTop: "1px solid rgba(56,230,255,.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>📎</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Bestanden</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2 }}>Riders, handleiding, logo, handtekening</div>
                  </div>
                </div>

                {!blobConfigured && (
                  <div style={{ padding: "12px 14px", background: "rgba(239,159,39,.08)", border: "1px solid rgba(239,159,39,.3)", borderRadius: 10, marginBottom: 10, fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.5 }}>
                    <div style={{ color: AMBER, fontWeight: 700, marginBottom: 6 }}>⚠️ Vercel Blob niet gedetecteerd</div>
                    <div style={{ marginBottom: 8 }}>
                      {blobDiagDetail && blobDiagDetail.allBlobEnvVars && blobDiagDetail.allBlobEnvVars.length > 0 ? (
                        <>
                          NOVA ziet wel deze Blob-variabelen in Vercel, maar geen daarvan eindigt op <code style={{ background: "rgba(239,159,39,.15)", padding: "1px 5px", borderRadius: 3 }}>BLOB_READ_WRITE_TOKEN</code>:
                          <ul style={{ margin: "4px 0", paddingLeft: 20, fontFamily: "monospace", fontSize: 11 }}>
                            {blobDiagDetail.allBlobEnvVars.map((v) => (<li key={v}>{v}</li>))}
                          </ul>
                          Stuur deze namen aan de developer, of hernoem in Vercel naar <code style={{ background: "rgba(239,159,39,.15)", padding: "1px 5px", borderRadius: 3 }}>BLOB_READ_WRITE_TOKEN</code>.
                        </>
                      ) : (
                        <>
                          Geen Blob env-vars gevonden in Vercel. Stappen:
                          <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
                            <li>Vercel project → tabblad <strong>Storage</strong></li>
                            <li>Bij je Blob store → <strong>Connect Project</strong></li>
                            <li>Vink <strong>Production</strong> aan (cruciaal)</li>
                            <li>Daarna tabblad <strong>Deployments</strong> → ... menu → <strong>Redeploy</strong></li>
                          </ol>
                        </>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const r = await fetch("/api/documents?type=files", { headers: { Authorization: "Bearer " + token } });
                          const d = await r.json();
                          if (typeof d.blobConfigured === "boolean") setBlobConfigured(d.blobConfigured);
                          if (d.blobDiagnose) setBlobDiagDetail(d.blobDiagnose);
                          if (d.blobConfigured) {
                            setToast({ icon: "✓", text: "Blob nu gekoppeld!", color: "#5DCAA5" });
                            setTimeout(() => setToast(null), 2500);
                          }
                        } catch (e) { void e; }
                      }}
                      style={{ border: `1px solid ${AMBER}`, borderRadius: 6, padding: "5px 10px", background: "rgba(239,159,39,.1)", color: AMBER, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                    >🔄 Opnieuw checken</button>
                  </div>
                )}

                {docFiles.length === 0 && blobConfigured && (
                  <div style={{ padding: "12px 14px", background: "rgba(56,230,255,.04)", border: "1px dashed rgba(56,230,255,.25)", borderRadius: 10, fontSize: 12, color: "rgba(180,210,255,.6)", textAlign: "center", marginBottom: 10 }}>
                    Nog geen bestanden. Upload bijvoorbeeld je rider, handleiding of logo.
                  </div>
                )}

                {docFiles.map((f) => (
                  <div key={f.id} style={{ padding: "10px 12px", marginBottom: 6, background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.18)", borderRadius: 10, display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 20 }}>{f.contentType?.startsWith("image") ? "🖼" : f.contentType?.includes("pdf") ? "📄" : "📎"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#E8F1FF", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</div>
                      <div style={{ fontSize: 10, color: "rgba(180,210,255,.5)", marginTop: 2 }}>{f.filename} · {Math.round(f.size / 1024)} KB · {f.category}</div>
                    </div>
                    <a href={f.downloadUrl || f.url} target="_blank" rel="noopener noreferrer" title="Openen" style={{ color: CYAN, textDecoration: "none", padding: "4px 8px", border: "1px solid rgba(56,230,255,.3)", borderRadius: 6, fontSize: 11 }}>open</a>
                    <button onClick={() => deleteDocFile(f.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(255,143,163,.7)", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}

                {blobConfigured && <FileUploadForm onUpload={uploadDocFile} />}
              </div>

            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div onClick={() => setShowSettings(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}55`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
              <span style={{ fontSize: 22 }}>⚙</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Instellingen</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Stem, microfoon, meldingen en opslag</div>
              </div>
              <button onClick={() => setShowSettings(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

              {/* GELUID */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🔊</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Geluid</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "10px 12px", background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.15)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 500 }}>NOVA spreekt</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2 }}>Antwoorden hardop voorgelezen</div>
                  </div>
                  <button onClick={toggleVoice} style={{ border: "none", borderRadius: 8, padding: "6px 14px", background: voiceOn ? "rgba(29,158,117,.25)" : "rgba(255,107,138,.15)", color: voiceOn ? "#5DCAA5" : "#FF8FA3", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{voiceOn ? "AAN" : "UIT"}</button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)", marginBottom: 8 }}>Spraaktempo</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 10, color: "rgba(180,210,255,.5)" }}>traag</span>
                    <input
                      type="range" min="0.7" max="1.5" step="0.05" value={voiceRate}
                      onChange={(e) => updateVoiceRate(parseFloat(e.target.value))}
                      onMouseUp={(e) => testVoice(parseFloat(e.target.value))}
                      onTouchEnd={(e) => testVoice(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: CYAN, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 10, color: "rgba(180,210,255,.5)" }}>snel</span>
                    <span style={{ fontSize: 11, color: CYAN, fontWeight: 600, minWidth: 36, textAlign: "right" }}>{voiceRate.toFixed(2)}×</span>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)", marginBottom: 8 }}>Bron</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button
                      onClick={() => updateTtsProvider("browser")}
                      style={{ flex: 1, border: "none", borderRadius: 8, padding: "8px 10px", background: ttsProvider === "browser" ? `linear-gradient(135deg, ${CYAN}, ${PURPLE})` : "rgba(255,255,255,.05)", color: ttsProvider === "browser" ? "#04122B" : "rgba(180,210,255,.6)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >Browser (gratis)</button>
                    <button
                      onClick={() => updateTtsProvider("openai")}
                      style={{ flex: 1, border: "none", borderRadius: 8, padding: "8px 10px", background: ttsProvider === "openai" ? `linear-gradient(135deg, ${CYAN}, ${PURPLE})` : "rgba(255,255,255,.05)", color: ttsProvider === "openai" ? "#04122B" : "rgba(180,210,255,.6)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >OpenAI (cent)</button>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(180,210,255,.5)", lineHeight: 1.4 }}>
                    {ttsProvider === "openai"
                      ? "Consistent geluid over alle apparaten. ~1,5 cent per 1000 karakters."
                      : "Gratis browser-stem. Klinkt anders per apparaat."}
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)", marginBottom: 8 }}>Stem</div>
                  {ttsProvider === "openai" ? (
                    <select
                      value={voiceName || "nova"}
                      onChange={(e) => { updateVoiceName(e.target.value); }}
                      style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    >
                      <option value="alloy">Alloy — neutraal</option>
                      <option value="echo">Echo — mannelijk, helder</option>
                      <option value="fable">Fable — warm verteller</option>
                      <option value="onyx">Onyx — diep mannelijk</option>
                      <option value="nova">Nova — vriendelijk vrouwelijk</option>
                      <option value="shimmer">Shimmer — zacht vrouwelijk</option>
                      <option value="ash">Ash — kalm helder</option>
                      <option value="sage">Sage — bedachtzaam</option>
                      <option value="coral">Coral — warm vrouwelijk</option>
                    </select>
                  ) : (
                    <select
                      value={voiceName}
                      onChange={(e) => updateVoiceName(e.target.value)}
                      style={{ width: "100%", background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "9px 12px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    >
                      <option value="">Automatisch (beste beschikbaar)</option>
                      {availableVoices.map((v) => (<option key={v.name} value={v.name}>{v.name}</option>))}
                    </select>
                  )}
                </div>

                {ttsProvider === "openai" && (
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)", marginBottom: 4 }}>Stemmen per agent</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.45)", lineHeight: 1.4, marginBottom: 10 }}>Geef elke agent een eigen stem voor de voorlees-knop op detailpanelen.</div>
                    {[
                      { role: "marketing", icon: "📣", label: "Marketing Director" },
                      { role: "content", icon: "✍️", label: "Content Creator" },
                      { role: "visual", icon: "🎨", label: "Visual Director" },
                      { role: "video", icon: "🎥", label: "Video Director" },
                    ].map((a) => (
                      <div key={a.role} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, width: 18 }}>{a.icon}</span>
                        <span style={{ flex: 1, fontSize: 12, color: "rgba(220,238,255,.8)" }}>{a.label}</span>
                        <select
                          value={agentVoices[a.role] || ""}
                          onChange={(e) => updateAgentVoice(a.role, e.target.value)}
                          style={{ background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 6, padding: "5px 8px", color: "#E8F1FF", fontSize: 11, outline: "none", fontFamily: "inherit", width: 110 }}
                        >
                          <option value="alloy">Alloy</option>
                          <option value="echo">Echo (m)</option>
                          <option value="fable">Fable</option>
                          <option value="onyx">Onyx (m+)</option>
                          <option value="nova">Nova (v)</option>
                          <option value="shimmer">Shimmer (v)</option>
                          <option value="ash">Ash</option>
                          <option value="sage">Sage</option>
                          <option value="coral">Coral (v)</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* BEDRIJFSDOCUMENTEN */}
              <div style={{ marginBottom: 22, paddingTop: 18, borderTop: "1px solid rgba(56,230,255,.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>📁</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Bedrijfsdocumenten</span>
                </div>
                <button
                  onClick={() => { setShowSettings(false); setShowDocs(true); }}
                  style={{ width: "100%", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "10px 12px", background: "rgba(56,230,255,.05)", color: CYAN, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span style={{ fontSize: 14 }}>📂</span>
                  <div style={{ flex: 1 }}>
                    <div>Beheer documenten en fragmenten</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2, fontWeight: 400 }}>{snippets.length} fragmenten · {docFiles.length} bestanden</div>
                  </div>
                  <span style={{ fontSize: 14, color: "rgba(180,210,255,.5)" }}>›</span>
                </button>
              </div>

              {/* MICROFOON */}
              <div style={{ marginBottom: 22, paddingTop: 18, borderTop: "1px solid rgba(56,230,255,.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🎙</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Microfoon</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "10px 12px", background: "rgba(127,119,221,.05)", border: "1px solid rgba(127,119,221,.2)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 500 }}>Continu luisteren</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2 }}>{alwaysListen ? "Microfoon staat altijd aan" : "Push-to-talk via mic-knop"}</div>
                  </div>
                  <button
                    onClick={toggleAlwaysListen}
                    disabled={!micSupported}
                    style={{ border: "none", borderRadius: 8, padding: "6px 14px", background: alwaysListen ? "rgba(29,158,117,.25)" : "rgba(127,119,221,.2)", color: alwaysListen ? "#5DCAA5" : "#B3ADEE", fontSize: 12, fontWeight: 700, cursor: micSupported ? "pointer" : "not-allowed", opacity: micSupported ? 1 : 0.5 }}
                  >{alwaysListen ? "AAN" : "UIT"}</button>
                </div>

                <button
                  onClick={() => { setShowSettings(false); runMicDiagnose(); }}
                  style={{ width: "100%", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, padding: "10px 12px", background: "rgba(56,230,255,.05)", color: CYAN, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span style={{ fontSize: 14 }}>🔍</span>
                  <div style={{ flex: 1 }}>
                    <div>Microfoon-diagnose</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2, fontWeight: 400 }}>Test stap voor stap waar het stopt</div>
                  </div>
                  <span style={{ fontSize: 14, color: "rgba(180,210,255,.5)" }}>›</span>
                </button>
              </div>

              {/* MELDINGEN */}
              <div style={{ marginBottom: 22, paddingTop: 18, borderTop: "1px solid rgba(56,230,255,.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🔔</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Meldingen</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "rgba(239,159,39,.05)", border: "1px solid rgba(239,159,39,.2)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 500 }}>Browser-notificaties</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2 }}>Bij nieuwe mail of WhatsApp-bericht</div>
                  </div>
                  <button
                    onClick={toggleNotifications}
                    style={{ border: "none", borderRadius: 8, padding: "6px 14px", background: notifEnabled ? "rgba(29,158,117,.25)" : "rgba(255,107,138,.15)", color: notifEnabled ? "#5DCAA5" : "#FF8FA3", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >{notifEnabled ? "AAN" : "UIT"}</button>
                </div>
              </div>

              {/* OPSLAG */}
              {storageInfo && (
                <div style={{ paddingTop: 18, borderTop: "1px solid rgba(56,230,255,.1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 16 }}>{storageInfo.persistent ? "💾" : "⚠️"}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: ".5px" }}>Opslag</span>
                  </div>

                  <button
                    onClick={() => { setShowSettings(false); setShowStorageInfo(true); }}
                    style={{ width: "100%", border: `1px solid ${storageInfo.persistent ? "rgba(29,158,117,.3)" : "rgba(255,143,163,.4)"}`, borderRadius: 8, padding: "10px 12px", background: storageInfo.persistent ? "rgba(29,158,117,.05)" : "rgba(255,107,138,.08)", color: storageInfo.persistent ? "#5DCAA5" : "#FF8FA3", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div style={{ flex: 1 }}>
                      <div>{storageInfo.persistent ? `Persistent (${storageInfo.type})` : "Niet persistent — data gaat verloren"}</div>
                      <div style={{ fontSize: 10, color: "rgba(180,210,255,.55)", marginTop: 2, fontWeight: 400 }}>{storageInfo.persistent ? "Verbeterpunten en data blijven bewaard" : "Klik voor instructies om Redis te koppelen"}</div>
                    </div>
                    <span style={{ fontSize: 14, color: "rgba(180,210,255,.5)" }}>›</span>
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {showMicDiag && (
        <div onClick={() => setShowMicDiag(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}55`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
              <span style={{ fontSize: 22 }}>🔍</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Microfoon-diagnose</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Stap-voor-stap check waar het stopt</div>
              </div>
              <button onClick={() => setShowMicDiag(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {micDiag?.steps?.length ? micDiag.steps.map((s, i) => {
                const col = s.status === "ok" ? "#5DCAA5" : s.status === "fout" ? "#FF8FA3" : AMBER;
                const icon = s.status === "ok" ? "✓" : s.status === "fout" ? "✗" : "⋯";
                return (
                  <div key={i} style={{ padding: "10px 12px", marginBottom: 8, background: `${col}10`, border: `1px solid ${col}40`, borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ color: col, fontSize: 14, fontWeight: 700, width: 18 }}>{icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", flex: 1 }}>{s.stap}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(220,238,255,.85)", marginLeft: 26 }}>{s.detail}</div>
                    {s.info && (
                      <div style={{ fontSize: 11, color: "rgba(180,210,255,.75)", marginLeft: 26, marginTop: 6, padding: "6px 8px", background: "rgba(56,230,255,.05)", borderLeft: `2px solid ${CYAN}`, lineHeight: 1.5 }}>
                        💡 {s.info}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div style={{ padding: 20, textAlign: "center", color: "rgba(180,210,255,.5)" }}>Wachten op test...</div>
              )}
              {micDiag?.running && (
                <div style={{ padding: 12, textAlign: "center", color: CYAN, fontSize: 12 }}>Bezig met testen...</div>
              )}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => runMicDiagnose(true)} disabled={micDiag?.running} style={{ border: "1px solid rgba(56,230,255,.4)", borderRadius: 8, padding: "8px 12px", background: "rgba(56,230,255,.06)", color: CYAN, fontSize: 11, fontWeight: 600, cursor: micDiag?.running ? "wait" : "pointer", opacity: micDiag?.running ? 0.5 : 1 }}>🔄 Test met ruisonderdrukking</button>
              <button onClick={() => runMicDiagnose(false)} disabled={micDiag?.running} style={{ border: "1px solid rgba(239,159,39,.4)", borderRadius: 8, padding: "8px 12px", background: "rgba(239,159,39,.06)", color: AMBER, fontSize: 11, fontWeight: 600, cursor: micDiag?.running ? "wait" : "pointer", opacity: micDiag?.running ? 0.5 : 1 }}>🔄 Test zonder opties</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowMicDiag(false)} style={{ border: "1px solid rgba(180,210,255,.2)", borderRadius: 8, padding: "8px 14px", background: "transparent", color: "rgba(220,238,255,.85)", fontSize: 12, cursor: "pointer" }}>Sluiten</button>
            </div>
          </div>
        </div>
      )}

      {showStorageInfo && storageInfo && (
        <div onClick={() => setShowStorageInfo(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 29, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${storageInfo.persistent ? "#5DCAA555" : "#FF8FA3"}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${storageInfo.persistent ? "rgba(29,158,117,.2)" : "rgba(255,143,163,.2)"}` }}>
              <span style={{ fontSize: 22 }}>{storageInfo.persistent ? "💾" : "⚠️"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Opslag-status</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Waar worden je gegevens bewaard?</div>
              </div>
              <button onClick={() => setShowStorageInfo(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {storageInfo.persistent ? (
                <div>
                  <div style={{ padding: "12px 14px", background: "rgba(29,158,117,.08)", border: "1px solid rgba(29,158,117,.3)", borderRadius: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: "#5DCAA5", fontWeight: 700, marginBottom: 4 }}>✓ Persistent gekoppeld</div>
                    <div style={{ fontSize: 12, color: "rgba(220,238,255,.8)", lineHeight: 1.5 }}>
                      Type: <strong>{storageInfo.type === "redis" ? "Redis" : storageInfo.type === "kv" ? "Vercel KV" : storageInfo.type}</strong>. Verbeterpunten, contentkalender en catalogus blijven bewaard, ook na herstart van de server.
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", lineHeight: 1.5 }}>
                    De opslag is succesvol getest: NOVA heeft zojuist een test-waarde geschreven en weer kunnen lezen.
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ padding: "12px 14px", background: "rgba(255,107,138,.08)", border: "1px solid rgba(255,107,138,.3)", borderRadius: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: "#FF8FA3", fontWeight: 700, marginBottom: 4 }}>✗ Niet persistent</div>
                    <div style={{ fontSize: 12, color: "rgba(220,238,255,.8)", lineHeight: 1.5 }}>
                      {storageInfo.error || "Geen opslag geconfigureerd"}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.6, marginBottom: 12 }}>
                    Wat dit betekent: gegevens worden tijdelijk in geheugen bewaard, maar verdwijnen zodra Vercel de serverless-functie opnieuw start (vaak elke paar minuten). Verbeterpunten, kalender-items en catalogus blijven dus niet bewaard tussen sessies.
                  </div>

                  <div style={{ fontSize: 11, color: CYAN, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8, marginTop: 16 }}>Optie 1: Vercel Marketplace Redis (aanbevolen)</div>
                  <ol style={{ fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
                    <li>Ga naar je Vercel-project, tabblad <strong>Storage</strong></li>
                    <li>Klik <strong>"Create Database"</strong> → kies <strong>Marketplace</strong></li>
                    <li>Kies een Redis-provider (bijv. <strong>Upstash</strong>, gratis tier 10.000 calls/dag)</li>
                    <li>Klik <strong>Connect</strong> en koppel aan je project (Production scope)</li>
                    <li>Vercel voegt automatisch <code style={{ background: "rgba(56,230,255,.1)", padding: "1px 5px", borderRadius: 3, color: CYAN }}>REDIS_URL</code> toe als environment-variable</li>
                    <li>Ga naar tabblad <strong>Deployments</strong>, klik "..." op de laatste deploy → <strong>Redeploy</strong></li>
                  </ol>

                  <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8, marginTop: 16 }}>Optie 2: bestaande Redis handmatig koppelen</div>
                  <div style={{ fontSize: 12, color: "rgba(220,238,255,.85)", lineHeight: 1.6 }}>
                    Als je al een Redis-URL hebt: ga naar Settings → Environment Variables, voeg <code style={{ background: "rgba(239,159,39,.1)", padding: "1px 5px", borderRadius: 3, color: AMBER }}>REDIS_URL</code> toe met je connectiestring (begint meestal met <code>redis://</code> of <code>rediss://</code>). Redeploy daarna.
                  </div>

                  <div style={{ marginTop: 16, padding: "10px 12px", background: "rgba(56,230,255,.05)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 8, fontSize: 11, color: "rgba(180,210,255,.75)", lineHeight: 1.5 }}>
                    <strong style={{ color: CYAN }}>Diagnose:</strong><br/>
                    REDIS_URL aanwezig: {storageInfo.redisConfigured ? "✓ ja" : "✗ nee"}<br/>
                    KV_REST_API_URL aanwezig: {storageInfo.kvConfigured ? "✓ ja" : "✗ nee"}<br/>
                    Type op dit moment: {storageInfo.type}<br/>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  setStorageInfo(null);
                  try {
                    const r = await fetch("/api/data?type=storage", { headers: { Authorization: "Bearer " + token } });
                    const d = await r.json();
                    setStorageInfo(d);
                  } catch (e) { void e; }
                }}
                style={{ border: "1px solid rgba(56,230,255,.4)", borderRadius: 8, padding: "8px 14px", background: "rgba(56,230,255,.06)", color: CYAN, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >🔄 Opnieuw testen</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowStorageInfo(false)} style={{ border: "1px solid rgba(180,210,255,.2)", borderRadius: 8, padding: "8px 14px", background: "transparent", color: "rgba(220,238,255,.85)", fontSize: 12, cursor: "pointer" }}>Sluiten</button>
            </div>
          </div>
        </div>
      )}

      {showDashboard && (() => {
        // Vandaag-data
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowMs = tomorrow.getTime();

        // Events vandaag/morgen
        const todayEvents = (boeksy?.events || []).filter((ev) => {
          const ms = new Date(ev.date).getTime();
          return ms >= todayMs && ms < tomorrowMs;
        });
        const tomorrowEvents = (boeksy?.events || []).filter((ev) => {
          const ms = new Date(ev.date).getTime();
          return ms >= tomorrowMs && ms < tomorrowMs + 86400000;
        });

        // Mails die aandacht vragen
        const urgentMails = (emails || []).filter((m) => m.unread || m.urgent).slice(0, 5);

        // Open offertes
        const openQuotes = (boeksy?.quotes || []).filter((q) => {
          const s = (q.status || "").toLowerCase();
          return !(s.includes("accepted") || s.includes("rejected") || s.includes("declined") || s.includes("geaccepteerd"));
        });

        // Follow-ups
        const followUps = boeksy?.followUps || [];

        // P&L deze maand
        const pl = boeksy?.profitLoss || {};
        const findIn = (obj, ...keys) => {
          for (const k of keys) {
            const v = obj[k];
            if (typeof v === "number") return v;
            if (typeof v === "string" && !isNaN(parseFloat(v))) return parseFloat(v);
          }
          return null;
        };
        const revenue = findIn(pl, "revenue", "omzet", "income", "total_revenue", "total_income");
        const profit = findIn(pl, "profit", "winst", "net_profit", "result");
        const fmt = (n) => n == null ? "—" : "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

        return (
          <div onClick={() => setShowDashboard(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 29, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(820px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}55`, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
                <span style={{ fontSize: 22 }}>📊</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Dashboard</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Alles op één scherm - {new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</div>
                </div>
                <button onClick={() => setShowDashboard(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
              </div>

              <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {/* Bovenste rij: financieel + planning */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {/* Financieel */}
                  <div style={{ padding: "14px 16px", background: "rgba(29,158,117,.07)", border: "1px solid rgba(29,158,117,.25)", borderRadius: 12 }}>
                    <div style={{ fontSize: 11, color: "#5DCAA5", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>💰 Financieel lopend kwartaal</div>
                    <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginBottom: 2 }}>Omzet</div>
                    <div style={{ fontSize: 18, color: "#5DCAA5", fontWeight: 700 }}>{fmt(revenue)}</div>
                    <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 8, marginBottom: 2 }}>Winst</div>
                    <div style={{ fontSize: 18, color: CYAN, fontWeight: 700 }}>{fmt(profit)}</div>
                  </div>

                  {/* Planning */}
                  <div style={{ padding: "14px 16px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 12 }}>
                    <div style={{ fontSize: 11, color: "#B3ADEE", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>🎤 Planning</div>
                    {todayEvents.length === 0 && tomorrowEvents.length === 0 && (
                      <div style={{ fontSize: 12, color: "rgba(180,210,255,.6)" }}>Geen events vandaag of morgen</div>
                    )}
                    {todayEvents.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: CYAN, fontWeight: 600, marginBottom: 2 }}>VANDAAG</div>
                        {todayEvents.map((ev) => (
                          <div key={ev.id} style={{ fontSize: 12, color: "#E8F1FF" }}>{ev.klant || ev.subject}</div>
                        ))}
                      </div>
                    )}
                    {tomorrowEvents.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, color: "#B3ADEE", fontWeight: 600, marginBottom: 2 }}>MORGEN</div>
                        {tomorrowEvents.map((ev) => (
                          <div key={ev.id} style={{ fontSize: 12, color: "#E8F1FF" }}>{ev.klant || ev.subject}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Open offertes */}
                  <div style={{ padding: "14px 16px", background: "rgba(239,159,39,.07)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 12 }}>
                    <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📋 Open offertes</div>
                    <div style={{ fontSize: 28, color: AMBER, fontWeight: 700, lineHeight: 1 }}>{openQuotes.length}</div>
                    {followUps.length > 0 && (
                      <div style={{ fontSize: 11, color: "#FF8FA3", marginTop: 6 }}>
                        ⚠️ {followUps.length} {followUps.length === 1 ? "vraagt" : "vragen"} follow-up
                      </div>
                    )}
                  </div>
                </div>

                {/* Mails sectie */}
                {urgentMails.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: CYAN, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📧 Mails die aandacht vragen ({urgentMails.length})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {urgentMails.map((m, i) => (
                        <div key={i} style={{ padding: "8px 12px", background: "rgba(56,230,255,.06)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 8, fontSize: 12 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ color: m.urgent ? AMBER : "#E8F1FF", fontWeight: 600 }}>{m.urgent && "⚠️ "}{m.fromName || m.from}</span>
                            <span style={{ flex: 1, color: "rgba(220,238,255,.8)" }}>{m.subject}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Follow-ups sectie */}
                {followUps.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>⚠️ Follow-up benodigd</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {followUps.slice(0, 5).map((f) => (
                        <div key={f.id} style={{ padding: "8px 12px", background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.25)", borderRadius: 8, fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: AMBER, fontWeight: 600 }}>{f.number || "concept"}</span>
                          <span style={{ flex: 1, color: "#E8F1FF" }}>{f.klant}</span>
                          <span style={{ fontSize: 10, color: AMBER }}>{f.ageDays} dagen open</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Snelle acties */}
                <div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>Snelle acties</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { setShowDashboard(false); sendMessage("Wat staat er morgen?"); }} style={{ border: "1px solid rgba(56,230,255,.4)", borderRadius: 8, padding: "8px 14px", background: "rgba(56,230,255,.08)", color: CYAN, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Morgen-briefing</button>
                    <button onClick={() => { setShowDashboard(false); setShowBoeksy(true); }} style={{ border: "1px solid rgba(29,158,117,.4)", borderRadius: 8, padding: "8px 14px", background: "rgba(29,158,117,.08)", color: "#5DCAA5", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Open Boeksy</button>
                    <button onClick={() => { setShowDashboard(false); setShowCalendar(true); }} style={{ border: "1px solid rgba(127,119,221,.4)", borderRadius: 8, padding: "8px 14px", background: "rgba(127,119,221,.08)", color: "#B3ADEE", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Open kalender</button>
                    <button onClick={() => { setShowDashboard(false); sendMessage("Maak een post"); }} style={{ border: "1px solid rgba(239,159,39,.4)", borderRadius: 8, padding: "8px 14px", background: "rgba(239,159,39,.08)", color: AMBER, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Maak een post</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {briefing && (
        <div onClick={() => setBriefing(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 28, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#06182F", border: `1px solid ${CYAN}55`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${CYAN}33` }}>
              <span style={{ fontSize: 22 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Briefing voor {briefing.label}</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Alles wat je moet weten in één overzicht</div>
              </div>
              <button onClick={() => setBriefing(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Events */}
              {briefing.events.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#B3ADEE", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>🎤 Op de planning ({briefing.events.length})</div>
                  {briefing.events.map((ev) => (
                    <div key={ev.id} style={{ padding: "10px 12px", marginBottom: 6, background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.25)", borderRadius: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 13, color: "#E8F1FF", fontWeight: 600 }}>{ev.klant || ev.subject}</span>
                        <span style={{ fontSize: 11, color: "#B3ADEE" }}>{new Date(ev.date).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</span>
                      </div>
                      {ev.subject && ev.klant && <div style={{ fontSize: 11, color: "rgba(180,210,255,.7)" }}>{ev.subject}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Mails */}
              {briefing.mails.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: CYAN, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📧 Mails die aandacht vragen ({briefing.mails.length})</div>
                  {briefing.mails.map((m, i) => (
                    <div key={i} style={{ padding: "10px 12px", marginBottom: 6, background: "rgba(56,230,255,.06)", border: "1px solid rgba(56,230,255,.2)", borderRadius: 10 }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: m.urgent ? AMBER : "#E8F1FF", fontWeight: 600 }}>{m.urgent && "⚠️ "}{m.fromName || m.from}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(220,238,255,.85)" }}>{m.subject}</div>
                      {m.snippet && <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 3, lineHeight: 1.4 }}>{m.snippet.slice(0, 120)}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Open offertes - voor "deze week" */}
              {briefing.scope === "deze-week" && briefing.openQuotes.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700, marginBottom: 8 }}>📋 Open offertes ({briefing.openQuotes.length})</div>
                  {briefing.openQuotes.map((q) => (
                    <div key={q.id} style={{ padding: "8px 12px", marginBottom: 4, background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.2)", borderRadius: 8, display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: AMBER, fontWeight: 600, minWidth: 70 }}>{q.number || "concept"}</span>
                      <span style={{ flex: 1, color: "#E8F1FF" }}>{q.relation || ""}</span>
                      {q.total && <span style={{ color: "rgba(180,210,255,.7)" }}>€ {q.total}</span>}
                    </div>
                  ))}
                </div>
              )}

              {briefing.events.length === 0 && briefing.mails.length === 0 && briefing.openQuotes.length === 0 && (
                <div style={{ padding: "30px 20px", textAlign: "center", color: "rgba(180,210,255,.55)", fontSize: 13, lineHeight: 1.6 }}>
                  Niks bijzonders {briefing.label === "vandaag" ? "voor vandaag" : `voor ${briefing.label}`}. Rustige periode.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {regenModal && (() => {
        const post = posts.find((p) => p.id === regenModal.postId);
        const basePrompt = post?.imagePrompts?.[regenModal.promptIndex] || "";
        return (
          <div onClick={() => setRegenModal(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", background: "#06182F", border: `1px solid ${AMBER}55`, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${AMBER}33` }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>🔄 Beeld opnieuw genereren</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Geef extra instructies, of laat leeg om met dezelfde prompt opnieuw te proberen</div>
              </div>
              <div style={{ padding: "14px 20px" }}>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.55)", marginBottom: 4 }}>Oorspronkelijke prompt:</div>
                <div style={{ fontSize: 11, color: "rgba(220,238,255,.7)", padding: "8px 10px", background: "rgba(4,18,43,.5)", borderRadius: 6, marginBottom: 12, maxHeight: 80, overflow: "auto" }}>{basePrompt}</div>
                <textarea
                  value={regenModal.instructions}
                  onChange={(e) => setRegenModal((m) => ({ ...m, instructions: e.target.value }))}
                  placeholder="bijv. 'meer rook in beeld', 'donkerder licht', 'andere hoek vanaf publiek'"
                  rows={3}
                  style={{ width: "100%", background: "rgba(4,18,43,.6)", border: `1px solid ${AMBER}44`, borderRadius: 8, padding: "10px 12px", color: "#E8F1FF", fontSize: 12, outline: "none", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${AMBER}22` }}>
                <button onClick={() => setRegenModal(null)} style={{ background: "transparent", border: "1px solid rgba(180,210,255,.2)", color: "rgba(180,210,255,.7)", borderRadius: 10, padding: "9px 14px", fontSize: 12, cursor: "pointer" }}>Annuleren</button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => {
                    generateImage(regenModal.postId, regenModal.promptIndex, regenModal.instructions.trim());
                    setRegenModal(null);
                  }}
                  style={{ border: "none", borderRadius: 10, padding: "9px 18px", background: `linear-gradient(135deg, ${AMBER}, #C97A1A)`, color: "#04122B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >🔄 Genereer opnieuw (~10 cent)</button>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && (() => {
        // Als er een doel is (✨-icoon positie) berekenen we van waar naar waar.
        // De toast staat op fixed top 80px, midden horizontaal. We berekenen het
        // verschil tussen die startpositie en het doel.
        const hasTarget = !!toast.target;
        let dx = 0, dy = 0;
        if (hasTarget && typeof window !== "undefined") {
          // Startpunt is rond center-x van het venster, top 80px + ~20px hoogte
          const startX = window.innerWidth / 2;
          const startY = 80 + 22;
          dx = toast.target.x - startX;
          dy = toast.target.y - startY;
        }
        const styleVars = hasTarget ? { "--toast-dx": `${dx}px`, "--toast-dy": `${dy}px` } : {};
        const animName = hasTarget ? "toastFly 2.4s cubic-bezier(.5,.05,.3,1) forwards" : "toastSlide 2.4s ease-in-out forwards";
        return (
          <div style={{ position: "fixed", top: 80, left: "50%", marginLeft: -120, width: 240, zIndex: 50, animation: animName, pointerEvents: "none", ...styleVars }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 18px", background: "rgba(6,24,47,.95)", border: `1px solid ${toast.color || CYAN}`, borderRadius: 22, color: "#E8F1FF", fontSize: 13, fontWeight: 500, boxShadow: `0 4px 20px ${toast.color || CYAN}55`, backdropFilter: "blur(10px)" }}>
              <span style={{ fontSize: 16 }}>{toast.icon}</span>
              <span>{toast.text}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
