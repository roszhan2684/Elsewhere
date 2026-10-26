// The browser finance engine must match the Python engine exactly (packages/evals/finance_golden.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { savingsAt } from "../src/lib/finance.ts";

const golden = JSON.parse(readFileSync(new URL("../../../packages/evals/finance_golden.json", import.meta.url), "utf8"));
const MONTHS: Record<string, number> = { m0: 0, m6: 6, m24: 24, m60: 60 };

for (const c of golden) {
  test(`finance parity: ${c.name}`, () => {
    for (const [tp, exp] of Object.entries(c.expect) as [string, { savings_low: number; savings_high: number }][]) {
      assert.ok(Math.abs(savingsAt(c.inputs, MONTHS[tp], true) - exp.savings_low) < 1, `${tp} low`);
      assert.ok(Math.abs(savingsAt(c.inputs, MONTHS[tp], false) - exp.savings_high) < 1, `${tp} high`);
    }
  });
}
