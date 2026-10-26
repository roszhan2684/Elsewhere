import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ForkMark } from "@/components/ForkMark";
import { Chip } from "@/components/Chip";

const STEPS = [
  ["Decide", "Type or say the choice you’re stuck on. Elsewhere asks at most three questions."],
  ["Simulate", "Muse Wonder plans two worlds and hands the work to Muse Spark specialists, in parallel."],
  ["Meet your futures", "Talk to both future selves. Each one only remembers what happened in its own world."],
  ["Stress-test", "Inject a shock — a layoff, a failed startup, a scholarship — and watch both worlds recompute."],
];

const MODELS = [
  ["Muse Wonder", "muse-wonder-1.0", "Plans both worlds, delegates to specialists with function tools, reconciles them, plans shocks."],
  ["Muse Spark", "muse-spark-1.3", "Career, finance, lifestyle, risk and values agents; consistency checks; the future selves."],
  ["Web grounding", "web_search", "Looks up current public facts like rent and taxes, with citations, so FACT means something."],
  ["Muse Voice", "muse-voice-transcribe-1.0", "Say your dilemma out loud instead of filling in a form."],
  ["Muse Image", "muse-image-1.0", "A postcard from each life, painted from that world’s state."],
];

export default function Home() {
  return (
    <div className="flex flex-col">
      <nav aria-label="Main" className="fixed inset-x-0 top-0 z-30 border-b border-transparent bg-ink/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 font-display text-[22px]"><ForkMark />Elsewhere</Link>
          <div className="flex items-center gap-5 text-[14px] sm:gap-7">
            <a href="#how" className="hidden text-soft hover:text-paper sm:inline">How it works</a>
            <a href="#models" className="hidden text-soft hover:text-paper sm:inline">Model stack</a>
            <Link href="/demo" className="rounded-full border border-line-2 px-4 py-2.5 hover:border-paper">Try the demo</Link>
          </div>
        </div>
      </nav>

      <Hero />

      <section id="how" className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-4 py-24 sm:px-8">
        <h2 className="max-w-2xl font-display text-[36px] leading-tight sm:text-[48px]">Worlds, not advice. Evidence, not certainty.</h2>
        <ol className="grid gap-5 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-6">
              <span className="font-mono text-[12px] text-muted">0{i + 1}</span>
              <span className="text-[18px] font-medium">{t}</span>
              <span className="text-[15px] leading-relaxed text-soft">{d}</span>
            </li>
          ))}
        </ol>
        <div className="grid gap-5 md:grid-cols-3">
          {([
            ["FACT", "Looked up with web search, with a citation you can open."],
            ["ASSUMPTION", "Something you said or chose. Change it and both worlds recompute."],
            ["INFERENCE", "Reasoned by the models or calculated by Elsewhere. Always labeled."],
          ] as const).map(([k, d]) => (
            <div key={k} className="flex flex-col items-start gap-3 rounded-2xl border border-line p-6">
              <Chip kind={k} />
              <p className="text-[15px] leading-relaxed text-soft">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="models" className="border-y border-line bg-ink-2">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-4 py-20 sm:px-8">
          <div className="flex flex-col gap-3">
            <span className="label-mono">Built on Meta’s models</span>
            <h2 className="max-w-3xl font-display text-[32px] leading-tight sm:text-[40px]">Each model does one job you can see.</h2>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {MODELS.map(([n, id, d]) => (
              <li key={n} className="flex flex-col gap-2 rounded-2xl border border-line bg-raised p-5">
                <span className="font-medium">{n}</span>
                <span className="font-mono text-[11px] text-muted">{id}</span>
                <span className="text-[14px] leading-relaxed text-soft">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1240px] flex-col items-center gap-6 px-4 py-24 text-center sm:px-8">
        <h2 className="font-display text-[40px] leading-tight sm:text-[56px]">Don’t predict the future. <span className="italic">Explore it.</span></h2>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/demo" className="rounded-full bg-paper px-6 py-3.5 text-[15px] font-medium text-ink">Try a demo</Link>
          <Link href="/new" className="rounded-full border border-line-2 px-6 py-3.5 text-[15px] hover:border-paper">Build your own fork</Link>
        </div>
        <p className="max-w-xl text-[14px] leading-relaxed text-muted">
          Elsewhere is a scenario explorer. It doesn’t predict your future, and it isn’t financial, legal, medical or immigration advice.
        </p>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted sm:px-8">
          <span className="flex items-center gap-2"><ForkMark size={16} /> Elsewhere — built during the Meta Global AI Developer Hackathon 2026</span>
          <span className="flex gap-5">
            <a href="https://github.com/" className="hover:text-paper">GitHub</a>
            <Link href="/privacy" className="hover:text-paper">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
