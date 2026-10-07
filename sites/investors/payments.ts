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
  date: string; // YYYY-MM-DD, or "" when the export gave none we could read
  amount: number;
  payer: string;
  property: string; // as written in the export
  unit: string;
  memo: string;
  method: string;
  /** "" once the money is in; otherwise what the export says, e.g. "In Progress". */
  status: string;
  /** The export's own id for the payment, when it has one. */
  ref: string;
  /** Which export it came from, and which row of it. */
  source: string;
  /** Resolved against the registry: the owner's name and the row's address, or null. */
  owner: string | null;
  address: string | null;
};

type RegistryRow = { address: string; abbr: string; owner: string };

/**
 * Header names seen in bank and payment-app exports, per field. First hit wins,
 * except for the date, where each row takes the first of these columns it has
 * filled in: CoStar leaves "Completed On" blank on a payment made offline.
 *
 * CoStar's export is a ledger rather than a list of payments: rent and bills
 * charged, credits, and payments, each a row with a Type, a Status and a
 * Credit or Debit amount. Only Type "Payment" is money received.
 */
const COLUMNS: Record<string, string[]> = {
  date: ["date", "payment date", "paid on", "date paid", "completed on", "transaction date", "posted date", "posting date", "post date", "received", "initiated on"],
  amount: ["amount", "amount paid", "paid", "payment", "payment amount", "credit amt", "credit amount", "credit", "deposit", "deposits", "total"],
  payer: ["payer", "tenant", "tenant name", "resident", "name", "from", "sender", "paid by", "initiated by"],
  property: ["property", "property address", "address", "building", "abbr", "abbreviation", "property name"],
  unit: ["unit", "room", "unit number", "apt"],
  memo: ["memo", "description", "note", "notes", "reference", "details", "for"],
  method: ["method", "payment method", "channel"],
  kind: ["type", "transaction type"],
  status: ["status"],
  ref: ["referenceid", "reference id", "confirmation", "confirmation number"],
};

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
 * nobody. A blank owner counts as unknown, not as "no one else".
 */
export function resolveOwner(property: string, unit: string, registry: RegistryRow[]) {
  const keys = [norm(property + unit), norm(property)].filter(Boolean);
  if (!keys.length) return null;
  const steps: Array<(r: RegistryRow) => boolean> = [
    (r) => keys.some((k) => (r.abbr && norm(r.abbr) === k) || norm(r.address) === k),
    // A unit named the way the owner list abbreviates it, at the same house
    // number: 121 12th Ave's units are listed as "303", "306" and so on.
    (r) => {
      const n = houseNumber(property);
      return Boolean(n && unit) && norm(r.abbr) === norm(unit) && houseNumber(r.address) === n;
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
    if (owners.size !== 1 || owners.has("")) return null;
    // The shortest address: the building rather than one of its units. Matched
    // on the house number alone, it would be any one of the units, so the
    // export's own wording is shown instead.
    const address = i === steps.length - 1 ? null : hits.map((r) => r.address).sort((a, b) => a.length - b.length)[0];
    return { owner: hits[0].owner.trim(), address };
  }
  return null;
}

/** One export, as rows. Columns are found by header name; unknown ones are ignored. */
function readExport(name: string, text: string, registry: RegistryRow[]) {
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
  const payments: Payment[] = [];
  rows.forEach((r, i) => {
    // A ledger's charges and credits are not payments; a failed one never arrived.
    if (col.kind !== undefined && !/payment/i.test(get(r, "kind"))) return;
    const status = get(r, "status");
    if (NOT_PAID.test(status)) return;
    const amount = parseAmount(get(r, "amount"));
    if (!Number.isFinite(amount)) return;
    const property = get(r, "property");
    const unit = get(r, "unit");
    const hit = resolveOwner(property, unit, registry);
    payments.push({
      date: parseDate(dateCols.map((c) => (r[c] ?? "").trim()).find(Boolean) ?? ""),
      amount,
      payer: get(r, "payer"),
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
  return { payments, problem: col.property === undefined ? "no property column, so no owner can see these" : null };
}

/**
 * Every payment on file, newest first. Months are exported one at a time and
 * exports can overlap, so a row that appears in two files counts once; within
 * one file, identical rows are taken as the separate payments they say they are.
 */
export async function loadPayments(registry: RegistryRow[]) {
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
    const { payments, problem } = readExport(name, await file(`${PAYMENTS_DIR}/${name}`).text(), registry);
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

export type Viewer = { kind: "admin" | "team" | "owner"; name: string };

/** What this viewer may see. The filtering happens here; nothing else leaves the server. */
export async function paymentsFor(viewer: Viewer, registry: RegistryRow[]) {
  const { payments, files } = await loadPayments(registry);
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
