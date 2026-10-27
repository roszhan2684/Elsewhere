"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Simulation, Tally } from "@/lib/types";
import { valuesPick } from "@/lib/values";
import { Votes } from "./SharePage";

/** Idea: send both futures to friends, let them vote, then reveal what your own values say. */
export function FriendsPanel({ sim, liveId, ensureLive }: { sim: Simulation; liveId: string | null; ensureLive: () => Promise<string> }) {
  const [shareId, setShareId] = useState<string | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!liveId) return;
    let alive = true;
    const load = () => api.shareStatus(liveId).then((s) => {
      if (!alive || !s.share_id) return;
      setShareId(s.share_id);
      setTally(s as Tally & { share_id: string });
    }).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [liveId]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const id = await ensureLive();
      const s = await api.share(id);
      setShareId(s.share_id);
      setTally(s);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t make a link.");
    } finally {
      setBusy(false);
    }
  }

  const url = shareId && typeof window !== "undefined" ? `${window.location.origin}/f/${shareId}` : "";
  const text = `I simulated two futures for one decision: ${sim.branches.A.label} or ${sim.branches.B.label}. Which life would you pick for me?`;
  const enc = encodeURIComponent;
  const targets = [
    { name: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
    { name: "Threads", href: `https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}` },
    { name: "X", href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}` },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
  ];
  const pick = valuesPick(sim, sim.decision.priorities);
  const friendsLean = tally && tally.total ? (tally.A === tally.B ? "tie" : tally.A > tally.B ? "A" : "B") : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-2">
        <span className="label-mono">Fork with friends</span>
        <h3 className="font-display text-[28px] leading-tight sm:text-[34px]">Ask the people who know you which life fits.</h3>
        <p className="text-[15px] leading-relaxed text-soft">
          Friends get a link with both futures as front pages and vote on one. Then Elsewhere shows how their vote compares with what your own priorities say. They see the worlds only, not your chats, your evidence, or the savings and spending you entered.
        </p>
      </div>

      {!shareId ? (
        <button type="button" onClick={create} disabled={busy} className="min-h-12 self-start rounded-full bg-paper px-6 text-[15px] font-medium text-ink disabled:opacity-50">
          {busy ? "Making a link…" : "Make a link for friends"}
        </button>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5">
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={url} aria-label="Share link" className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-ink-2 px-3 font-mono text-[13px] text-paper-2" onFocus={(e) => e.target.select()} />
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
              className="min-h-11 rounded-full bg-paper px-5 text-[14px] font-medium text-ink">{copied ? "Copied" : "Copy"}</button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button type="button" onClick={() => navigator.share({ title: "Which life would you pick?", text, url }).catch(() => {})}
                className="min-h-11 rounded-full border border-line-2 px-5 text-[14px]">Share…</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <a key={t.name} href={t.href} target="_blank" rel="noreferrer" className="min-h-10 rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-paper">{t.name}</a>
            ))}
          </div>
          <p className="text-[12px] text-muted">On a phone, “Share…” also reaches Instagram and any other app. The link shows a preview card with both futures.</p>
        </div>
      )}

      {tally && (
        <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl bg-ink-2 p-5">{tally.total ? <Votes tally={tally} /> : <p className="text-[14px] text-muted">No votes yet. This updates by itself.</p>}</div>
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-5">
            <span className="label-mono">Friends vs your values</span>
            <p className="text-[15px] leading-relaxed">
              Your own priorities point to {pick.pick === "tie" ? "neither path clearly" : <b className={pick.pick === "A" ? "text-path-a" : "text-path-b"}>Path {pick.pick}</b>}.{" "}
              {friendsLean === null ? "Waiting on your friends." : friendsLean === "tie" ? "Your friends are split." :
                friendsLean === pick.pick ? `Your friends agree: most picked Path ${friendsLean}.` : `Most friends picked Path ${friendsLean}. Worth asking them what they see that your priorities don’t.`}
            </p>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-[14px] text-shock">{err}</p>}
    </div>
  );
}
