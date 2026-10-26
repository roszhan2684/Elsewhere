import type { DecisionSpec, PersonaMessage, Simulation, Timepoint } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Can't reach the Elsewhere server. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error ?? body.detail ?? msg;
      if (typeof msg !== "string") msg = `Request failed (${res.status})`;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  budget: () => req<{ mode: "live" | "mock"; limit_usd: number; spent_usd: number; reserved_usd: number; remaining_usd: number }>("/v1/budget"),
  meta: () => req<{ mode: "live" | "mock"; prompt_version: string; models: Record<string, string> }>("/v1/meta"),
  createDecision: (text: string) => req<{ id: string; decision: DecisionSpec; mode: string }>("/v1/decisions", { method: "POST", body: JSON.stringify({ text }) }),
  editDecision: (id: string, decision: DecisionSpec) => req<{ id: string; decision: DecisionSpec }>(`/v1/decisions/${id}`, { method: "PATCH", body: JSON.stringify(decision) }),
  clarify: (id: string, answers: Record<string, string>) => req<{ id: string; decision: DecisionSpec }>(`/v1/decisions/${id}/clarify`, { method: "POST", body: JSON.stringify({ answers }) }),
  simulate: (id: string) => req<{ simulation_id: string }>(`/v1/decisions/${id}/simulate`, { method: "POST" }),
  simulation: (id: string) => req<Simulation>(`/v1/simulations/${id}`),
  recent: () => req<{ id: string; title: string; status: string; mode: string; updated_at: string }[]>("/v1/simulations"),
  remove: (id: string) => req<void>(`/v1/simulations/${id}`, { method: "DELETE" }),
  versions: (id: string) => req<{ version: number; reason: string; created_at: string }[]>(`/v1/simulations/${id}/versions`),
  version: (id: string, v: number) => req<Simulation>(`/v1/simulations/${id}/versions/${v}`),
  messages: (id: string) => req<PersonaMessage[]>(`/v1/simulations/${id}/messages`),
  shock: (id: string, body: { label: string; description: string; month: number }) => req<{ job: string }>(`/v1/simulations/${id}/shock`, { method: "POST", body: JSON.stringify(body) }),
  assumptions: (id: string, branch: "A" | "B", edits: Record<string, number>) => req<Simulation>(`/v1/simulations/${id}/assumptions`, { method: "POST", body: JSON.stringify({ branch, edits }) }),
  postcard: (id: string, branch: "A" | "B") => req<{ id: string; url: string; mime: string; mode: string }>(`/v1/simulations/${id}/postcard`, { method: "POST", body: JSON.stringify({ branch }) }),
  assets: (id: string) => req<{ id: string; branch: "A" | "B"; kind: string; url: string }[]>(`/v1/simulations/${id}/assets`),
  calls: (id: string) => req<{ calls: ModelCall[]; by_model: Record<string, { calls: number; input_tokens: number; output_tokens: number; cached_tokens: number; latency_ms: number }> }>(`/v1/simulations/${id}/calls`),
  demoList: () => req<{ slug: string; title: string; blurb: string; mode: string }[]>("/v1/demo"),
  demoFork: (slug: string) => req<{ id: string }>(`/v1/demo/${slug}/fork`, { method: "POST" }),
  async voice(blob: Blob): Promise<{ transcript: string; mode: string }> {
    const fd = new FormData();
    fd.append("audio", blob, "intake.wav");
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/intake/voice`, { method: "POST", body: fd });
    } catch {
      throw new ApiError(0, "Can't reach the Elsewhere server.");
    }
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).detail ?? "Couldn't transcribe that recording.");
    return res.json();
  },
};

export interface ModelCall {
  agent: string;
  model: string;
  provider: string;
  effort: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  searched: boolean;
  ok: boolean;
  cost_usd: number;
  created_at: string;
}

export function assetUrl(url: string): string {
  return url.startsWith("data:") || url.startsWith("http") ? url : `${API_URL}${url}`;
}

/** Subscribe to a simulation's server-sent events. Returns an unsubscribe function. */
export function subscribe(id: string, onEvent: (type: string, data: Record<string, unknown>) => void, after = 0): () => void {
  const es = new EventSource(`${API_URL}/v1/simulations/${id}/events?after=${after}`);
  const types = [
    "simulation_started", "simulation_ready", "simulation_failed", "agent_started", "agent_done",
    "shock_started", "shock_ready", "shock_failed",
  ];
  for (const t of types) es.addEventListener(t, (e) => onEvent(t, JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}

/** POST that answers with a server-sent event stream (used by chat). */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.detail ?? err.error ?? "Request failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let type = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) {
        try {
          onEvent(type, JSON.parse(data.join("\n")));
        } catch {}
      }
    }
  }
}

export type ChatBody = { branch: "A" | "B" | "both"; question: string; timepoint: Timepoint };
