/**
 * Downloads a photo for a listing from a direct image URL.
 *
 *   bun scripts/add-photo.ts <listing-id> <image-url>
 *   bun scripts/add-photo.ts --from photos.txt
 *
 * The --from file takes one "<listing-id> <image-url>" pair per line; blank
 * lines and #-comments are ignored.
 *
 * Intended workflow for Zillow photos: open your own listing in a browser,
 * right-click the photo you want, "Copy image address" (a photos.zillowstatic.com
 * URL), and paste it here. Zillow's listing *pages* sit behind a bot challenge
 * that returns 403 to scripts, but an image URL you already have loads fine.
 */

import { file } from "bun";

const LISTINGS_PATH = `${import.meta.dir}/../data/listings.json`;
const PHOTO_DIR = `${import.meta.dir}/../public/images/photos`;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const listings: Array<{ id: string; title: string }> = await file(LISTINGS_PATH).json();
const validIds = new Set(listings.map((l) => l.id));

function usage(msg?: string): never {
  if (msg) console.error(`\n${msg}\n`);
  console.error("Usage:");
  console.error("  bun scripts/add-photo.ts <listing-id> <image-url>");
  console.error("  bun scripts/add-photo.ts --from photos.txt\n");
  console.error("Listing IDs:");
  for (const l of listings) console.error(`  ${l.id.padEnd(22)} ${l.title}`);
  process.exit(1);
}

async function download(id: string, url: string): Promise<boolean> {
  if (!validIds.has(id)) {
    console.error(`  ✗ ${id} — not a known listing id`);
    return false;
  }

  let res: Response;
  try {
    // Some image CDNs (Wikimedia among them) reject requests with no User-Agent.
    res = await fetch(url, {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "reach-homes-site/1.0 (listing photo import)",
      },
    });
  } catch (err) {
    console.error(`  ✗ ${id} — fetch failed: ${(err as Error).message}`);
    return false;
  }

  if (!res.ok) {
    console.error(`  ✗ ${id} — HTTP ${res.status}`);
    return false;
  }

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) {
    console.error(`  ✗ ${id} — not an image (content-type: ${type || "unknown"})`);
    return false;
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 5_000) {
    console.error(`  ✗ ${id} — suspiciously small (${bytes.byteLength}B), probably not a real photo`);
    return false;
  }

  // Drop other extensions for this id so the server resolves exactly one photo.
  for (const other of Object.values(EXT_BY_TYPE)) {
    if (other !== ext) {
      const stale = file(`${PHOTO_DIR}/${id}.${other}`);
      if (await stale.exists()) await stale.delete();
    }
  }

  await Bun.write(`${PHOTO_DIR}/${id}.${ext}`, bytes);
  console.log(`  ✓ ${id} — saved ${id}.${ext} (${Math.round(bytes.byteLength / 1024)}KB)`);
  return true;
}

const args = process.argv.slice(2);
if (!args.length) usage();

let ok = 0;
let fail = 0;

if (args[0] === "--from") {
  const listPath = args[1];
  if (!listPath) usage("--from needs a file path.");

  const text = await file(listPath).text();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const [id, ...rest] = line.split(/\s+/);
    const url = rest.join(" ");
    if (!url) {
      console.error(`  ✗ ${id} — no URL on that line`);
      fail++;
      continue;
    }
    (await download(id, url)) ? ok++ : fail++;
  }
} else {
  const [id, url] = args;
  if (!id || !url) usage("Need both a listing id and an image URL.");
  (await download(id, url)) ? ok++ : fail++;
}

console.log(`\nSaved ${ok}, failed ${fail}.`);
if (ok) console.log("Reload the site — the server picks up new photos automatically.");
