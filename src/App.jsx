import { useState, useRef, useEffect, useCallback } from "react";

const CYAN = "#38E6FF";
const PURPLE = "#7F77DD";
const AMBER = "#EF9F27";

const CHAT_URL = "/api/chat";
const LOGIN_URL = "/api/login";
const TOKEN_KEY = "nova_token";

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
  const kept = [];
  for (const line of lines) {
    const a = line.match(/^\s*ACTIES\s*:\s*(.+)$/i);
    const t = line.match(/^\s*TAAK\s*:\s*(.+)$/i);
    if (a) {
      actions = a[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    } else if (t) {
      const parts = t[1].split("|").map((s) => s.trim());
      if (parts.length >= 2) task = { agent: parts[0], title: parts[1], brief: parts[2] || parts[1] };
    } else {
      kept.push(line);
    }
  }
  return { reply: kept.join("\n").trim(), actions, task };
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

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);
  const tasksRef = useRef([]);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, busy]);

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
      body: JSON.stringify({ messages: msgs, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { onLogout(); throw new Error("Sessie verlopen, log opnieuw in."); }
    if (!res.ok) throw new Error(data.error || `Serverfout (${res.status})`);
    return data.reply || "";
  }

  function startTask({ agent, title, brief }) {
    const usedSlots = tasksRef.current.filter((t) => t.state !== "done").map((t) => t.slot);
    let slot = TASK_SLOTS.findIndex((_, i) => !usedSlots.includes(i));
    if (slot < 0) slot = 0;
    const id = "task-" + Date.now();
    setTasks((prev) => [...prev, { id, agent, title, brief, progress: 6, state: "running", result: "", slot, chat: [] }]);
    const prog = setInterval(() => {
      setTasks((prev) => prev.map((t) => (t.id === id && t.state === "running" ? { ...t, progress: Math.min(t.progress + Math.random() * 9 + 3, 94) } : t)));
    }, 700);
    callBackend([{ role: "user", content: brief }], "worker")
      .then((result) => { clearInterval(prog); setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, progress: 100, state: "done", result, chat: [{ role: "assistant", content: result }] } : t))); })
      .catch(() => { clearInterval(prog); setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, state: "error", result: "Deze taak kon niet worden afgerond." } : t))); });
  }

  async function sendMessage(forced) {
    const text = (forced ?? input).trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setActions([]); setStatus("NOVA denkt na...");
    try {
      const raw = await callBackend(next.map((m) => ({ role: m.role, content: m.content })));
      const { reply, actions: acts, task } = parseReply(raw);
      const finalReply = reply || "Sorry, ik kon even niet reageren.";
      setMessages((p) => [...p, { role: "assistant", content: finalReply }]);
      setStatus("Online \u00b7 klaar voor je opdracht");
      speak(finalReply);
      if (task) startTask(task);
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
            const col = t.state === "done" ? "#1D9E75" : t.state === "error" ? "#E24B4A" : AMBER;
            return (
              <div key={t.id} className="task-node" style={{ left: `${slot.x}%`, top: `${slot.y}%` }} onClick={() => setOpenTask(t.id)} role="button" tabIndex={0}>
                <div className="task-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 13 }}>{agentIcon(t.agent)}</span>
                    <span style={{ fontSize: 10, color: "rgba(180,210,255,.7)", textTransform: "uppercase", letterSpacing: ".5px" }}>{t.agent}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: col }}>{t.state === "done" ? "klaar" : t.state === "error" ? "fout" : Math.round(t.progress) + "%"}</span>
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
                <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", textTransform: "uppercase", letterSpacing: ".5px" }}>{activeTask.agent}-agent \u00b7 {activeTask.state === "done" ? "voltooid" : activeTask.state === "error" ? "fout" : "bezig " + Math.round(activeTask.progress) + "%"}</div>
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
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(56,230,255,.1)" }}>
              <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendToTask(activeTask.id)} placeholder={activeTask.state === "running" ? "Even wachten tot de agent klaar is..." : "Stuur de agent een aanpassing of vraag..."} disabled={activeTask.state === "running"} style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "10px 15px", color: "#E8F1FF", fontSize: 13, outline: "none", fontFamily: "inherit", opacity: activeTask.state === "running" ? 0.5 : 1 }} />
              <button onClick={() => sendToTask(activeTask.id)} disabled={activeTask.state === "running"} aria-label="Sturen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: "pointer", fontSize: 17, flexShrink: 0, opacity: activeTask.state === "running" ? 0.4 : 1, fontWeight: 700 }}>\u2191</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
