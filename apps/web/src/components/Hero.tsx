"use client";

import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ForkLine } from "./ForkLine";

/** One line enters, splits into two branches as you scroll, and each branch becomes a future self. */
export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const splitMv = useTransform(scrollYProgress, [0, 0.35], [0.08, 1]);
  const cardsOpacity = useTransform(scrollYProgress, [0.18, 0.4], [0, 1]);
  const cardsY = useTransform(scrollYProgress, [0.18, 0.4], [24, 0]);
  const [split, setSplit] = useState(0.08);
  useMotionValueEvent(splitMv, "change", (v) => setSplit(v));

  return (
    <div ref={ref} className="relative h-[190vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center gap-8 overflow-hidden px-4">
        <div className="flex max-w-4xl flex-col items-center gap-6 text-center">
          <span className="label-mono">What decision is keeping you up at night?</span>
          <h1 className="font-display text-[44px] leading-[0.98] tracking-[-0.025em] sm:text-[72px] lg:text-[96px]">
            See the life you <span className="italic">didn’t</span> choose.
          </h1>
          <p className="max-w-[620px] text-[17px] leading-relaxed text-soft sm:text-[18px]">
            Describe one decision. Elsewhere builds two simulated futures, lets you talk to both versions of yourself, and shows which claims are facts, which are your assumptions, and which are the model’s guesses.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link href="/demo/startup-sf-vs-seattle" className="rounded-full bg-paper px-6 py-3.5 text-[15px] font-medium text-ink">
              Try the demo — no sign-up
            </Link>
            <Link href="/new" className="rounded-full border border-line-2 px-6 py-3.5 text-[15px] hover:border-paper">
              Start your own fork
            </Link>
          </div>
        </div>
        <div className="relative flex w-full max-w-4xl items-end justify-center">
          <ForkLine className="h-[200px] w-[170px] sm:h-[240px] sm:w-[200px]" split={split} instant labels={false} />
          <motion.div style={{ opacity: cardsOpacity, y: cardsY }} className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-between md:flex">
            <FutureCard branch="A" place="San Francisco" quote="I’ve shipped more in two years than I expected to in five. I also check our runway every Friday." />
            <FutureCard branch="B" place="Seattle" quote="My savings are on plan and my weekends are mine. Some weeks I wonder what I would have learned." />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function FutureCard({ branch, place, quote }: { branch: "A" | "B"; place: string; quote: string }) {
  return (
    <div className="flex w-[300px] flex-col gap-3 rounded-2xl border border-line bg-raised/90 p-5 text-left backdrop-blur lg:w-[340px]">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-6 w-6 place-items-center rounded-full font-mono text-[12px] font-semibold text-ink ${branch === "A" ? "bg-path-a" : "bg-path-b"}`}>{branch}</span>
        <span className="text-[14px] font-medium">Future {branch} · {place}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">YEAR 2</span>
      </div>
      <p className="font-display text-[19px] leading-snug">“{quote}”</p>
    </div>
  );
}
