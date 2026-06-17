import { useState, useRef, useEffect, useCallback } from "react";

const PURPLE = "#7F77DD";
const CYAN = "#38E6FF";
const DEEP = "#04122B";

const API_URL = "/api/chat";

// Standaard sterren die rondzweven als er geen acties uitgeklapt zijn.
const IDLE_STARS = 5;

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

// Een willekeurige positie op een ring rond het midden (in procenten van de container).
function randomOrbitPos() {
  const angle = Math.random() * Math.PI * 2;
  const radius = 30 + Math.random() * 14; // 30-44% vanaf midden
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius * 0.82,
  };
}

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Goedendag. Ik ben NOVA, de AI-agent van JnA Events voor engineering en design. Geef me een opdracht of stel een vraag, dan ga ik aan de slag.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [status, setStatus] = useState("Online \u00b7 klaar voor je opdracht");
  const [micSupported, setMicSupported] = useState(true);

  // Actie-sterren rond de cirkel
  const [actions, setActions] = useState([]); // [{id,label,x,y}]
  const [idleStars, setIdleStars] = useState([]); // [{id,x,y}]

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const voicesRef = useRef([]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Idle-sterren: verschijnen, blijven even, vervagen en komen elders terug.
  useEffect(() => {
    setIdleStars(
      Array.from({ length: IDLE_STARS }, (_, i) => ({ id: "idle-" + i, ...randomOrbitPos() }))
    );
    const iv = setInterval(() => {
      setIdleStars((prev) =>
        prev.map((s) =>
          Math.random() < 0.5 ? { ...s, ...randomOrbitPos(), bump: Math.random() } : s
        )
      );
    }, 2600);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function load() {
      voicesRef.current = window.speechSynthesis?.getVoices() || [];
    }
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = "nl-NL";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setInput(text);
      setListening(false);
      setTimeout(() => sendMessage(text), 250);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setStatus("Microfoon geweigerd \u2014 sta toegang toe in je browser");
      } else if (e.error === "no-speech") {
        setStatus("Niets gehoord \u2014 probeer opnieuw");
      } else {
        setStatus("Spraakfout \u2014 typ je bericht of probeer opnieuw");
      }
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickVoice() {
    const voices = voicesRef.current.length
      ? voicesRef.current
      : window.speechSynthesis?.getVoices() || [];
    const nl = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
    if (!nl.length) return null;
    const prefer = ["google", "microsoft", "natural", "online", "premium", "enhanced"];
    for (const key of prefer) {
      const hit = nl.find((v) => v.name.toLowerCase().includes(key));
      if (hit) return hit;
    }
    const female = nl.find((v) => /female|vrouw|fenna|lotte|colette|saskia/i.test(v.name));
    return female || nl[0];
  }

  function speak(text) {
    if (!voiceOn || !window.speechSynthesis) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "nl-NL";
    u.rate = 0.98;
    u.pitch = 0.95;
    u.volume = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function toggleVoice() {
    if (voiceOn) stopSpeaking();
    setVoiceOn((v) => !v);
  }

  async function toggleMic() {
    if (!micSupported) {
      setStatus("Spraak werkt in Chrome of Edge \u2014 typ hier je bericht");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Geef de browser toegang tot je microfoon en probeer opnieuw");
      return;
    }
    stopSpeaking();
    setListening(true);
    setStatus("Luisteren...");
    try {
      recognitionRef.current.start();
    } catch {
      setListening(false);
    }
  }

  const placeActions = useCallback((list) => {
    const placed = list.map((label, i) => ({
      id: "act-" + Date.now() + "-" + i,
      label,
      ...randomOrbitPos(),
    }));
    setActions(placed);
  }, []);

  async function sendMessage(forced) {
    const text = (forced ?? input).trim();
    if (!text || busy) return;

    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setActions([]); // oude acties opruimen tijdens nadenken
    setStatus("NOVA denkt na...");

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error("api");
      const data = await res.json();
      const reply = (data.reply || "").trim() || "Sorry, ik kon even niet reageren.";
      setMessages((p) => [...p, { role: "assistant", content: reply }]);
      setStatus("Online \u00b7 klaar voor je opdracht");
      speak(reply);
      if (Array.isArray(data.actions) && data.actions.length) {
        setTimeout(() => placeActions(data.actions), 400);
      }
    } catch {
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          content:
            "Ik kon mijn AI-brein niet bereiken. Controleer of de backend draait en of de API-sleutel goed staat.",
        },
      ]);
      setStatus("Verbindingsfout");
    } finally {
      setBusy(false);
    }
  }

  function clickAction(a) {
    setActions((prev) => prev.filter((x) => x.id !== a.id));
    sendMessage(a.label);
  }

  const orbState = speaking ? "speaking" : busy ? "thinking" : listening ? "listening" : "idle";
  const stateLabel = {
    speaking: "NOVA spreekt...",
    thinking: "NOVA denkt na...",
    listening: "NOVA luistert...",
    idle: "NOVA staat klaar",
  }[orbState];

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        background: `radial-gradient(ellipse at 50% 0%, #0A1F44 0%, ${DEEP} 55%, #020A1A 100%)`,
        minHeight: "100vh",
        color: "#E8F1FF",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Orbitron:wght@600;800&display=swap');
        *{box-sizing:border-box}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes rotR{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes rotL{from{transform:rotate(360deg)}to{transform:rotate(0)}}
        @keyframes pulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.9;transform:scale(1.04)}}
        @keyframes scan{0%{transform:translateY(-110px);opacity:0}50%{opacity:.6}100%{transform:translateY(110px);opacity:0}}
        @keyframes wave{0%,100%{height:6px}50%{height:22px}}
        @keyframes pf{0%{transform:translateY(0);opacity:0}20%{opacity:.7}100%{transform:translateY(-60px) translateX(15px);opacity:0}}
        @keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes actIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
        @keyframes twinkle{0%,100%{opacity:.15;transform:translate(-50%,-50%) scale(.7)}50%{opacity:.9;transform:translate(-50%,-50%) scale(1.1)}}
        .ring{position:absolute;border-radius:50%;border:1px solid rgba(56,230,255,.25)}
        .msg{animation:msgIn .3s ease}
        .idle-star{position:absolute;width:7px;height:7px;border-radius:50%;background:${CYAN};box-shadow:0 0 10px ${CYAN};transform:translate(-50%,-50%);transition:left 2.4s ease,top 2.4s ease,opacity 2.4s ease;pointer-events:none}
        .act-star{position:absolute;transform:translate(-50%,-50%);animation:actIn .45s cubic-bezier(.2,1.3,.5,1) both;cursor:pointer;z-index:5}
        .act-dot{width:12px;height:12px;border-radius:50%;background:${CYAN};box-shadow:0 0 14px ${CYAN},0 0 26px rgba(56,230,255,.5);margin:0 auto}
        .act-label{margin-top:7px;font-size:11px;line-height:1.3;color:#Eaf6ff;background:rgba(8,26,54,.85);border:1px solid rgba(56,230,255,.4);padding:5px 10px;border-radius:14px;white-space:nowrap;backdrop-filter:blur(4px);transition:all .2s;max-width:160px;text-overflow:ellipsis;overflow:hidden}
        .act-star:hover .act-label{background:rgba(56,230,255,.18);border-color:${CYAN};color:#fff}
        .act-star:hover .act-dot{transform:scale(1.3)}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}.idle-star{transition:opacity .4s}}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:rgba(56,230,255,.3);border-radius:3px}
        input::placeholder{color:rgba(180,210,255,.4)}
      `}</style>

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {[...Array(14)].map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${(i * 7.3) % 100}%`, top: `${30 + ((i * 13) % 60)}%`, width: 3, height: 3, borderRadius: "50%", background: i % 2 ? CYAN : PURPLE, animation: `pf ${4 + (i % 4)}s ease-in ${i * 0.4}s infinite` }} />
        ))}
      </div>

      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", borderBottom: "1px solid rgba(56,230,255,.12)", position: "relative", zIndex: 2 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: CYAN, boxShadow: `0 0 12px ${CYAN}`, animation: "pulse 2s infinite" }} />
        <div>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 16, letterSpacing: 2, fontWeight: 800 }}>JnA EVENTS</div>
          <div style={{ fontSize: 11, color: "rgba(180,210,255,.6)", letterSpacing: 1 }}>NOVA \u00b7 autonomous AI command center</div>
        </div>
        <button onClick={toggleVoice} aria-label="Stem aan of uit" title={voiceOn ? "Stem uitzetten" : "Stem aanzetten"} style={{ marginLeft: "auto", width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(56,230,255,.3)", background: voiceOn ? "rgba(56,230,255,.12)" : "transparent", color: voiceOn ? CYAN : "rgba(180,210,255,.5)", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>{voiceOn ? "\ud83d\udd0a" : "\ud83d\udd07"}</button>
        <div style={{ fontSize: 11, color: CYAN, border: "1px solid rgba(56,230,255,.3)", padding: "4px 12px", borderRadius: 20, letterSpacing: 1 }}>{status}</div>
      </header>

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", position: "relative", zIndex: 2 }}>
        {/* Orb-zone met actie-sterren */}
        <div style={{ flex: "1 1 360px", minHeight: 420, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 30 }}>

          {/* Idle-sterren (achter de wolken) */}
          {actions.length === 0 && idleStars.map((s) => (
            <div key={s.id} className="idle-star" style={{ left: `${s.x}%`, top: `${s.y}%`, opacity: 0.15 + (s.bump || 0) * 0.7, animation: "twinkle 3s ease-in-out infinite" }} />
          ))}

          {/* Actie-sterren (uitgeklapt na een antwoord) */}
          {actions.map((a) => (
            <div key={a.id} className="act-star" style={{ left: `${a.x}%`, top: `${a.y}%` }} onClick={() => clickAction(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && clickAction(a)}>
              <div className="act-dot" />
              <div className="act-label">{a.label}</div>
            </div>
          ))}

          <div style={{ position: "relative", width: 280, height: 280, animation: "float 6s ease-in-out infinite", zIndex: 2 }}>
            <div className="ring" style={{ inset: 0, animation: "rotR 18s linear infinite", borderTopColor: CYAN, borderBottomColor: "transparent" }} />
            <div className="ring" style={{ inset: 26, animation: "rotL 14s linear infinite", borderLeftColor: PURPLE, borderRightColor: "transparent" }} />
            <div className="ring" style={{ inset: 52, animation: "rotR 10s linear infinite", borderColor: "rgba(56,230,255,.15)", borderTopColor: CYAN }} />
            <div style={{ position: "absolute", inset: 78, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, rgba(56,230,255,.35), rgba(127,119,221,.25) 60%, rgba(4,18,43,.9) 100%)", border: "1px solid rgba(56,230,255,.4)", boxShadow: orbState === "speaking" ? "0 0 50px rgba(56,230,255,.7), inset 0 0 30px rgba(56,230,255,.4)" : orbState === "thinking" ? "0 0 40px rgba(127,119,221,.6), inset 0 0 24px rgba(127,119,221,.4)" : "0 0 30px rgba(56,230,255,.35), inset 0 0 20px rgba(56,230,255,.25)", display: "flex", alignItems: "center", justifyContent: "center", transition: "box-shadow .4s", animation: orbState === "idle" ? "pulse 4s ease-in-out infinite" : "none" }}>
              <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 19, fontWeight: 800, textAlign: "center", lineHeight: 1.1, letterSpacing: 1, color: "#fff", textShadow: `0 0 18px ${CYAN}` }}>
                JnA<div style={{ fontSize: 11, letterSpacing: 3, color: CYAN, marginTop: 2 }}>EVENTS</div>
              </div>
              <div style={{ position: "absolute", left: "10%", right: "10%", height: 1, background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)`, animation: "scan 3s ease-in-out infinite" }} />
            </div>
            {(speaking || listening) && (
              <div style={{ position: "absolute", bottom: -24, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 4, height: 24 }}>
                {[...Array(7)].map((_, i) => (
                  <div key={i} style={{ width: 3, background: listening ? "#FF6B8A" : CYAN, borderRadius: 2, animation: `wave ${0.6 + (i % 3) * 0.2}s ease-in-out infinite`, animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 44, fontSize: 13, color: "rgba(180,210,255,.75)", letterSpacing: 1, zIndex: 2 }}>{stateLabel}</div>
        </div>

        {/* Chat */}
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", borderLeft: "1px solid rgba(56,230,255,.1)", minHeight: 420, maxHeight: "calc(100vh - 80px)" }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} className="msg" style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.role === "user" ? `linear-gradient(135deg, ${PURPLE}, #5A52B5)` : "rgba(56,230,255,.08)", border: m.role === "user" ? "none" : "1px solid rgba(56,230,255,.2)", fontSize: 13.5, lineHeight: 1.55, color: m.role === "user" ? "#fff" : "#DCEEFF", whiteSpace: "pre-wrap" }}>{m.content}</div>
            ))}
            {busy && (
              <div style={{ alignSelf: "flex-start", padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "rgba(56,230,255,.08)", border: "1px solid rgba(56,230,255,.2)", display: "flex", gap: 5 }}>
                {[0, 1, 2].map((d) => (<span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: CYAN, animation: `pulse 1s ${d * 0.2}s infinite` }} />))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, padding: "14px 18px", borderTop: "1px solid rgba(56,230,255,.1)", alignItems: "center" }}>
            <button onClick={toggleMic} aria-label="Spraak" title={micSupported ? "Spraak" : "Spraak werkt in Chrome of Edge"} style={{ width: 42, height: 42, borderRadius: "50%", border: `1px solid ${listening ? "#FF6B8A" : "rgba(56,230,255,.4)"}`, background: listening ? "rgba(255,107,138,.15)" : "rgba(56,230,255,.08)", color: listening ? "#FF6B8A" : CYAN, cursor: "pointer", fontSize: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s", opacity: micSupported ? 1 : 0.5 }}>{listening ? "\u25a0" : "\ud83c\udf99"}</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Praat met NOVA of typ een opdracht..." style={{ flex: 1, background: "rgba(4,18,43,.6)", border: "1px solid rgba(56,230,255,.25)", borderRadius: 22, padding: "11px 16px", color: "#E8F1FF", fontSize: 13.5, outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => sendMessage()} disabled={busy} aria-label="Versturen" style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: `linear-gradient(135deg, ${CYAN}, ${PURPLE})`, color: "#04122B", cursor: busy ? "not-allowed" : "pointer", fontSize: 18, flexShrink: 0, opacity: busy ? 0.5 : 1, fontWeight: 700 }}>\u2191</button>
          </div>
        </div>
      </div>
    </div>
  );
}
