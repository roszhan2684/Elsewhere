import Link from "next/link";
import { ForkLine } from "./ForkLine";

export function LoadingShell({ message }: { message?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <ForkLine className="h-[160px] w-[140px] opacity-70" labels={false} />
      <p className="text-[15px] text-soft">{message ?? "Opening both worlds…"}</p>
      {message && <Link href="/demo" className="text-path-a underline underline-offset-4">Back to the demos</Link>}
    </main>
  );
}
