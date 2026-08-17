/**
 * Regenerates data/portfolio-map.json from address.txt + data/geo.json.
 *
 * Those two inputs hold exact street addresses and coordinates for homes that
 * are mostly occupied, so they stay out of the repo (see .gitignore). This
 * script produces the public, anonymized payload that does get committed:
 * neighborhood counts plus pins rounded to ~110m, no addresses.
 *
 * Run it whenever address.txt changes, then commit data/portfolio-map.json.
 *
 *   bun scripts/gen-map.ts
 */

import { file, write } from "bun";
import { loadPortfolio, toMapPayload } from "../lib/portfolio";

const ROOT = `${import.meta.dir}/..`;
const ADDRESS_PATH = `${ROOT}/address.txt`;
const GEO_PATH = `${ROOT}/data/geo.json`;
const OUT_PATH = `${ROOT}/data/portfolio-map.json`;

for (const [label, path] of [["address.txt", ADDRESS_PATH], ["data/geo.json", GEO_PATH]]) {
  if (!(await file(path).exists())) {
    console.error(`Missing ${label}. This script only runs where the private source data lives.`);
    process.exit(1);
  }
}

const [buildings, geo] = await Promise.all([
  loadPortfolio(ADDRESS_PATH),
  file(GEO_PATH).json(),
]);

const payload = toMapPayload(buildings, geo);

// Guard against a future change to toMapPayload leaking address data into the
// committed file: the payload must carry nothing but stats, areas and pins.
const ALLOWED_PIN_KEYS = ["lat", "lng", "neighborhood", "units"];
for (const pin of payload.pins) {
  const extra = Object.keys(pin).filter((k) => !ALLOWED_PIN_KEYS.includes(k));
  if (extra.length) {
    console.error(`Refusing to write: pin carries unexpected field(s) ${extra.join(", ")}`);
    process.exit(1);
  }
}

await write(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");

console.log(
  `Wrote data/portfolio-map.json — ${payload.stats.properties} properties, ` +
    `${payload.stats.units} units, ${payload.pins.length} pins.`,
);
