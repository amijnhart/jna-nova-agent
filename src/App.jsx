import { useState, useRef, useEffect, useCallback } from "react";

const CYAN = "#38E6FF";
const PURPLE = "#7F77DD";
const AMBER = "#EF9F27";

const CHAT_URL = "/api/chat";
const LOGIN_URL = "/api/login";
const IMPROVE_URL = "/api/improvements";
const INBOX_URL = "/api/inbox";
const CATALOG_URL = "/api/catalog";
const CALENDAR_URL = "/api/calendar";
const ONBOARDING_URL = "/api/onboarding";
const WHATSAPP_URL = "/api/whatsapp-send";
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
    .replace(/^\s*[-*+\u2022]\s+/gm, "")
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
  const kept = [];
  for (const line of lines) {
    const a = line.match(/^\s*ACTIES\s*:\s*(.+)$/i);
    const t = line.match(/^\s*TAAK\s*:\s*(.+)$/i);
    const v = line.match(/^\s*VERBETER\s*:\s*(.+)$/i);
    const p = line.match(/^\s*PLAN\s*:\s*(.+)$/i);
    const w = line.match(/^\s*STUUR_WA\s*:\s*(.+)$/i);
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
    } else {
      kept.push(line);
    }
  }
  return { reply: kept.join("\n").trim(), actions, task, improve, plan, whatsapp };
}

function orbitPos() {
  const a = Math.random() * Math.PI * 2;
  const r = 30 + Math.random() * 14;
  return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r * 0.82 };
}

const TASK_SLOTS = [
  { x: 50, y: 7 }, { x: 88, y: 28 }, { x: 88, y: 74 },
  { x: 50, y: 94 }, { x: 12, y: 74 }, { x: 12, y: 28 },
];

const AGENT_ICONS = {
  marketing: "\ud83d\udce3", content: "\u270d\ufe0f", strategie: "\ud83d\udcca",
  whatsapp: "\ud83d\udcac", social: "\ud83d\udcf1", planning: "\ud83d\uddd3\ufe0f", default: "\u2699\ufe0f",
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

function Nova({ token, onLogout }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Goedendag. Ik ben NOVA, de agent van JnA Events. Stel me een vraag of geef een opdracht. Vraag je iets dat werk vereist, dan zet ik een agent aan het werk en zie je die als taak rond de cirkel verschijnen." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [status, setStatus] = useState("Online \u00b7 klaar voor je opdracht");
  const [micSupported, setMicSupported] = useState(true);
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
  const [onboarding, setOnboarding] = useState([]);
  const [showOnboard, setShowOnboard] = useState(false);
  const [openOnboard, setOpenOnboard] = useState(null);
  const [pendingWA, setPendingWA] = useState(null); // {to, message} wachtend op akkoord
  const [prodName, setProdName] = useState("");
  const [prodCat, setProdCat] = useState("");
  const catalogRef = useRef([]);
  const greetedRef = useRef(false);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);
  const tasksRef = useRef([]);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy]);

  // Bij het inloggen: NOVA spreekt een korte begroeting uit, zet openstaande acties
  // rond de cirkel, en schakelt dan terug naar luistermodus. Geen pop-up.
  useEffect(() => {
    async function boot() {
      if (greetedRef.current) return;
      greetedRef.current = true;

      let imps = [];
      let inbox = { connected: false, emails: [] };
      try {
        const r1 = await fetch(IMPROVE_URL, { headers: { Authorization: "Bearer " + token } });
        const d1 = await r1.json();
        if (Array.isArray(d1.items)) { imps = d1.items; setImprovements(d1.items); }
      } catch (e) { void e; }
      try {
        const r2 = await fetch(INBOX_URL, { headers: { Authorization: "Bearer " + token } });
        inbox = await r2.json();
      } catch (e) { void e; }
      try {
        const r3 = await fetch(CATALOG_URL, { headers: { Authorization: "Bearer " + token } });
        const d3 = await r3.json();
        if (Array.isArray(d3.items)) setCatalog(d3.items);
      } catch (e) { void e; }
      try {
        const r4 = await fetch(CALENDAR_URL, { headers: { Authorization: "Bearer " + token } });
        const d4 = await r4.json();
        if (Array.isArray(d4.items)) setCalendar(d4.items);
      } catch (e) { void e; }
      try {
        const r5 = await fetch(ONBOARDING_URL, { headers: { Authorization: "Bearer " + token } });
        const d5 = await r5.json();
        if (Array.isArray(d5.items)) setOnboarding(d5.items);
      } catch (e) { void e; }
      let waInbox = [];
      try {
        const r6 = await fetch("/api/whatsapp-inbox", { headers: { Authorization: "Bearer " + token } });
        const d6 = await r6.json();
        if (Array.isArray(d6.items)) waInbox = d6.items;
      } catch (e) { void e; }

      const hour = new Date().getHours();
      const groet = hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";
      const naam = (typeof NOVA_NAME === "string" && NOVA_NAME) || "";

      // Bouw de samenvatting alleen uit wat NOVA echt weet.
      const delen = [];
      if (imps.length) delen.push(`${imps.length} verbeterpunt${imps.length > 1 ? "en die ik heb verzameld" : " dat ik heb verzameld"}`);
      if (inbox.connected && inbox.emails && inbox.emails.length) {
        const urgent = inbox.emails.filter((e) => e.urgent).length;
        delen.push(`${inbox.emails.length} nieuwe mail${inbox.emails.length > 1 ? "s" : ""}${urgent ? `, waarvan ${urgent} je aandacht vragen` : ""}`);
      }
      const waNieuw = waInbox.filter((m) => !m.read).length;
      if (waNieuw > 0) delen.push(`${waNieuw} nieuw${waNieuw > 1 ? "e" : ""} WhatsApp-bericht${waNieuw > 1 ? "en" : ""}`);

      let tekst = `${groet}${naam ? ", " + naam : ""}, welkom terug. `;
      if (delen.length) {
        tekst += "Sinds je laatste sessie heb ik " + delen.join(" en ") + ". Waar wil je mee beginnen?";
      } else {
        tekst += "Er zijn geen openstaande zaken die je aandacht vragen. Waar wil je mee beginnen?";
      }
      if (!inbox.connected) {
        tekst += " Je mail en agenda zijn nog niet gekoppeld, dus die kan ik nog niet meenemen.";
      }

      // Toon de begroeting als bericht in de chat en spreek hem uit.
      setMessages((p) => [...p, { role: "assistant", content: tekst }]);
      speak(tekst);

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

  async function addImprovement(text) {
    try {
      const res = await fetch(IMPROVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ text, source: "nova" }),
      });
      const d = await res.json();
      if (Array.isArray(d.items)) setImprovements(d.items);
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
    } catch (e) { void e; }
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

  useEffect(() => {
    setIdleStars(Array.from({ length: 6 }, (_, i) => ({ id: "idle-" + i, ...orbitPos(), delay: Math.random() * 7, dur: 7 + Math.random() * 4, size: 5 + Math.random() * 4 })));
    const iv = setInterval(() => { setIdleStars((prev) => prev.map((s) => (Math.random() < 0.4 ? { ...s, ...orbitPos() } : s))); }, 3500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function load() { voicesRef.current = window.speechSynthesis?.getVoices() || []; }
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setMicSupported(false); return; }
    const rec = new SR();
    rec.lang = "nl-NL"; rec.continuous = false; rec.interimResults = false;
    rec.onresult = (e) => { const text = e.results[0][0].transcript; setInput(text); setListening(false); setTimeout(() => sendMessage(text), 250); };
    rec.onerror = () => { setListening(false); setStatus("Microfoon niet beschikbaar \u2014 typ je bericht"); };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickVoice() {
    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis?.getVoices() || [];
    const nl = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
    if (!nl.length) return null;
    const prefer = ["google", "microsoft", "natural", "online", "premium", "enhanced"];
    for (const key of prefer) { const hit = nl.find((v) => v.name.toLowerCase().includes(key)); if (hit) return hit; }
    const female = nl.find((v) => /female|vrouw|fenna|lotte|colette|saskia/i.test(v.name));
    return female || nl[0];
  }
  function speak(text) {
    if (!voiceOn || !window.speechSynthesis) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "nl-NL"; u.rate = 0.98; u.pitch = 0.95;
    const v = pickVoice(); if (v) u.voice = v;
    u.onstart = () => setSpeaking(true); u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }
  function stopSpeaking() { window.speechSynthesis?.cancel(); setSpeaking(false); }
  function toggleVoice() { if (voiceOn) stopSpeaking(); setVoiceOn((v) => !v); }

  async function toggleMic() {
    if (!micSupported) { setStatus("Spraak werkt in Chrome of Edge \u2014 typ je bericht"); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { setStatus("Geef toegang tot je microfoon en probeer opnieuw"); return; }
    stopSpeaking(); setListening(true); setStatus("Luisteren...");
    try { recognitionRef.current.start(); } catch { setListening(false); }
  }

  const placeActions = useCallback((list) => {
    setActions(list.map((label, i) => ({ id: "act-" + Date.now() + "-" + i, label, ...orbitPos() })));
  }, []);

  async function callBackend(msgs, mode) {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ messages: msgs, mode, catalog: catalogRef.current }),
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

  async function sendMessage(forced) {
    const text = (forced ?? input).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setActions([]); setStatus("NOVA denkt na...");
    try {
      const raw = await callBackend(next.map((m) => ({ role: m.role, content: m.content })));
      const { reply, actions: acts, task, improve, plan, whatsapp } = parseReply(raw);
      const finalReply = reply || "Sorry, ik kon even niet reageren.";
      setMessages((p) => [...p, { role: "assistant", content: finalReply }]);
      setStatus("Online \u00b7 klaar voor je opdracht");
      speak(finalReply);
      if (task) startTask(task);
      if (improve) addImprovement(improve);
      if (plan) addToCalendar(plan);
      if (whatsapp) setPendingWA(whatsapp);
      if (acts.length) setTimeout(() => placeActions(acts), 400);
    } catch (err) {
      setMessages((p) => [...p, { role: "assistant", content: "Er ging iets mis: " + (err.message || "onbekende fout") }]);
      setStatus("Verbindingsfout");
    } finally { setBusy(false); }
  }

  function clickAction(a) { setActions((prev) => prev.filter((x) => x.id !== a.id)); sendMessage(a.label); }

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
  const coreShadow = orbState === "speaking" ? "0 0 50px rgba(56,230,255,.7), inset 0 0 30px rgba(56,230,255,.4)" : orbState === "thinking" ? "0 0 40px rgba(127,119,221,.6), inset 0 0 24px rgba(127,119,221,.4)" : "0 0 30px rgba(56,230,255,.35), inset 0 0 20px rgba(56,230,255,.25)";
  const activeTask = tasks.find((t) => t.id === openTask);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "radial-gradient(ellipse at 50% 0%, #0A1F44 0%, #04122B 55%, #020A1A 100%)", minHeight: "100vh", color: "#E8F1FF", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
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
        .nova-scroll::-webkit-scrollbar{width:6px}.nova-scroll::-webkit-scrollbar-thumb{background:rgba(56,230,255,.3);border-radius:3px}
        input::placeholder{color:rgba(180,210,255,.4)}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}.idle-star{transition:opacity .4s}}
      `}</style>

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {[...Array(14)].map((_, i) => (<div key={i} style={{ position: "absolute", left: `${(i * 7.3) % 100}%`, top: `${30 + ((i * 13) % 60)}%`, width: 3, height: 3, borderRadius: "50%", background: i % 2 ? CYAN : PURPLE, opacity: 0.4, animation: `pulse ${4 + (i % 4)}s ease-in-out infinite` }} />))}
      </div>

      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", borderBottom: "1px solid rgba(56,230,255,.12)", position: "relative", zIndex: 7 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: CYAN, boxShadow: `0 0 12px ${CYAN}`, animation: "pulse 2s infinite" }} />
        <div>
          <div style={{ fontSize: 15, letterSpacing: 1, fontWeight: 800 }}>Agent van JnA Events</div>
          <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", letterSpacing: 1 }}>NOVA \u00b7 engineering &amp; design</div>
        </div>
        <button onClick={toggleVoice} aria-label="Stem aan of uit" style={{ marginLeft: "auto", width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(56,230,255,.3)", background: voiceOn ? "rgba(56,230,255,.12)" : "transparent", color: voiceOn ? CYAN : "rgba(180,210,255,.5)", cursor: "pointer", fontSize: 15 }}>{voiceOn ? "\ud83d\udd0a" : "\ud83d\udd07"}</button>
        <button onClick={() => setShowImprove(true)} title="Verbeterlijst van NOVA" style={{ position: "relative", height: 36, borderRadius: 18, border: "1px solid rgba(239,159,39,.4)", background: "rgba(239,159,39,.1)", color: AMBER, cursor: "pointer", fontSize: 12, padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>\u2728</span> Verbeteringen
          {improvements.length > 0 && (<span style={{ minWidth: 16, height: 16, borderRadius: 8, background: AMBER, color: "#04122B", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{improvements.length}</span>)}
        </button>
        <button onClick={() => setShowHistory(true)} title="Historie van afgeronde taken" style={{ height: 36, borderRadius: 18, border: "1px solid rgba(29,158,117,.4)", background: "rgba(29,158,117,.1)", color: "#5DCAA5", cursor: "pointer", fontSize: 12, padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>\u2713</span> Historie
          {history.length > 0 && (<span style={{ minWidth: 16, height: 16, borderRadius: 8, background: "#1D9E75", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{history.length}</span>)}
        </button>
        <button onClick={() => setShowCatalog(true)} title="Productcatalogus" style={{ height: 36, borderRadius: 18, border: "1px solid rgba(56,230,255,.4)", background: "rgba(56,230,255,.1)", color: CYAN, cursor: "pointer", fontSize: 12, padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>\ud83d\udce6</span> Materieel
          {catalog.length > 0 && (<span style={{ minWidth: 16, height: 16, borderRadius: 8, background: CYAN, color: "#04122B", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{catalog.length}</span>)}
        </button>
        <button onClick={() => setShowCalendar(true)} title="Contentkalender" style={{ height: 36, borderRadius: 18, border: "1px solid rgba(127,119,221,.4)", background: "rgba(127,119,221,.12)", color: "#B3ADEE", cursor: "pointer", fontSize: 12, padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>\ud83d\uddd3\ufe0f</span> Kalender
          {calendar.length > 0 && (<span style={{ minWidth: 16, height: 16, borderRadius: 8, background: PURPLE, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{calendar.length}</span>)}
        </button>
        <button onClick={() => setShowOnboard(true)} title="Onboarding-checklist voor koppelingen" style={{ height: 36, borderRadius: 18, border: "1px solid rgba(180,210,255,.3)", background: "rgba(180,210,255,.06)", color: "rgba(220,238,255,.85)", cursor: "pointer", fontSize: 12, padding: "0 12px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>\ud83e\udded</span> Setup
          {(() => {
            const open = onboarding.reduce((n, k) => n + (k.total - k.done), 0);
            return open > 0 ? (<span style={{ minWidth: 16, height: 16, borderRadius: 8, background: "rgba(180,210,255,.25)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{open}</span>) : null;
          })()}
        </button>
        <button onClick={onLogout} title="Uitloggen" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(56,230,255,.3)", background: "transparent", color: "rgba(180,210,255,.6)", cursor: "pointer", fontSize: 14 }}>\u23fb</button>
        <div style={{ fontSize: 11, color: CYAN, border: "1px solid rgba(56,230,255,.3)", padding: "4px 12px", borderRadius: 20, letterSpacing: 1 }}>{status}</div>
      </header>

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", position: "relative", zIndex: 2 }}>
        <div style={{ flex: "1 1 380px", minHeight: 480, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30 }}>
          {actions.length === 0 && tasks.length === 0 && idleStars.map((s) => (<div key={s.id} className="idle-star" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} />))}

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

          <div style={{ position: "relative", width: 260, height: 260, animation: "float 6s ease-in-out infinite", zIndex: 2 }}>
            <div className="ring" style={{ inset: 0, animation: "spinR 24s linear infinite", borderTopColor: CYAN, borderRightColor: "rgba(56,230,255,.1)", borderBottomColor: "transparent", borderLeftColor: "transparent" }} />
            <div className="ring" style={{ inset: 20, animation: "spinL 30s linear infinite", borderTopColor: "transparent", borderRightColor: "transparent", borderBottomColor: PURPLE, borderLeftColor: "rgba(127,119,221,.1)" }} />
            <div className="ring" style={{ inset: 44, animation: "spinR 18s linear infinite", borderColor: "rgba(56,230,255,.12)", borderTopColor: "rgba(56,230,255,.4)" }} />
            <div style={{ position: "absolute", inset: 70, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, rgba(56,230,255,.35), rgba(127,119,221,.25) 60%, rgba(4,18,43,.9) 100%)", border: "1px solid rgba(56,230,255,.4)", boxShadow: coreShadow, display: "flex", alignItems: "center", justifyContent: "center", transition: "box-shadow .4s", animation: orbState === "idle" ? "pulse 4s ease-in-out infinite" : "none" }}>
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
          <div style={{ marginTop: 40, fontSize: 13, color: "rgba(180,210,255,.75)", letterSpacing: 1, zIndex: 2 }}>{stateLabel}</div>
          {tasks.filter((t) => t.state === "running").length > 0 && (<div style={{ marginTop: 8, fontSize: 11, color: AMBER, zIndex: 2 }}>{tasks.filter((t) => t.state === "running").length} agent(s) aan het werk</div>)}
        </div>

        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", borderLeft: "1px solid rgba(56,230,255,.1)", minHeight: 480, maxHeight: "calc(100vh - 70px)" }}>
          <div ref={scrollRef} className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, i) => (<div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.role === "user" ? `linear-gradient(135deg, ${PURPLE}, #5A52B5)` : "rgba(56,230,255,.08)", border: m.role === "user" ? "none" : "1px solid rgba(56,230,255,.2)", fontSize: 13, lineHeight: 1.5, color: m.role === "user" ? "#fff" : "#DCEEFF", whiteSpace: "pre-wrap" }}>{m.content}</div>))}
            {busy && (<div style={{ alignSelf: "flex-start", padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "rgba(56,230,255,.08)", border: "1px solid rgba(56,230,255,.2)", display: "flex", gap: 5 }}>{[0, 1, 2].map((d) => (<span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: CYAN, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}</div>)}
          </div>
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)", alignItems: "center" }}>
            <button onClick={toggleMic} aria-label="Spraak" style={{ width: 40, height: 40, borderRadius: "50%", border: `1px solid ${listening ? "#FF6B8A" : "rgba(56,230,255,.4)"}`, background: listening ? "rgba(255,107,138,.15)" : "rgba(56,230,255,.08)", color: listening ? "#FF6B8A" : CYAN, cursor: "pointer", fontSize: 17, flexShrink: 0 }}>{listening ? "\u25a0" : "\ud83c\udf99"}</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Praat met NOVA of typ een opdracht..." style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "10px 15px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => sendMessage()} disabled={busy} aria-label="Versturen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: busy ? "not-allowed" : "pointer", fontSize: 17, flexShrink: 0, opacity: busy ? 0.5 : 1, fontWeight: 700 }}>\u2191</button>
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
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".5px" }}>{activeTask.agent}-agent \u00b7 {activeTask.state === "approved" ? "goedgekeurd" : activeTask.state === "awaiting" ? "wacht op je akkoord" : activeTask.state === "error" ? "fout" : "bezig " + Math.round(activeTask.progress) + "%"}</div>
              </div>
              <button onClick={() => dismissTask(activeTask.id)} title="Taak verwijderen" style={{ background: "transparent", border: "1px solid rgba(255,255,255,.2)", color: "rgba(180,210,255,.7)", borderRadius: 8, cursor: "pointer", padding: "4px 10px", fontSize: 12 }}>verwijder</button>
              <button onClick={() => setOpenTask(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
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
                <span>\u2713</span> Goedgekeurd. Klaar om te plaatsen zodra het kanaal gekoppeld is.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)" }}>
              <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendToTask(activeTask.id)} placeholder={activeTask.state === "running" ? "Even wachten tot de agent klaar is..." : activeTask.state === "awaiting" ? "Typ feedback en klik Afkeuren, of keur goed..." : "Stuur de agent een aanpassing of vraag..."} disabled={activeTask.state === "running"} style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "10px 15px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", opacity: activeTask.state === "running" ? 0.5 : 1 }} />
              <button onClick={() => sendToTask(activeTask.id)} disabled={activeTask.state === "running"} aria-label="Sturen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: "pointer", fontSize: 17, flexShrink: 0, opacity: activeTask.state === "running" ? 0.4 : 1, fontWeight: 700 }}>\u2191</button>
            </div>
          </div>
        </div>
      )}

      {showImprove && (
        <div onClick={() => setShowImprove(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(239,159,39,.35)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(239,159,39,.2)" }}>
              <span style={{ fontSize: 18 }}>\u2728</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Verbeterlijst</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Ideeen die NOVA zelf verzamelt voor de volgende update</div>
              </div>
              <button onClick={() => setShowImprove(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {improvements.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "30px 10px" }}>Nog geen verbeterpunten. NOVA voegt hier vanzelf ideeen toe zodra haar iets opvalt dat beter of nieuwer gebouwd kan worden.</div>
              )}
              {improvements.map((it) => (
                <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(239,159,39,.06)", border: "1px solid rgba(239,159,39,.2)", borderRadius: 10 }}>
                  <span style={{ color: AMBER, fontSize: 13, marginTop: 1 }}>\u2728</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.5 }}>{it.text}</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.4)", marginTop: 3 }}>{new Date(it.date).toLocaleString("nl-NL")}</div>
                  </div>
                  <button onClick={() => deleteImprovement(it.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>\u00d7</button>
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
              <span style={{ fontSize: 18 }}>\u2713</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Afgeronde activiteiten</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Taken die je hebt goedgekeurd</div>
              </div>
              <button onClick={() => setShowHistory(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
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
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.4)", marginTop: 2 }}>{h.agent} \u00b7 {new Date(h.date).toLocaleString("nl-NL")}</div>
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
              <span style={{ fontSize: 18 }}>\ud83d\udce6</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Materieel & apparatuur</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>NOVA gebruikt dit automatisch bij aankondigingen en content</div>
              </div>
              <button onClick={() => setShowCatalog(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
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
                  <span style={{ fontSize: 13 }}>\ud83d\udd0a</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF" }}>{p.name}</div>
                    {p.category && (<div style={{ fontSize: 10, color: "rgba(180,210,255,.45)", marginTop: 1 }}>{p.category}</div>)}
                  </div>
                  <button onClick={() => deleteProduct(p.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>\u00d7</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCalendar && (
        <div onClick={() => setShowCalendar(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 21, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", background: "#06182F", border: "1px solid rgba(127,119,221,.35)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(127,119,221,.2)" }}>
              <span style={{ fontSize: 18 }}>\ud83d\uddd3\ufe0f</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Contentkalender</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>Geplande content \u00b7 posten gaat automatisch zodra het kanaal gekoppeld is</div>
              </div>
              <button onClick={() => setShowCalendar(false)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
            </div>
            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {calendar.length === 0 && (<div style={{ fontSize: 13, color: "rgba(180,210,255,.55)", lineHeight: 1.6, textAlign: "center", padding: "26px 10px" }}>Nog geen content ingepland. Vraag NOVA bijvoorbeeld om een TikTok-post voor zaterdag in te plannen.</div>)}
              {calendar.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(127,119,221,.07)", border: "1px solid rgba(127,119,221,.22)", borderRadius: 10 }}>
                  <span style={{ fontSize: 13 }}>{agentIcon(c.channel)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#E8F1FF", lineHeight: 1.4 }}>{c.title}</div>
                    <div style={{ fontSize: 10, color: "rgba(180,210,255,.5)", marginTop: 2 }}>{c.channel} \u00b7 {(() => { try { return new Date(c.when).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return c.when; } })()} \u00b7 {c.status}</div>
                    {c.body && (<div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 4, lineHeight: 1.4 }}>{c.body}</div>)}
                  </div>
                  <button onClick={() => deleteCalendarItem(c.id)} title="Verwijderen" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.4)", cursor: "pointer", fontSize: 15 }}>\u00d7</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showOnboard && (
        <div onClick={() => { setShowOnboard(false); setOpenOnboard(null); }} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 22, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "86vh", background: "#06182F", border: "1px solid rgba(56,230,255,.3)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(56,230,255,.12)" }}>
              <span style={{ fontSize: 20 }}>\ud83e\udded</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{openOnboard ? openOnboard.title : "Setup & koppelingen"}</div>
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>{openOnboard ? openOnboard.intent : "Stap voor stap door wat nodig is per koppeling. Vink af zodra je een stap hebt gedaan."}</div>
              </div>
              {openOnboard && (<button onClick={() => setOpenOnboard(null)} style={{ background: "transparent", border: "1px solid rgba(56,230,255,.3)", borderRadius: 8, color: CYAN, cursor: "pointer", padding: "4px 10px", fontSize: 11 }}>\u2190 terug</button>)}
              <button onClick={() => { setShowOnboard(false); setOpenOnboard(null); }} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
            </div>

            <div className="nova-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
              {!openOnboard && (
                <>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginBottom: 12, lineHeight: 1.5, padding: "10px 12px", background: "rgba(56,230,255,.05)", borderRadius: 8, border: "1px solid rgba(56,230,255,.15)" }}>
                    <strong style={{ color: CYAN }}>Veilig:</strong> wachtwoorden en sleutels voer je NIET hier in. Die staan alleen in Vercel \u2192 Environment Variables. NOVA leest hier uit of een koppeling klaar is, niet de waarde zelf.
                  </div>
                  {onboarding.map((c) => (
                    <div key={c.key} onClick={() => setOpenOnboard(c)} role="button" tabIndex={0} style={{ display: "flex", gap: 12, padding: "14px 14px", marginBottom: 8, background: c.connected ? "rgba(29,158,117,.06)" : "rgba(255,255,255,.025)", border: `1px solid ${c.connected ? "rgba(29,158,117,.25)" : "rgba(180,210,255,.12)"}`, borderRadius: 10, cursor: "pointer", alignItems: "center" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.connected ? "#1D9E75" : "rgba(255,255,255,.08)", color: c.connected ? "#fff" : "rgba(180,210,255,.5)", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: c.connected ? "none" : "1px solid rgba(180,210,255,.2)" }}>{c.connected ? "\u2713" : c.done}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: "#fff", fontWeight: 500 }}>{c.title}</div>
                        <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 2, lineHeight: 1.5 }}>{c.intent}</div>
                        <div style={{ marginTop: 8, height: 3, borderRadius: 2, background: "rgba(255,255,255,.1)" }}>
                          <div style={{ height: "100%", width: `${Math.round((c.done / c.total) * 100)}%`, background: c.connected ? "#1D9E75" : CYAN, borderRadius: 2 }} />
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(180,210,255,.45)", marginTop: 4 }}>{c.connected ? "Koppeling actief" : `${c.done} van ${c.total} stappen afgevinkt`}</div>
                      </div>
                      <span style={{ color: "rgba(180,210,255,.5)", fontSize: 18 }}>\u203a</span>
                    </div>
                  ))}
                </>
              )}

              {openOnboard && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {openOnboard.steps.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", gap: 12, padding: "12px 14px", background: s.done ? "rgba(29,158,117,.07)" : "rgba(255,255,255,.025)", border: `1px solid ${s.done ? "rgba(29,158,117,.25)" : "rgba(180,210,255,.12)"}`, borderRadius: 10, alignItems: "flex-start" }}>
                      <button onClick={() => toggleOnboardStep(s.id, !s.done)} style={{ width: 22, height: 22, borderRadius: 6, background: s.done ? "#1D9E75" : "transparent", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, border: s.done ? "none" : "1.5px solid rgba(180,210,255,.3)", cursor: "pointer" }}>{s.done ? "\u2713" : ""}</button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: s.done ? "rgba(180,210,255,.55)" : "#fff", fontWeight: 500, textDecoration: s.done ? "line-through" : "none" }}>{i + 1}. {s.title}</div>
                        <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", marginTop: 4, lineHeight: 1.55 }}>{s.help}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!openOnboard && (
              <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(56,230,255,.1)", fontSize: 11, color: "rgba(180,210,255,.5)", lineHeight: 1.5 }}>
                Na een nieuwe sleutel in Vercel: opnieuw deployen zonder build-cache, dan dit paneel weer openen.
              </div>
            )}
          </div>
        </div>
      )}

      {pendingWA && (
        <div onClick={() => setPendingWA(null)} style={{ position: "absolute", inset: 0, background: "rgba(2,10,26,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "#06182F", border: "1px solid rgba(29,158,117,.35)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(29,158,117,.2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>\ud83d\udcac</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>WhatsApp versturen?</div>
                  <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)" }}>NOVA wacht op je akkoord</div>
                </div>
                <button onClick={() => setPendingWA(null)} aria-label="Sluiten" style={{ background: "transparent", border: "none", color: "rgba(180,210,255,.7)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>\u00d7</button>
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
    </div>
  );
}
