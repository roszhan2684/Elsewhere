// Future selves speak with Meta's open-source MMS text-to-speech model (facebook/mms-tts-eng),
// running in the browser through transformers.js. No server, no API cost.
// MMS weights are CC-BY-NC 4.0: fine for a hackathon demo, not for a commercial product.
// If the model can't load, we fall back to the browser's built-in voice and say so.

import type { Branch } from "./types";

const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL = "Xenova/mms-tts-eng";
const REF = /\s*\[(ev_[UABS]_\d{3}|E-[AB]-\d{3})\]/g;

// One model, two voices: Future A a little brighter and quicker, Future B lower and slower.
const VOICE: Record<Branch, { rate: number; pitch: number }> = {
  A: { rate: 1.06, pitch: 1.1 },
  B: { rate: 0.9, pitch: 0.8 },
};

export type VoiceStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number }
  | { state: "speaking"; engine: "meta" | "browser" }
  | { state: "error"; message: string };

const WORKER = `
import { pipeline, env } from "${TRANSFORMERS}";
env.allowLocalModels = false;
let tts = null;
self.onmessage = async (e) => {
  const { id, text } = e.data;
  try {
    if (!tts) {
      tts = await pipeline("text-to-speech", "${MODEL}", {
        dtype: "q8",
        progress_callback: (p) => { if (p.status === "progress" && p.file && p.file.endsWith(".onnx")) self.postMessage({ type: "progress", progress: p.progress / 100 }); },
      });
    }
    const out = await tts(text);
    self.postMessage({ type: "audio", id, audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", id, error: String(err && err.message || err) });
  }
};`;

let worker: Worker | null = null;
let broken = false;
let ctx: AudioContext | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: { audio: Float32Array; rate: number }) => void; reject: (e: Error) => void }>();
let progressCb: ((p: number) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
  worker = new Worker(url, { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === "progress") progressCb?.(d.progress);
    else if (d.type === "audio") pending.get(d.id)?.resolve({ audio: d.audio, rate: d.rate });
    else if (d.type === "error") pending.get(d.id)?.reject(new Error(d.error));
    if (d.id !== undefined && d.type !== "progress") pending.delete(d.id);
  };
  worker.onerror = () => {
    broken = true;
    for (const p of pending.values()) p.reject(new Error("voice model failed to load"));
    pending.clear();
  };
  return worker;
}

function synth(text: string): Promise<{ audio: Float32Array; rate: number }> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text });
  });
}

export function speakable(text: string): string {
  return text.replace(REF, "").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  const parts = speakable(text).match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (out.length && out[out.length - 1].length + s.length < 160) out[out.length - 1] += " " + s;
    else out.push(s);
  }
  return out;
}

let stopToken = 0;
let current: AudioBufferSourceNode | null = null;

export function stopSpeaking(): void {
  stopToken++;
  try {
    current?.stop();
  } catch {}
  current = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function play(audio: Float32Array, rate: number, branch: Branch): Promise<void> {
  ctx ??= new AudioContext();
  const buf = ctx.createBuffer(1, audio.length, rate);
  buf.getChannelData(0).set(audio);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = VOICE[branch].rate;
  src.connect(ctx.destination);
  current = src;
  return new Promise((resolve) => {
    src.onended = () => resolve();
    src.start();
  });
}

function browserSpeak(text: string, branch: Branch): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.rate = VOICE[branch].rate;
    u.pitch = VOICE[branch].pitch;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

/** Speak a list of turns in order, each in its future self's voice. */
export async function speakTurns(turns: { text: string; branch: Branch }[], onStatus: (s: VoiceStatus) => void): Promise<void> {
  stopSpeaking();
  const token = stopToken;
  ctx ??= new AudioContext();
  await ctx.resume().catch(() => {});
  progressCb = (p) => onStatus({ state: "loading", progress: p });
  const queue = turns.flatMap((t) => sentences(t.text).map((s) => ({ text: s, branch: t.branch })));
  if (!queue.length) return onStatus({ state: "idle" });
  if (!broken) {
    try {
      onStatus({ state: "loading", progress: 0 });
      let next = synth(queue[0].text);
      for (let i = 0; i < queue.length; i++) {
        const { audio, rate } = await next;
        if (token !== stopToken) return;
        if (i + 1 < queue.length) next = synth(queue[i + 1].text);
        onStatus({ state: "speaking", engine: "meta" });
        await play(audio, rate, queue[i].branch);
        if (token !== stopToken) return;
      }
      return onStatus({ state: "idle" });
    } catch {
      broken = true;
      if (token !== stopToken) return;
    }
  }
  onStatus({ state: "speaking", engine: "browser" });
  for (const t of queue) {
    if (token !== stopToken) return;
    await browserSpeak(t.text, t.branch);
  }
  if (token === stopToken) onStatus({ state: "idle" });
}
