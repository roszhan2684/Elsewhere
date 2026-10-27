"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { ApiError, postStream } from "@/lib/api";
import { type VoiceStatus, speakTurns, stopSpeaking } from "@/lib/voice";
import type { PersonaMessage, Simulation, Timepoint } from "@/lib/types";
import { TP_LABEL } from "@/lib/types";
import { ClaimText } from "./ClaimText";
import { VoiceButton } from "./VoiceButton";

type Mode = "A" | "B" | "both";
let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;
type Live = PersonaMessage & { streaming?: boolean; replyingTo?: string | null };

const SUGGESTIONS = ["What do you regret?", "How is money, honestly?", "What does a normal Tuesday look like?", "What surprised you most?"];

export function ChatPanel({
  sim,
  tp,
  messages: initial,
  ensureLive,
  selected,
  onSelect,
}: {
  sim: Simulation;
  tp: Timepoint;
  messages: PersonaMessage[];
  ensureLive: () => Promise<string>;
  selected: string | null;
  onSelect: (ref: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("both");
  const [messages, setMessages] = useState<Live[]>(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState<VoiceStatus>({ state: "idle" });
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => () => stopSpeaking(), []);

  function listen(list: Live[], id: string) {
    if (speakingId === id) {
      stopSpeaking();
      setSpeakingId(null);
      setVoice({ state: "idle" });
      return;
    }
    const turns = list.filter((m) => m.role !== "user" && m.text).map((m) => ({ text: m.text, branch: (m.role === "future_a" ? "A" : "B") as "A" | "B" }));
    setSpeakingId(id);
    speakTurns(turns, (st) => {
      setVoice(st);
      if (st.state === "idle" || st.state === "error") setSpeakingId((cur) => (cur === id ? null : cur));
    });
  }
  const evidence = new Map(sim.evidence.map((e) => [e.id, e]));
  const events = new Map(sim.events.map((e) => [e.id, e]));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setGuard(null);
    setQ("");
    const userMsg: Live = { id: nextId("u"), role: "user", text: question, claims: [], guard_rewrites: 0, timepoint: tp, created_at: "" };
    setMessages((m) => [...m, userMsg]);
    let current: string | null = null;
    const start = (branch: "A" | "B", replyingTo: string | null) => {
      const id = nextId(`s${branch}`);
      current = id;
      setMessages((m) => [...m, { id, role: branch === "A" ? "future_a" : "future_b", text: "", claims: [], guard_rewrites: 0, timepoint: tp, created_at: "", streaming: true, replyingTo }]);
    };
    try {
      const id = await ensureLive();
      if (mode !== "both") start(mode, null);
      await postStream(`/v1/simulations/${id}/chat`, { branch: mode, question, timepoint: tp }, (type, data) => {
        if (type === "turn") start(data.branch as "A" | "B", (data.replying_to as string | null) ?? null);
        else if (type === "delta") {
          const target = current;
          setMessages((m) => m.map((x) => (x.id === target ? { ...x, text: x.text + (data.text as string) } : x)));
        } else if (type === "message") {
          const final = data.message as PersonaMessage;
          const target = current;
          setMessages((m) => m.map((x) => (x.id === target ? { ...final, replyingTo: x.replyingTo } : x)));
        } else if (type === "guard") {
          setGuard(`Branch guard rewrote ${data.rewrites} sentence${Number(data.rewrites) > 1 ? "s" : ""} from Future ${data.branch} that reached into the other world.`);
        } else if (type === "error") setError(String(data.error));
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your future self didn't answer. Try again.");
      setMessages((m) => m.filter((x) => !x.streaming || x.text));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-soft">
          Talking to your futures at <b className="font-medium text-paper">{TP_LABEL[tp].toLowerCase()}</b>. Each one only knows its own world.
        </p>
        <div role="tablist" aria-label="Who to ask" className="flex gap-1 rounded-full bg-ink-2 p-1 text-[14px]">
          {(["A", "B", "both"] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
              className={clsx("min-h-10 rounded-full px-4", mode === m ? "bg-paper font-medium text-ink" : "text-soft hover:text-paper")}>
              {m === "both" ? "Debate" : `Future ${m}`}
            </button>
          ))}
        </div>
      </div>

      {messages.some((m) => m.role !== "user" && m.text && !m.streaming) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-2 px-3 py-2">
          <button type="button" onClick={() => listen(messages, "all")}
            className="flex min-h-9 items-center gap-2 rounded-full border border-line-2 px-3.5 text-[13px] hover:border-paper">
            <Speaker on={speakingId === "all"} />{speakingId === "all" ? "Stop" : "Listen to your futures"}
          </button>
          <span className="text-[12px] text-muted">
            {voice.state === "loading" ? `Loading Meta’s MMS voice model in your browser (first time only, ~38 MB)… ${Math.round(voice.progress * 100)}%`
              : voice.state === "speaking" ? (voice.engine === "meta" ? "Speaking with Meta MMS-TTS, on your device. Future A and B get different voices." : "Meta’s voice model couldn’t load here, so this is your browser’s voice.")
              : "Voices by Meta’s open-source MMS-TTS model, running on your device. Nothing is sent anywhere."}
          </span>
        </div>
      )}

      <div className="flex max-h-[560px] min-h-[200px] flex-col gap-5 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && <p className="py-6 text-center text-[14px] text-muted">Ask a question, or try one below.</p>}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[80%] self-end rounded-[18px_18px_4px_18px] bg-line px-4 py-3 text-[15px] leading-relaxed">{m.text}</div>
          ) : (
            <div key={m.id} className="flex items-start gap-3">
              <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[13px] font-semibold text-ink", m.role === "future_a" ? "bg-path-a" : "bg-path-b")}>
                {m.role === "future_a" ? "A" : "B"}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                  <span className="font-medium text-paper">{m.role === "future_a" ? `Future A · ${sim.branches.A.label}` : `Future B · ${sim.branches.B.label}`}</span>
                  <span className="font-mono">{TP_LABEL[m.timepoint]}{m.replyingTo ? ` · replying to ${m.replyingTo}` : ""}</span>
                  {m.guard_rewrites > 0 && <span className="font-mono text-path-b">guard: {m.guard_rewrites} rewritten</span>}
                  {!m.streaming && m.text && (
                    <button type="button" onClick={() => listen([m], m.id)} className="flex items-center gap-1 text-muted hover:text-paper"
                      aria-label={speakingId === m.id ? "Stop" : `Listen to Future ${m.role === "future_a" ? "A" : "B"}`}>
                      <Speaker on={speakingId === m.id} />
                    </button>
                  )}
                </div>
                <p className="font-display text-[19px] leading-[1.55]">
                  <ClaimText text={m.text} evidence={evidence} events={events} selected={selected} onSelect={onSelect} />
                  {m.streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-paper" aria-hidden="true" />}
                </p>
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {guard && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-2 px-4 py-3 text-[13px] leading-relaxed text-soft">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></svg>
          {guard}
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-shock">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => ask(s)}
            className="min-h-10 rounded-full border border-line-2 px-3.5 text-[13px] text-paper-2 hover:border-paper disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }}
        className="flex items-center gap-2 rounded-full border border-line bg-ink-2 py-1.5 pl-5 pr-1.5">
        <label htmlFor="ask" className="sr-only">Ask your future selves</label>
        <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "both" ? "Ask both futures…" : `Ask Future ${mode}…`}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
        <VoiceButton onText={(t) => setQ(t)} compact />
        <button type="submit" disabled={busy || !q.trim()} className="min-h-11 rounded-full bg-paper px-5 text-[14px] font-medium text-ink disabled:opacity-40">
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function Speaker({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {on ? <path d="M16 9l5 5M21 9l-5 5" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}
