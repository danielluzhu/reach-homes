/**
 * Geocodes the addresses in address.txt into data/geo.json.
 *
 * Results are cached — reruns only fetch addresses that aren't already
 * cached, so this is cheap to rerun after editing address.txt.
 *
 *   bun scripts/geocode.ts          # fill in anything missing
 *   bun scripts/geocode.ts --force  # re-geocode everything
 *
 * Uses Nominatim, which asks for <=1 request/second and a real User-Agent.
 */

import { file } from "bun";
import { loadPortfolio } from "../lib/portfolio";

const ADDRESS_PATH = `${import.meta.dir}/../address.txt`;
const GEO_PATH = `${import.meta.dir}/../data/geo.json`;
const USER_AGENT = "ravenna-court-rentals-portfolio-map/1.0";

const force = process.argv.includes("--force");

type Geo = { lat: number; lng: number; matched: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocode(query: string): Promise<Geo | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" +
    encodeURIComponent(query);

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.warn(`  ! HTTP ${res.status} for "${query}"`);
    return null;
  }

  const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!results.length) return null;

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    matched: results[0].display_name,
  };
}

const cache: Record<string, Geo> = force || !(await file(GEO_PATH).exists())
  ? {}
  : await file(GEO_PATH).json();

const buildings = await loadPortfolio(ADDRESS_PATH);
let fetched = 0;
let failed = 0;

for (const b of buildings) {
  if (cache[b.id]) continue;

  const query = `${b.address}, ${b.city}, WA${b.zip ? " " + b.zip : ""}`;
  const geo = await geocode(query);

  if (geo) {
    cache[b.id] = geo;
    console.log(`  ✓ ${b.address.padEnd(24)} ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`);
    fetched++;
  } else {
    console.warn(`  ✗ no match: ${query}`);
    failed++;
  }

  await sleep(1100); // respect Nominatim's rate limit
}

await Bun.write(GEO_PATH, JSON.stringify(cache, null, 2));

console.log(
  `\nGeocoded ${fetched} new, ${failed} failed, ${Object.keys(cache).length}/${buildings.length} cached total.`,
);
if (failed) console.log("Add failures manually to data/geo.json as { lat, lng, matched }.");
