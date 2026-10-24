/**
 * Rental payment history: the CSV exports the admin drops into data/payments/
 * each month, read as they are and never rewritten.
 *
 * Who may see a payment is decided here, by the server. The admin and the
 * team see every one. An owner sees a payment only when its property resolves
 * to exactly one owner on the registry and that owner is them -- a payment
 * that can't be pinned down (no property given, a building with several
 * owners, a unit whose owner is blank) stays with the admin and the team
 * rather than being guessed at.
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { file } from "bun";

export const PAYMENTS_DIR = `${import.meta.dir}/data/payments`;

export type Payment = {
  /** Where the tenant paid: "CoStar", "TurboTenant", or the export's own name. */
  platform: string;
  date: string; // YYYY-MM-DD, or "" when the export gave none we could read
  amount: number;
  payer: string;
  property: string; // as written in the export
  unit: string;
  memo: string;
  method: string;
  /** What the payment was for, where the export says: rent, a deposit, a late fee. */
  category: string;
  /** The building's confirmed street address from the owner list, or the export's own. */
  building: string;
  /** City, state and zip, the same way. */
  city: string;
  /** Every column of the export's row, as given: the whole of what was shared. */
  fields: Record<string, string>;
  /** "" once the money is in; otherwise what the export says, e.g. "In Progress". */
  status: string;
  /** The export's own id for the payment, when it has one. */
  ref: string;
  /** Which export it came from, and which row of it. */
  source: string;
  /** The lease it belongs to: the building and unit, e.g. "4544 20th Ave NE #104". */
  lease: string;
  /**
   * The month it counts towards. The month it was paid, except for last-month
   * rent paid in advance, which counts in the lease's final month: "" while
   * that month isn't known.
   */
  appliesTo: string;
  /** Why it counts where it does, when that isn't the month it was paid. */
  allocation: { kind: "last-month" | "combined"; basis: string } | null;
  /** Resolved against the registry: the owner's name and the row's address, or null. */
  owner: string | null;
  address: string | null;
};

type RegistryRow = { address: string; abbr: string; owner: string };
type Place = { street: string; city?: string; state?: string; zip?: string };
export type Registry = { rows: RegistryRow[]; places: Record<string, Place> };

/**
 * Header names seen in bank and payment-app exports, per field. First hit wins,
 * except for the date, where each row takes the first of these columns it has
 * filled in: CoStar leaves "Completed On" blank on a payment made offline.
 *
 * CoStar's export is a ledger rather than a list of payments: rent and bills
 * charged, credits, and payments, each a row with a Type, a Status and a
 * Credit or Debit amount. Only Type "Payment" is money received.
 *
 * TurboTenant's is the other way round: charges, each with the amount still
 * due, and no payment date or property column -- only the due date and a
 * "Lease Title" the admin typed, which names the property, unit and tenant.
 */
const COLUMNS: Record<string, string[]> = {
  date: ["date", "payment date", "paid on", "date paid", "completed on", "transaction date", "posted date", "posting date", "post date", "received", "initiated on", "due date"],
  amount: ["amount", "amount paid", "paid", "payment", "payment amount", "credit amt", "credit amount", "credit", "deposit", "deposits", "total"],
  payer: ["payer", "tenant", "tenant name", "resident", "name", "from", "sender", "paid by", "initiated by"],
  property: ["property", "property address", "address", "building", "abbr", "abbreviation", "property name"],
  unit: ["unit", "room", "unit number", "apt"],
  memo: ["memo", "description", "note", "notes", "reference", "details", "for"],
  method: ["method", "payment method", "channel"],
  kind: ["type", "transaction type"],
  status: ["status"],
  category: ["category"],
  due: ["amount due", "balance due"],
  lease: ["lease title", "lease", "lease name"],
  ref: ["referenceid", "reference id", "confirmation", "confirmation number"],
};

/** Money paid outside a platform and recorded in it by hand. */
const OFF_PLATFORM = /\b(venmo|zelle)\b/i;

/** Statuses under which no money arrived. Anything else not "completed" is shown, flagged. */
const NOT_PAID = /^(failed|canceled|cancelled|declined|returned|reversed|voided?)$/i;
const PAID = /^(completed?|paid|posted|settled|cleared|)$/i;

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/** "$1,234.50" -> 1234.5, "(12.00)" -> -12. NaN when it isn't a number. */
function parseAmount(s: string) {
  const t = s.trim();
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/^\$/, ""));
  const n = Number(t.replace(/[()$,\s-]/g, ""));
  return t && Number.isFinite(n) ? (negative ? -n : n) : NaN;
}

/** ISO, M/D/YYYY or M/D/YY. Kept as a string throughout, as the rest of the site does. */
function parseDate(s: string) {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const houseNumber = (s: string) => s.trim().match(/^\d+/)?.[0] ?? "";

/**
 * The one owner a property belongs to, or null. Tried in order: the registry's
 * abbreviation or address exactly; an address that one begins with the other
 * (so "2120 NE 54th St" finds "2120 ne 54th st seattle"); the house number.
 * Each step that finds rows decides: one named owner across all of them, or
 * nobody. A row with a blank owner says nothing either way and is passed
 * over: 2120's room rows have none, and the house's own row names Dan.
 */
export function resolveOwner(property: string, unit: string, allRows: RegistryRow[]) {
  const registry = allRows.filter((r) => r.owner.trim());
  const keys = [norm(property + unit), norm(property)].filter(Boolean);
  if (!keys.length) return null;
  const steps: Array<(r: RegistryRow) => boolean> = [
    (r) => keys.some((k) => (r.abbr && norm(r.abbr) === k) || norm(r.address) === k),
    // A unit named the way the owner list abbreviates it, at the same house
    // number: 121 12th Ave's units are listed as "303", "306" and so on, and
    // 4316's as "4316L" and "4316U" -- separate leases, matched separately.
    (r) => {
      const n = houseNumber(property);
      const u = norm(unit);
      return Boolean(n && u) && houseNumber(r.address) === n &&
        (norm(r.abbr) === u || norm(r.abbr) === n + u || norm(r.address) === n + u);
    },
    (r) => {
      const a = norm(r.address);
      return a.length >= 6 && keys.some((k) => k.length >= 6 && (a.startsWith(k) || k.startsWith(a)));
    },
    (r) => {
      const n = houseNumber(property);
      return Boolean(n) && (houseNumber(r.address) === n || houseNumber(r.abbr) === n);
    },
  ];
  for (const [i, step] of steps.entries()) {
    const hits = registry.filter(step);
    if (!hits.length) continue;
    const owners = new Set(hits.map((r) => r.owner.trim()));
    if (owners.size !== 1) return null;
    // The shortest address: the building rather than one of its units. Matched
    // on the house number alone, it would be any one of the units, so the
    // export's own wording is shown instead.
    const address = i === steps.length - 1 ? null : hits.map((r) => r.address).sort((a, b) => a.length - b.length)[0];
    return { owner: hits[0].owner.trim(), address };
  }
  return null;
}

/** A unit as a lease is known: "#306" for a numbered one, "L" or "M5 Room with Private Bath" as written. */
function unitLabel(unit: string) {
  const u = unit.trim().replace(/^#\s*/, "");
  return !u ? "" : /^\d/.test(u) ? "#" + u : u;
}

/** "Lease 27" and its kin: the admin's own term codes in a TurboTenant lease title. */
const TERM = /^2\d([A-Za-z][A-Za-z.]*\d*)?$/;

/**
 * A TurboTenant lease title, which comes in two shapes:
 *   "4544 104 27 Alex Smith"                -- house, unit, term, tenant
 *   "4544 20th Ave NE, 102 - September 2026" -- address, unit, start month
 * The unit and tenant are optional in both ("5641 27 Eva", "4735 4 27",
 * "1832 NE Ravenna Blvd - September 2026"). A title with no house number
 * ("003 27 Sam") comes back as written and matches no one.
 */
export function parseLeaseTitle(title: string) {
  const t = title.trim().replace(/\s+/g, " ");
  const dated = t.match(/^(.*?) - [A-Za-z]+ \d{4}$/);
  if (dated) {
    const [property, unit = ""] = dated[1].split(/,\s*/);
    return { property: property.trim(), unit: unit.trim(), payer: "" };
  }
  const [house, ...rest] = t.split(" ");
  if (rest.length >= 2 && TERM.test(rest[1]) && !TERM.test(rest[0])) {
    return { property: house, unit: rest[0], payer: rest.slice(2).join(" ") };
  }
  if (rest.length && TERM.test(rest[0])) return { property: house, unit: "", payer: rest.slice(1).join(" ") };
  if (rest.length === 1) return { property: house, unit: rest[0], payer: "" };
  return { property: house, unit: "", payer: rest.join(" ") };
}

/** Which platform an export came from, by its columns, else by its file name. */
function platformOf(name: string, heads: string[]) {
  if (heads.includes("lease title")) return "TurboTenant";
  if (heads.includes("initiated by") && heads.includes("credit amt")) return "CoStar";
  const base = name.replace(/\.csv$/i, "").split(/[-_ ]/)[0];
  return base ? base[0].toUpperCase() + base.slice(1) : "Other";
}

/** One export, as rows. Columns are found by header name; unknown ones are ignored. */
/**
 * Corrections to lease titles that don't say where they are, as the admin has
 * confirmed them: title as exported -> the title it should have been, e.g.
 * "003 27 Sam" -> "4544 003 27 Sam". Kept beside the exports, and private
 * like them, since titles name tenants; the exports themselves stay as given.
 */
const ALIASES_PATH = `${PAYMENTS_DIR}/lease-titles.json`;

async function loadAliases(): Promise<Record<string, string>> {
  const f = file(ALIASES_PATH);
  return (await f.exists()) ? await f.json() : {};
}

function readExport(name: string, text: string, registry: Registry, aliases: Record<string, string> = {}) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { payments: [] as Payment[], problem: "empty" };
  const heads = header.map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    const i = names.map((n) => heads.indexOf(n)).find((i) => i >= 0);
    if (i !== undefined) col[field] = i;
  }
  const dateCols = COLUMNS.date.map((n) => heads.indexOf(n)).filter((i) => i >= 0);
  if (col.amount === undefined) {
    return { payments: [], problem: `no amount column (headers: ${header.join(", ")})` };
  }
  const get = (r: string[], field: string) => (col[field] === undefined ? "" : (r[col[field]] ?? "").trim());
  const platform = platformOf(name, heads);
  const payments: Payment[] = [];
  rows.forEach((r, i) => {
    // A ledger's charges and credits are not payments; a failed one never
    // arrived. The exception is rent paid outside the platform, by Venmo or
    // Zelle, which CoStar records as a credit: that is money received. A
    // credit applying last month's rent prepaid long ago is not, even when
    // its memo says how it was paid ("Prepaid last month rent Venmo 23.05.08").
    const kind = get(r, "kind");
    const offPlatform = /^credit$/i.test(kind) && OFF_PLATFORM.test(get(r, "memo")) && !/prepa/i.test(get(r, "memo"));
    if (col.kind !== undefined && !/payment/i.test(kind) && !offPlatform) return;
    const status = get(r, "status");
    if (NOT_PAID.test(status)) return;
    // A charge with some still owing has been paid only in part.
    const due = col.due === undefined ? 0 : parseAmount(get(r, "due")) || 0;
    const amount = parseAmount(get(r, "amount")) - due;
    if (!Number.isFinite(amount) || (col.due !== undefined && amount <= 0)) return;
    const title = get(r, "lease");
    const fromTitle = col.lease !== undefined && col.property === undefined ? parseLeaseTitle(aliases[title] ?? title) : null;
    const property = fromTitle?.property ?? get(r, "property");
    const unit = fromTitle?.unit ?? get(r, "unit");
    const hit = resolveOwner(property, unit, registry.rows);
    const street = property.split(",")[0].trim();
    const place = registry.places[houseNumber(street)];
    const building = place?.street || street || "No property given";
    const date = parseDate(dateCols.map((c) => (r[c] ?? "").trim()).find(Boolean) ?? "");
    const via = offPlatform ? get(r, "memo").match(OFF_PLATFORM)![1] : "";
    payments.push({
      platform: via ? `${via[0].toUpperCase()}${via.slice(1).toLowerCase()} (via ${platform})` : platform,
      building,
      lease: [building, unitLabel(unit)].filter(Boolean).join(" "),
      appliesTo: date.slice(0, 7),
      allocation: null,
      city: place
        ? [place.city, [place.state, place.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
        : property.split(",").slice(1).map((x) => x.trim()).filter((x) => x && x !== "US").join(", "),
      category: get(r, "category").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      fields: Object.fromEntries(header.map((h, j) => [h.trim(), (r[j] ?? "").trim()])),
      date,
      amount,
      payer: fromTitle?.payer || get(r, "payer"),
      property,
      unit,
      memo: get(r, "memo"),
      method: get(r, "method"),
      status: PAID.test(status) ? "" : status,
      ref: get(r, "ref"),
      source: `${name}:${i + 2}`,
      owner: hit?.owner ?? null,
      address: hit?.address ?? null,
    });
  });
  return { payments, problem: col.property === undefined && col.lease === undefined ? "no property column, so no owner can see these" : null };
}

/**
 * Every payment on file, newest first. Months are exported one at a time and
 * exports can overlap, so a row that appears in two files counts once; within
 * one file, identical rows are taken as the separate payments they say they are.
 */
export async function loadPayments(registry: Registry) {
  const aliases = await loadAliases();
  // Files are read in name order, so name them by export date: where two
  // exports carry the same reference id, the later one's row wins -- a payment
  // "In Progress" in one month's export is "Completed" in the next.
  const byRef = new Map<string, number>();
  const names = (await readdir(PAYMENTS_DIR).catch(() => [] as string[]))
    .filter((n) => n.toLowerCase().endsWith(".csv"))
    .sort();
  const kept = new Map<string, number>();
  const all: Payment[] = [];
  const files: Array<{ name: string; rows: number; problem: string | null; addedAt: string; through: string }> = [];
  for (const name of names) {
    const { payments, problem } = readExport(name, await file(`${PAYMENTS_DIR}/${name}`).text(), registry, aliases);
    // When the export was added here, and the last payment date it covers.
    const addedAt = (await stat(`${PAYMENTS_DIR}/${name}`)).mtime.toISOString();
    const through = payments.reduce((m, p) => (p.date > m ? p.date : m), "");
    files.push({ name, rows: payments.length, problem, addedAt, through });
    const seen = new Map<string, number>();
    for (const p of payments) {
      if (p.ref) {
        const at = byRef.get(p.ref);
        if (at === undefined) { byRef.set(p.ref, all.length); all.push(p); }
        else all[at] = p;
        continue;
      }
      const key = [p.date, p.amount, p.payer, p.property, p.unit, p.memo].join("\u0000");
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > (kept.get(key) ?? 0)) {
        kept.set(key, n);
        all.push(p);
      }
    }
  }
  all.sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source));
  return { payments: all, files };
}

/**
 * A lease end date the site already records -- 2120's rooms, and the units
 * kept by hand in the portfolio -- for matching to the payments by building
 * and unit. `prefix` is the part of the building a unit sits in ("L" for
 * 4316's lower unit, whose rooms are A to D; CoStar writes "L B").
 */
export type KnownLeaseEnd = { house: string; prefix: string; label: string; end: string; single: boolean };

/**
 * Where last-month rent paid in advance should count, as the admin has said:
 * `leases` gives a lease's final month by its name on the page; `codes` gives
 * the final month for each of TurboTenant's lease-title codes ("27", "26S").
 */
const LEASE_ENDS_PATH = `${PAYMENTS_DIR}/lease-ends.json`;
type LeaseEnds = { codes: Record<string, string>; leases: Record<string, string> };

export async function loadLeaseEnds(): Promise<LeaseEnds> {
  const f = file(LEASE_ENDS_PATH);
  const got = (await f.exists()) ? await f.json() : {};
  return { codes: got.codes ?? {}, leases: got.leases ?? {} };
}

const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * The lease end the site records for a payment's unit, when it falls within a
 * year after the payment: an older tenant's lease has since been replaced.
 */
function siteRecord(p: Payment, known: KnownLeaseEnd[]) {
  const house = houseNumber(p.building);
  const tokens = p.unit.replace(/#/g, " ").trim().split(/\s+/).filter(Boolean).map((t) => t.toLowerCase().replace(/^0+(?=\d)/, ""));
  return known.find((k) => {
    if (k.house !== house || !p.date || k.end < p.date || monthsBetween(p.date, k.end) > 12) return false;
    if (k.single) return true;
    const label = k.label.toLowerCase();
    return k.prefix ? tokens[0] === k.prefix.toLowerCase() && tokens[1] === label : tokens[0] === label;
  });
}

/** The term code in a TurboTenant lease title ("27" in "4544 104 27 Alex Smith"), or "". */
function termCode(p: Payment) {
  return (p.fields["Lease Title"] ?? "").trim().split(/\s+/).slice(1).find((t) => TERM.test(t)) ?? "";
}

/**
 * Last-month rent paid in advance counts in the month it pays for: the
 * lease's last. That month is taken, in order, from what the admin has said
 * for the lease; from a lease end the site records for that unit, when it
 * falls within a year after the payment (an older tenant's lease has since
 * been replaced); from the TurboTenant lease code; and otherwise it is not
 * known, and the payment is held apart rather than guessed at.
 *
 * A payment for first and last month together is left where it was paid and
 * flagged: how much of it was the last month isn't in the export.
 */
function allocate(p: Payment, ends: LeaseEnds, known: KnownLeaseEnd[]) {
  if (!/last\s*month/i.test(p.memo)) return;
  if (/first|firsat/i.test(p.memo)) {
    p.allocation = { kind: "combined", basis: "First and last month together; the split isn't in the export, so it counts where it was paid" };
    return;
  }
  const given = ends.leases[p.lease];
  if (given) {
    p.appliesTo = given.slice(0, 7);
    p.allocation = { kind: "last-month", basis: `Lease ends ${given} (as given)` };
    return;
  }
  const record = siteRecord(p, known);
  if (record) {
    p.appliesTo = record.end.slice(0, 7);
    p.allocation = { kind: "last-month", basis: `Lease ends ${record.end} (site records)` };
    return;
  }
  const code = termCode(p);
  if (code && ends.codes[code]) {
    p.appliesTo = ends.codes[code];
    p.allocation = { kind: "last-month", basis: `Lease code ${code}: ends ${ends.codes[code]}` };
    return;
  }
  p.appliesTo = "";
  p.allocation = { kind: "last-month", basis: "Lease end not known: held until it is" };
}

/**
 * Rental income, month by month, from the payments: net income is the whole
 * of the rent collected, with no costs taken off. A payment counts in the
 * month it is for, exactly as on the payments page, so the two agree: last
 * month's rent paid ahead counts in the lease's final month, gathered under
 * "later" when that is after the newest payment and "unknown" when the
 * lease's end isn't known. Admin only.
 */
export function incomeByMonth(payments: Payment[], asOf?: string) {
  // One property is measured against the newest payment overall, so its
  // "later" means the same months as everyone else's.
  const newest = asOf ?? payments.reduce((m, p) => (p.date > m ? p.date : m), "");
  const newestMonth = newest.slice(0, 7);
  const key = (p: Payment) => (p.appliesTo === "" ? "unknown" : p.appliesTo > newestMonth ? "later" : p.appliesTo);
  const rows = new Map<string, { month: string; byPlatform: Record<string, number>; total: number; payments: number }>();
  for (const p of payments) {
    const k = key(p);
    const row = rows.get(k) ?? { month: k, byPlatform: {}, total: 0, payments: 0 };
    row.byPlatform[p.platform] = (row.byPlatform[p.platform] ?? 0) + p.amount;
    row.total += p.amount;
    row.payments += 1;
    rows.set(k, row);
  }
  const order = (m: string) => (m === "later" ? "9998" : m === "unknown" ? "9999" : m);
  return {
    through: newest,
    platforms: [...new Set(payments.map((p) => p.platform))].sort(),
    months: [...rows.values()].sort((a, b) => order(a.month).localeCompare(order(b.month))),
  };
}

/**
 * The payments that belong to a property on the investor site: same house
 * number, and for a property that is one part of a building ("— Lower Unit"),
 * units in that part only ("L", "L B").
 */
export function paymentsOfProperty(payments: Payment[], house: string, prefix: string) {
  return payments.filter((p) => houseNumber(p.building) === house &&
    (!prefix || p.unit.trim().split(/\s+/)[0]?.toUpperCase() === prefix));
}

/**
 * One tenancy as the payments show it: a TurboTenant lease title, or a payer
 * on CoStar. Rent paid outside CoStar and logged there by hand names no
 * tenant, so it is kept as its own row.
 */
export type Lease = {
  lease: string; // building and unit, as on the payments page
  building: string;
  unit: string;
  tenant: string;
  platforms: string[];
  /** "YYYY-MM-DD" from the site's records, "YYYY-MM" from what the admin has said or the lease code; "" when not known. */
  ends: string;
  endsBasis: string;
  /** The latest monthly rent charged on TurboTenant; null where the export doesn't say. */
  rent: number | null;
  first: string;
  last: string;
  paid: number;
  payments: number;
  /**
   * Last month's rent paid ahead on this lease: credit against the month it
   * is for, the lease's final month ("" while that isn't known). "combined"
   * was paid with the first month, and how much of it was the last month
   * isn't in the export.
   */
  credits: { date: string; amount: number; appliesTo: string; kind: "last-month" | "combined"; basis: string }[];
};

/**
 * Every tenancy in these payments, newest first within each unit. Ends come
 * the way last month's rent is placed: what the admin has said for the lease,
 * then the site's records, then the lease code -- never guessed beyond that.
 */
export function leasesFrom(payments: Payment[], ends: LeaseEnds, known: KnownLeaseEnd[]): Lease[] {
  const groups = new Map<string, Payment[]>();
  for (const p of payments) {
    const title = (p.fields["Lease Title"] ?? "").trim();
    const who = title || (/\(via /.test(p.platform) ? p.platform : p.payer.trim().toLowerCase());
    const key = `${p.lease}\u0000${who}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const out: Lease[] = [];
  for (const ps of groups.values()) {
    ps.sort((a, b) => a.date.localeCompare(b.date));
    const newest = ps[ps.length - 1];
    const latest = [...ps].reverse();
    const given = ends.leases[newest.lease];
    const record = siteRecord(newest, known);
    const code = termCode(newest);
    const [end, basis] = given ? [given.slice(0, 7), "as given"]
      : record ? [record.end, "site records"]
      : code && ends.codes[code] ? [ends.codes[code], `lease code ${code}`]
      : ["", ""];
    // A month's rent is due on the 1st; a charge due mid-month is a part month.
    const rents = latest.filter((p) => p.category === "Rent" && p.fields["Amount"]);
    const charged = rents.find((p) => p.date.endsWith("-01")) ?? rents[0];
    out.push({
      lease: newest.lease,
      building: newest.building,
      unit: newest.unit.trim().replace(/^#\s*/, ""),
      tenant: /\(via /.test(newest.platform) ? "" : latest.find((p) => p.payer)?.payer ?? "",
      platforms: [...new Set(ps.map((p) => p.platform))].sort(),
      ends: end,
      endsBasis: basis,
      rent: charged ? parseAmount(charged.fields["Amount"]) : null,
      first: ps[0].date,
      last: newest.date,
      paid: ps.reduce((s, p) => s + p.amount, 0),
      payments: ps.length,
      credits: ps.filter((p) => p.allocation).map((p) => ({
        date: p.date, amount: p.amount, appliesTo: p.appliesTo, kind: p.allocation!.kind, basis: p.allocation!.basis,
      })),
    });
  }
  return out.sort((a, b) =>
    a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit, undefined, { numeric: true }) ||
    b.last.localeCompare(a.last));
}

export type Viewer = { kind: "admin" | "team" | "owner"; name: string };

/** What this viewer may see. The filtering happens here; nothing else leaves the server. */
export async function paymentsFor(viewer: Viewer, registry: Registry, known: KnownLeaseEnd[] = []) {
  const { payments, files } = await loadPayments(registry);
  const ends = await loadLeaseEnds();
  for (const p of payments) allocate(p, ends, known);
  // How current the data is, for everyone: an owner whose last payment was in
  // July still needs to know the exports run to October. Dates only, nothing
  // about anyone else's payments.
  const updated = {
    addedAt: files.reduce((m, f) => (f.addedAt > m ? f.addedAt : m), ""),
    through: files.reduce((m, f) => (f.through > m ? f.through : m), ""),
  };
  if (viewer.kind !== "owner") return { payments, files, updated, unassigned: payments.filter((p) => !p.owner).length };
  // An owner gets their rows without the export's file names or the owner field.
  return {
    updated,
    payments: payments
      .filter((p) => p.owner === viewer.name)
      .map(({ source: _s, owner: _o, ...rest }) => rest),
  };
}

/** Saves an uploaded export under its own name. Never overwrites: a correction gets a new name. */
export async function savePaymentExport(f: File) {
  const base = f.name.replace(/\.csv$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "payments";
  const name = `${base}.csv`;
  await mkdir(PAYMENTS_DIR, { recursive: true });
  if (await file(`${PAYMENTS_DIR}/${name}`).exists()) return { error: `${name} is already on file. Rename the export to add it alongside.` };
  const text = await f.text();
  if (!parseCsv(text).length) return { error: `${f.name} is empty.` };
  await Bun.write(`${PAYMENTS_DIR}/${name}`, text);
  return { name };
}
