/**
 * Populates a default photo for each listing.
 *
 *   GOOGLE_MAPS_API_KEY=... bun scripts/fetch-photos.ts
 *   GOOGLE_MAPS_API_KEY=... bun scripts/fetch-photos.ts --force
 *
 * Pulls a street-level exterior of each listing address from the Google Street
 * View Static API and writes it to public/images/photos/<listing-id>.jpg, which
 * the server prefers over the generated placeholder.
 *
 * Why not Zillow: their listing pages are behind a PerimeterX bot challenge and
 * return HTTP 403 to automated requests, so the photos can't be fetched
 * programmatically. Export them from your Zillow account instead and drop the
 * files into public/images/photos/<listing-id>.jpg — same result, no API key.
 *
 * Street View returns a generic "no imagery" tile rather than a 404 when it has
 * no coverage, so this checks the metadata endpoint first (metadata is free)
 * and skips addresses with no imagery instead of saving a grey placeholder.
 */

import { file } from "bun";

const LISTINGS_PATH = `${import.meta.dir}/../data/listings.json`;
const PHOTO_DIR = `${import.meta.dir}/../public/images/photos`;

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const force = process.argv.includes("--force");

if (!API_KEY) {
  console.error(
    "No GOOGLE_MAPS_API_KEY set.\n\n" +
      "Either:\n" +
      "  1. Set GOOGLE_MAPS_API_KEY and rerun to auto-fetch Street View exteriors, or\n" +
      "  2. Drop your own photos at public/images/photos/<listing-id>.jpg\n\n" +
      "Listing IDs:",
  );
  const listings = await file(LISTINGS_PATH).json();
  for (const l of listings) console.error(`  ${l.id}`);
  process.exit(1);
}

type Listing = { id: string; address: string; title: string };
const listings: Listing[] = await file(LISTINGS_PATH).json();

async function hasImagery(address: string): Promise<boolean> {
  const url =
    "https://maps.googleapis.com/maps/api/streetview/metadata?size=640x400&location=" +
    encodeURIComponent(address) +
    `&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const meta = (await res.json()) as { status: string };
  return meta.status === "OK";
}

let saved = 0;
let skipped = 0;

for (const l of listings) {
  const dest = `${PHOTO_DIR}/${l.id}.jpg`;

  if (!force && (await file(dest).exists())) {
    console.log(`  · ${l.id} — already have a photo, skipping`);
    skipped++;
    continue;
  }

  if (!(await hasImagery(l.address))) {
    console.warn(`  ✗ ${l.id} — no Street View imagery for "${l.address}"`);
    skipped++;
    continue;
  }

  const url =
    "https://maps.googleapis.com/maps/api/streetview?size=800x500&fov=75&pitch=8&location=" +
    encodeURIComponent(l.address) +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ✗ ${l.id} — HTTP ${res.status}`);
    skipped++;
    continue;
  }

  await Bun.write(dest, await res.arrayBuffer());
  console.log(`  ✓ ${l.id} — saved ${dest.split("/").pop()}`);
  saved++;
}

console.log(`\nSaved ${saved}, skipped ${skipped}.`);
if (saved) console.log("Restart the server (or just reload) to see them.");
