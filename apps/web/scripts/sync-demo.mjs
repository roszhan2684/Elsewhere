// Copies the seeded demo scenarios (repo /demo) into public/ so /demo paints from the CDN
// in under 2 seconds, even if the API is cold.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "demo");
const out = join(here, "..", "public", "demo");
mkdirSync(out, { recursive: true });
if (!existsSync(src)) {
  console.warn("sync-demo: no /demo folder found, skipping");
  process.exit(0);
}
const index = [];
for (const f of readdirSync(src).filter((f) => f.endsWith(".json")).sort()) {
  const raw = readFileSync(join(src, f), "utf8");
  const d = JSON.parse(raw);
  writeFileSync(join(out, f), raw);
  index.push({ slug: d.slug, title: d.simulation.decision.title, blurb: d.blurb, mode: d.simulation.mode });
}
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1));
console.log(`sync-demo: ${index.length} scenarios`);
