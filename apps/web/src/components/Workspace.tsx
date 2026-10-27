"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Branch, DemoBundle, PersonaMessage, ShockRecord, Simulation, ThirdDoor, Timepoint } from "@/lib/types";
import { TIMEPOINTS, TP_LABEL } from "@/lib/types";
import { BranchColumn } from "./BranchColumn";
import { CheckinPanel } from "./CheckinPanel";
import { DoorsPanel } from "./DoorsPanel";
import { FriendsPanel } from "./FriendsPanel";
import { FuturesPanel } from "./FuturesPanel";
import { DoorIcon, ThirdDoorPanel } from "./ThirdDoorPanel";
import { ValuesPanel } from "./ValuesPanel";
import { ChatPanel } from "./ChatPanel";
import { DecidesPanel } from "./DecidesPanel";
import { EvidencePanel } from "./EvidencePanel";
import { BriefPanel, HoodPanel, PostcardsPanel } from "./ExtrasPanels";
import { ForkLine } from "./ForkLine";
import { ForkMark } from "./ForkMark";
import { ModeBadge } from "./ModeBadge";
import { ShockPanel } from "./ShockPanel";

type Tab = "futures" | "shock" | "many" | "decides" | "doors" | "values" | "third" | "friends" | "checkin" | "postcards" | "brief" | "hood";
const TABS: { id: Tab; label: string }[] = [
  { id: "futures", label: "Talk to your futures" },
  { id: "shock", label: "Stress test" },
  { id: "many", label: "1,000 futures" },
  { id: "decides", label: "What decides it" },
  { id: "doors", label: "Switch back?" },
  { id: "values", label: "Values" },
  { id: "third", label: "Third door" },
  { id: "friends", label: "Ask friends" },
  { id: "checkin", label: "Check in" },
  { id: "postcards", label: "Postcards" },
  { id: "brief", label: "Brief" },
  { id: "hood", label: "Under the hood" },
];

export function Workspace({
  initial,
  liveId: initialLiveId,
  demo,
  messages,
}: {
  initial: Simulation;
  liveId: string | null;
  demo?: DemoBundle;
  messages: PersonaMessage[];
}) {
  const [sim, setSim] = useState(initial);
  const [liveId, setLiveId] = useState(initialLiveId);
  const [tp, setTp] = useState<Timepoint>("m24");
  const [tab, setTab] = useState<Tab>("futures");
  const [selected, setSelected] = useState<string | null>(null);
  const [pulse, setPulse] = useState<Record<Branch, number>>({ A: 0, B: 0 });
  const [banner, setBanner] = useState<string | null>(null);
  const forking = useRef<Promise<string> | null>(null);

  const ensureLive = useCallback(async () => {
    if (liveId) return liveId;
    if (!demo) throw new Error("No simulation id");
    forking.current ??= api.demoFork(demo.slug).then(({ id }) => {
      setLiveId(id);
      setBanner("You’re now working on a private copy of this demo. The saved demo stays as it was.");
      return id;
    }).catch((e) => {
      forking.current = null;
      throw e;
    });
    return forking.current;
  }, [liveId, demo]);

  const evidence = useMemo(() => new Map(sim.evidence.map((e) => [e.id, e])), [sim.evidence]);
  const lastShock = sim.shocks.at(-1);
  const changes = lastShock?.changes ?? [];

  function onShock(next: Simulation, rec: ShockRecord, note?: string) {
    setSim(next);
    setPulse((p) => ({ A: rec.applies_to.includes("A") ? p.A + 1 : p.A, B: rec.applies_to.includes("B") ? p.B + 1 : p.B }));
    if (rec.month <= 24) setTp("m24");
    if (note) setBanner(note);
  }

  function select(ref: string | null) {
    setSelected(ref);
    if (ref && typeof window !== "undefined" && window.innerWidth < 1024) {
      document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const dimA = !!lastShock && lastShock.applies_to.includes("A") && !lastShock.applies_to.includes("B");
  const dimB = !!lastShock && lastShock.applies_to.includes("B") && !lastShock.applies_to.includes("A");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2 font-display text-[20px]" aria-label="Elsewhere home">
            <ForkMark size={20} />
            <span className="hidden sm:inline">Elsewhere</span>
          </Link>
          <span className="text-line-2" aria-hidden="true">/</span>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium">{sim.decision.title}</h1>
          <span className="hidden font-mono text-[11px] text-muted md:inline">v{sim.version}{lastShock ? ` · after “${lastShock.label}”` : ""}</span>
          <ModeBadge mode={sim.mode} />
          {demo && !liveId && <span className="hidden rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-soft sm:inline">Saved demo</span>}
        </div>
      </header>

      {sim.derived_from && (
        <div className="mx-auto mt-4 w-full max-w-[1400px] px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-path-c/50 bg-raised px-4 py-3 text-[14px]">
            <span className="flex items-center gap-2"><DoorIcon size={16} />This fork tests a third door Muse Wonder proposed.</span>
            <Link href={`/sim/${sim.derived_from}`} className="text-path-c hover:underline">← Back to the original decision</Link>
          </div>
        </div>
      )}

      {banner && (
        <div className="mx-auto mt-4 w-full max-w-[1400px] px-4 sm:px-8">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-paper-2">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner(null)} className="text-muted hover:text-paper" aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 pb-24 pt-6 sm:px-8">
        <section className="grid items-center gap-6 rounded-2xl border border-line bg-ink-2 p-5 md:grid-cols-[1fr_140px_1fr] md:p-6">
          <div className="flex flex-col gap-1.5 md:text-right">
            <span className="font-mono text-[11px] text-path-a">PATH A</span>
            <span className="font-display text-[22px] leading-tight">{sim.branches.A.label}</span>
            <span className="text-[13px] leading-snug text-muted">{sim.branches.A.top_tradeoffs[0]}</span>
          </div>
          <ForkLine className="mx-auto hidden h-[150px] w-[130px] md:block" shockA={pulse.A} shockB={pulse.B} dimA={dimA} dimB={dimB} labels={false}
            title={`Decision fork: Path A ${sim.branches.A.label}, Path B ${sim.branches.B.label}`} />
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] text-path-b">PATH B</span>
            <span className="font-display text-[22px] leading-tight">{sim.branches.B.label}</span>
            <span className="text-[13px] leading-snug text-muted">{sim.branches.B.top_tradeoffs[0]}</span>
          </div>
          {!sim.derived_from && (
            <div className="flex justify-center md:col-span-3">
              <button type="button" onClick={() => { setTab("third"); document.getElementById("explore")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                className="flex min-h-10 items-center gap-2 rounded-full border border-dashed border-path-c/60 px-4 text-[13px] text-paper-2 hover:border-path-c">
                <DoorIcon size={15} />{sim.third_door ? <>Third door: <b className="font-medium text-path-c">{sim.third_door.label}</b></> : "Is this really either/or? Ask Wonder for a third door"}
              </button>
            </div>
          )}
          <div className="md:col-span-3">
            <div role="tablist" aria-label="Time horizon" className="mx-auto grid max-w-xl grid-cols-4 gap-1 rounded-xl bg-raised p-1">
              {TIMEPOINTS.map((t) => (
                <button key={t} role="tab" aria-selected={tp === t} type="button" onClick={() => setTp(t)}
                  className={clsx("min-h-10 rounded-lg text-[14px] transition", tp === t ? "bg-paper font-medium text-ink" : "text-soft hover:text-paper")}>
                  {TP_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {(["A", "B"] as Branch[]).map((b) => (
            <BranchColumn key={b} bw={sim.branches[b]} tp={tp} evidence={evidence} events={sim.events} changes={changes} selected={selected} onSelect={select} />
          ))}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section id="explore" className="flex min-w-0 scroll-mt-20 flex-col gap-6 rounded-2xl border border-line p-5 sm:p-6">
            <div role="tablist" aria-label="Explore" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                  className={clsx("min-h-10 shrink-0 rounded-full px-4 text-[14px]", tab === t.id ? "bg-paper font-medium text-ink" : "text-soft hover:bg-raised hover:text-paper")}>
                  {t.id === "shock" && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-shock align-middle" aria-hidden="true" />}
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === "futures" && <ChatPanel sim={sim} tp={tp} messages={messages} ensureLive={ensureLive} selected={selected} onSelect={select} />}
              {tab === "shock" && <ShockPanel sim={sim} ensureLive={ensureLive} onApplied={onShock} fallback={demo?.precomputed_shock} onSelect={select} />}
              {tab === "many" && <FuturesPanel sim={sim} />}
              {tab === "decides" && <DecidesPanel key={sim.version} sim={sim} ensureLive={ensureLive} onUpdated={setSim} />}
              {tab === "doors" && <DoorsPanel key={sim.version} sim={sim} />}
              {tab === "values" && <ValuesPanel key={sim.version} sim={sim} tp={tp} />}
              {tab === "third" && <ThirdDoorPanel sim={sim} ensureLive={ensureLive} onFound={(d: ThirdDoor) => setSim((x) => ({ ...x, third_door: d }))} />}
              {tab === "friends" && <FriendsPanel sim={sim} liveId={liveId} ensureLive={ensureLive} />}
              {tab === "checkin" && <CheckinPanel sim={sim} liveId={liveId} ensureLive={ensureLive} demoSlug={demo?.slug} />}
              {tab === "postcards" && <PostcardsPanel sim={sim} ensureLive={ensureLive} initial={demo?.postcards} liveId={liveId} />}
              {tab === "brief" && <BriefPanel sim={sim} />}
              {tab === "hood" && <HoodPanel sim={sim} liveId={liveId} />}
            </div>
          </section>
          <div id="evidence" className="lg:sticky lg:top-20">
            <EvidencePanel sim={sim} selected={selected} onSelect={select} />
          </div>
        </div>

        <p className="text-center text-[13px] text-muted">
          Elsewhere explores scenarios — it doesn’t predict your future or give financial, legal or medical advice.
        </p>
      </main>
    </div>
  );
}
