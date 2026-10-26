"use client";

import clsx from "clsx";
import { useRef, useState } from "react";
import { api } from "@/lib/api";

/** Records a voice note and sends it to Muse Voice Transcribe (the server converts it to WAV). */
export function VoiceButton({ onText, compact }: { onText: (text: string) => void; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("working");
        try {
          const { transcript } = await api.voice(new Blob(chunks.current, { type: mr.mimeType }));
          onText(transcript);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Couldn't transcribe that.");
        } finally {
          setState("idle");
        }
      };
      mr.start();
      rec.current = mr;
      setState("recording");
    } catch {
      setErr("Microphone access was blocked.");
    }
  }

  function stop() {
    rec.current?.stop();
  }

  const label = state === "recording" ? "Stop recording" : state === "working" ? "Transcribing…" : "Record a voice note";
  return (
    <span className="relative inline-flex items-center gap-2">
      <button type="button" aria-label={label} title={label} disabled={state === "working"} onClick={state === "recording" ? stop : start}
        className={clsx(
          "grid place-items-center rounded-full border transition",
          compact ? "h-11 w-11" : "h-12 min-w-12 gap-2 px-4",
          state === "recording" ? "border-shock bg-shock/15" : "border-line-2 hover:border-paper",
        )}>
        {state === "recording" ? (
          <span className="h-3 w-3 animate-pulse rounded-sm bg-shock" aria-hidden="true" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </button>
      {!compact && <span className="text-[14px] text-soft">{state === "recording" ? "Listening… tap to stop" : state === "working" ? "Transcribing with Muse Voice…" : "Or say it out loud"}</span>}
      {err && <span role="alert" className="absolute left-0 top-full mt-1 whitespace-nowrap text-[12px] text-shock">{err}</span>}
    </span>
  );
}
