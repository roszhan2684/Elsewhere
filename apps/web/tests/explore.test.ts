// 1,000 Futures, Door-Closing Meter, Breakeven finder and Values Compass run on real demo worlds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { findTipping } from "../src/lib/breakeven.ts";
import { defaultAssumptions, doorReport } from "../src/lib/doors.ts";
import { savingsMid } from "../src/lib/finance.ts";
import { rollLifeEvent, runFutures } from "../src/lib/futures.ts";
import { pathKind } from "../src/lib/kinds.ts";
import { tensions, valuesPick } from "../src/lib/values.ts";

const dir = new URL("../../../demo/", import.meta.url);
const demos = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));

for (const d of demos) {
  const sim = d.simulation;

  test(`futures are seeded and sane: ${d.slug}`, () => {
    const a = runFutures(sim, { seed: 7, n: 300, roughness: 1 });
    const b = runFutures(sim, { seed: 7, n: 300, roughness: 1 });
    assert.deepEqual(a.branches.A.p50, b.branches.A.p50, "same seed, same futures");
    for (const br of ["A", "B"] as const) {
      const s = a.branches[br];
      assert.equal(s.p50.length, 61);
      for (let m = 0; m <= 60; m++) assert.ok(s.p10[m] <= s.p50[m] && s.p50[m] <= s.p90[m], `bands ordered at ${m}`);
      assert.ok(s.debtPct >= 0 && s.debtPct <= 1);
    }
    assert.ok(a.aheadA >= 0 && a.aheadA <= 1);
  });

  test(`no shocks reproduces the finance engine: ${d.slug}`, () => {
    const r = runFutures(sim, { seed: 1, n: 200, roughness: 0 });
    for (const br of ["A", "B"] as const) {
      const mid = savingsMid(sim.branches[br].finance_inputs, 60);
      if (pathKind(br === "A" ? sim.decision.path_a : sim.decision.path_b) === "own") {
        // Own-business paths go back to a job before savings run out, so they can only do better than the plan.
        assert.ok(r.branches[br].p50[60] >= mid - 1);
        continue;
      }
      const err = Math.abs(r.branches[br].p50[60] - mid);
      // Housing and living costs are drawn inside the same range the engine uses, so the median lands near the midpoint.
      assert.ok(err < Math.max(3000, Math.abs(mid) * 0.08), `${br}: median ${r.branches[br].p50[60]} vs engine ${mid}`);
    }
  });

  test(`life roulette draws a usable shock: ${d.slug}`, () => {
    const r = rollLifeEvent(sim, 42);
    assert.ok(r.label.length >= 3 && r.label.length <= 120);
    assert.ok(r.month >= 1 && r.month <= 59);
  });

  test(`door meter: costs never shrink with time: ${d.slug}`, () => {
    for (const from of ["A", "B"] as const) {
      const rep = doorReport(sim, from, defaultAssumptions(sim));
      assert.equal(rep.months.length, 61);
      for (let m = 1; m <= 60; m++) assert.ok(rep.months[m].total >= rep.months[m - 1].total - 1e-6);
    }
  });

  test(`values compass gives a pick: ${d.slug}`, () => {
    const w = sim.decision.priorities;
    const v = valuesPick(sim, w);
    assert.ok(v.fitA > 0 && v.fitA <= 1 && v.fitB > 0 && v.fitB <= 1);
    assert.ok(Array.isArray(tensions(sim, w, "m24")));
  });
}

test("breakeven finds the crossing point", () => {
  const t = findTipping((v) => 100 - v, 40, 0, 80);
  assert.ok(t && Math.abs(t.value - 100) < 0.01 && t.direction === "above" && !t.withinRange);
  const u = findTipping((v) => v - 30, 50, 0, 100);
  assert.ok(u && Math.abs(u.value - 30) < 0.01 && u.direction === "below" && u.withinRange);
  assert.equal(findTipping(() => 5, 10, 0, 20), null);
});
