import { ImageResponse } from "next/og";

// The card X, WhatsApp, Threads and Facebook show when a share link is posted.
export const alt = "Two simulated futures from one decision. Which life would you pick?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

interface Card {
  question: string;
  a: { label: string; headline: string };
  b: { label: string; headline: string };
}

async function load(id: string): Promise<Card | null> {
  try {
    const r = await fetch(`${API}/v1/shares/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const d = await r.json();
    const side = (b: "A" | "B") => ({
      label: d.branches[b].label as string,
      headline: (d.branches[b].snapshots.find((s: { timepoint: string }) => s.timepoint === "m24")?.headline as string) || d.branches[b].summary,
    });
    return { question: d.question || d.title, a: side("A"), b: side("B") };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await load(id);
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0d0e12", color: "#ece8df", padding: 56, fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#9a9aa3", fontFamily: "monospace" }}>
          <span>ELSEWHERE · TWO FUTURES</span>
          <span>WHICH LIFE WOULD YOU PICK?</span>
        </div>
        <div style={{ display: "flex", fontSize: 50, lineHeight: 1.12, marginTop: 28 }}>{cut(card?.question ?? "One decision. Two simulated futures.", 90)}</div>
        <div style={{ display: "flex", gap: 28, marginTop: "auto" }}>
          {(["A", "B"] as const).map((b) => {
            const side = card ? (b === "A" ? card.a : card.b) : { label: `Path ${b}`, headline: "Open the link to see this life" };
            return (
              <div key={b} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, background: "#f3eee3", color: "#16161a", borderRadius: 10, padding: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, fontFamily: "monospace", color: "#4a4a52" }}>
                  <span style={{ display: "flex", width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", color: "white", background: b === "A" ? "#2f6fcc" : "#b8641e" }}>{b}</span>
                  {cut(side.label.toUpperCase(), 30)}
                </div>
                <div style={{ display: "flex", fontSize: 34, lineHeight: 1.15, fontWeight: 700 }}>{cut(side.headline, 70)}</div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    size,
  );
}
