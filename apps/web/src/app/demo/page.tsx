import Link from "next/link";
import { DemoPicker } from "@/components/DemoPicker";
import { ForkMark } from "@/components/ForkMark";

export const metadata = { title: "Demo" };

export default function DemoIndex() {
  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-4 py-10 sm:px-8">
      <Link href="/" className="flex items-center gap-2.5 font-display text-[22px]"><ForkMark />Elsewhere</Link>
      <div className="flex max-w-3xl flex-col gap-3">
        <span className="label-mono">Demo · no sign-up</span>
        <h1 className="font-display text-[40px] leading-tight sm:text-[52px]">Pick a decision to explore.</h1>
        <p className="text-[16px] leading-relaxed text-soft">
          Each one opens instantly from a saved run. Asking your futures a question or applying a shock runs live on Meta’s models, on your own private copy.
        </p>
      </div>
      <DemoPicker />
      <Link href="/new" className="self-start rounded-full border border-line-2 px-5 py-3 text-[15px] hover:border-paper">Or start your own fork →</Link>
    </main>
  );
}
