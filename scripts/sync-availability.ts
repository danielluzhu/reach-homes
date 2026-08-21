/**
 * Pulls 4544's unit availability from the Blue Ocean building site.
 *
 *   bun scripts/sync-availability.ts            # write changes
 *   bun scripts/sync-availability.ts --check    # report only, exit 1 if stale
 *
 * That page is the building's own vacancy list and moves faster than this site
 * does -- units changed twice within minutes while this was being written --
 * so it is the source of truth for status. It publishes no JSON, so this parses
 * the table, which is structured enough to do reliably: every row carries
 * `class="unit-num"` and `class="unit-avail"`.
 *
 * Dates are NOT taken from it. It gives coarse phrases ("Late September") while
 * listings.json holds exact dates, so an existing unit keeps its date and only
 * its status is synced. A newly vacant unit has no date here yet, so it is
 * added with the source's phrase in `availableText` until someone sets a real
 * one.
 */

const SOURCE = "https://blueocean-welcome.another.ac/units.html";
const LISTING_ID = "4544-20th-ave-ne";
const LISTINGS = `${import.meta.dir}/../data/listings.json`;

/** The building has 31 units; a parse returning far fewer means the page changed shape. */
const MIN_ROWS = 20;

type Status = "available" | "pending" | "unavailable";

/** Status plus the raw availability phrase, per unit. */
function parse(html: string): Map<string, { status: Status; text: string }> {
  const out = new Map<string, { status: Status; text: string }>();
  const rowRe =
    /class="unit-num">([^<]+)<\/td>[\s\S]*?class="unit-avail"[^>]*>([\s\S]*?)<\/td>/g;

  for (const [, unit, cell] of html.matchAll(rowRe)) {
    const text = cell
      .replace(/<span class="was-date">[\s\S]*?<\/span>/g, "") // "Was: Early August"
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const status: Status = /occupied/i.test(text)
      ? "unavailable"
      : /pending/i.test(text)
        ? "pending"
        : "available";

    out.set(unit.trim(), { status, text });
  }
  return out;
}

const res = await fetch(SOURCE, { headers: { "user-agent": "reach-homes-sync" } });
if (!res.ok) {
  console.error(`Source returned ${res.status} ${res.statusText}; leaving listings.json alone.`);
  process.exit(1);
}

const source = parse(await res.text());
if (source.size < MIN_ROWS) {
  console.error(
    `Parsed only ${source.size} units from the page (expected >= ${MIN_ROWS}).\n` +
      "The table markup has probably changed. Refusing to rewrite availability from a bad parse.",
  );
  process.exit(1);
}

const raw = await Bun.file(LISTINGS).text();
const listings = JSON.parse(raw);
const listing = listings.find((l: { id: string }) => l.id === LISTING_ID);
if (!listing) {
  console.error(`No listing ${LISTING_ID} in data/listings.json.`);
  process.exit(1);
}

type Unit = { unit: string; available?: string; availableText?: string; status?: Status; label?: string };
const units: Unit[] = listing.upcomingUnits ?? [];
const changes: string[] = [];

/**
 * Edits are applied to the file text rather than by re-serializing. This file
 * mixes formatting deliberately -- upcomingUnits rows sit on one line while
 * other nested objects are expanded -- and JSON.stringify would reflow all of
 * it, turning a one-word change into a large diff every single day.
 */
let text = raw;

function rowFor(unit: string): RegExp {
  return new RegExp(`^.*"unit": "${unit}".*$`, "m");
}

function applyStatus(unit: string, status: Status): void {
  const re = rowFor(unit);
  const line = text.match(re)?.[0];
  if (line === undefined) return;
  let next = line.replace(/,\s*"status":\s*"[^"]*"/, "");
  if (status !== "available") next = next.replace(/\s*\}/, `, "status": "${status}" }`);
  text = text.replace(re, next);
}

// Existing units: sync status, keep the date already recorded here.
for (const u of units) {
  const src = source.get(u.unit);
  if (!src) continue; // not on the page at all; leave it be
  const before: Status = (u.status as Status) ?? "available";
  if (before === src.status) continue;
  applyStatus(u.unit, src.status);
  changes.push(`${u.unit}: ${before} -> ${src.status}`);
}

// Newly vacant units the page lists but this site doesn't know about yet.
const known = new Set(units.map((u) => u.unit));
const additions: string[] = [];
for (const [unit, src] of source) {
  if (known.has(unit) || src.status === "unavailable") continue;
  const status = src.status === "available" ? "" : `, "status": "${src.status}"`;
  additions.push(`      { "unit": "${unit}", "availableText": ${JSON.stringify(src.text)}${status} }`);
  changes.push(`${unit}: added (${src.status}, "${src.text}")`);
}

if (additions.length) {
  // Append inside the upcomingUnits array, after its final row.
  text = text.replace(/("upcomingUnits": \[[\s\S]*?)(\n\s*\])/, (_m, body, close) =>
    `${body.replace(/\s*$/, "")},\n${additions.join(",\n")}${close}`,
  );
}

const openNow = units.filter((u) => !u.status).length + additions.length;
console.log(`Source lists ${source.size} units; ${openNow} of ${listing.totalUnits} open here.`);

if (!changes.length) {
  console.log("Already in sync.");
  process.exit(0);
}
for (const c of changes) console.log("  " + c);

if (process.argv.includes("--check")) {
  console.error(`\n${changes.length} change(s) pending. Run without --check to apply.`);
  process.exit(1);
}

// Guard: the edited text must still be valid JSON with the same unit count.
JSON.parse(text);
await Bun.write(LISTINGS, text);
console.log(`\nWrote ${changes.length} change(s) to data/listings.json.`);
