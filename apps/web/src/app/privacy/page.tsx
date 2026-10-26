import Link from "next/link";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-16 text-[16px] leading-relaxed text-paper-2">
      <Link href="/" className="text-path-a">← Elsewhere</Link>
      <h1 className="font-display text-[40px] text-paper">Privacy</h1>
      <p>Your decision text is sent to Meta Model API to build your simulation. Meta model API keys stay on our server and are never sent to your browser.</p>
      <p>We store your simulation so you can come back to it. We don’t log the content of your decisions in server logs. You can delete a simulation at any time from its page or via the API.</p>
      <p>We never use Meta’s “Contributor” models for your decisions, so your content isn’t used to train Meta models through Elsewhere.</p>
      <p>Elsewhere is a scenario explorer. It does not predict your future and isn’t financial, legal, medical or immigration advice.</p>
    </main>
  );
}
