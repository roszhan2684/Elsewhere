// Breakeven finder: the value at which an assumption flips which path ends ahead.

export interface Tipping {
  value: number; // where the gap crosses zero
  direction: "above" | "below"; // the other path wins if the assumption goes above/below `value`
  withinRange: boolean; // inside the slider's range, or only in the wider search
}

/**
 * gap(v) = savings(A) - savings(B) for assumption value v. Searches [lo, hi] first, then a wider
 * band (0.25x to 3x of current) for a sign change, and bisects to the crossing point.
 */
export function findTipping(gap: (v: number) => number, current: number, lo: number, hi: number): Tipping | null {
  const now = gap(current);
  if (now === 0) return null;
  const wideLo = Math.min(lo, current * 0.25);
  const wideHi = Math.max(hi, current * 3);
  const candidates: [number, number, boolean][] = [
    [lo, current, true], [current, hi, true], [wideLo, current, false], [current, wideHi, false],
  ];
  let best: Tipping | null = null;
  for (const [a, b, inside] of candidates) {
    if (a === b) continue;
    const far = a === current ? b : a;
    if (Math.sign(gap(far)) === Math.sign(now)) continue;
    let x = a;
    let y = b;
    for (let i = 0; i < 50; i++) {
      const mid = (x + y) / 2;
      if (Math.sign(gap(mid)) === Math.sign(gap(x))) x = mid;
      else y = mid;
    }
    const t: Tipping = { value: (x + y) / 2, direction: far > current ? "above" : "below", withinRange: inside };
    if (!best || Math.abs(t.value - current) < Math.abs(best.value - current)) best = t;
    if (inside) break;
  }
  return best;
}
