/**
 * Investor site: what an owner sees about their own properties -- leasing,
 * money and the building -- and nothing about anyone else's. Runs on its own
 * port beside the public sites.
 *
 *   PORT=8888 bun run server.ts
 *
 * Unlike the public sites this one is never built to static files. Which
 * properties a visitor may see is decided here, per request, from their
 * session; a static build would publish every owner's figures to all of them.
 *
 * This is a demo. The investors' access codes sit in data/portfolio.json in
 * the clear and sessions live in memory, so a restart signs everyone out. Real
 * use needs real accounts before real figures go in.
 *
 * The admin is the exception, because the admin view is not sample data: it
 * reads the whole portfolio from address.txt, the exact addresses of occupied
 * homes that the rest of this repo is careful never to publish. Its code
 * therefore comes from ADMIN_CODE or data/admin-code.txt, both outside the
 * repo, and with neither set there is no admin sign-in at all.
 */

import { file, type Server } from "bun";
import { mkdir, readdir, stat } from "node:fs/promises";
import { loadPortfolio } from "../../lib/portfolio";
import {
  agentConfigured, applyChanges, conversationFor, describeChange, loadData,
  PRIVATE_PATH, resetConversation, runTurn,
} from "./agent";
import {
  incomeByMonth, leasesFrom, loadLeaseEnds, paymentsFor, paymentsOfProperty, savePaymentExport,
  type KnownLeaseEnd, type Lease, type Payment, type Viewer,
} from "./payments";
import { contactsFor } from "./contacts";
import { leaseFileResponse, leaseFilesFor, signedLeaseOf, type LeaseFile } from "./documents";

const PORT = Number(process.env.PORT ?? 8888);
/**
 * The team's own port: the same server, sessions and data, listening a second
 * time so the team has an address of its own; its front page is the payments
 * page. Set TEAM_PORT=0 to leave it off.
 */
const TEAM_PORT = Number(process.env.TEAM_PORT ?? 1024);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_PATH = `${import.meta.dir}/data/portfolio.json`;
const ROOMS_2120_PATH = `${import.meta.dir}/../2120/data/listings.json`;
const ADMIN_CODE_PATH = `${import.meta.dir}/data/admin-code.txt`;
const ADDRESS_PATH = `${import.meta.dir}/../../address.txt`;
const LISTINGS_PATH = `${import.meta.dir}/../../data/listings.json`;
const REGISTRY_PATH = `${import.meta.dir}/data/registry.json`;

/**
 * Team logins: the people who work for Reach Homes. A team member sees every
 * rental payment and nothing else on this site -- not the admin's tools, not
 * the owners' statements. Each has their own code, so one person's access
 * can be taken away without changing anyone else's. Gitignored, like the
 * admin's code: these codes open real tenants' payments.
 */
const TEAM_PATH = `${import.meta.dir}/data/team.json`;

type TeamMember = { id: string; name: string; code: string };

async function loadTeam(): Promise<TeamMember[]> {
  const f = file(TEAM_PATH);
  return (await f.exists()) ? ((await f.json()) as { members?: TeamMember[] }).members ?? [] : [];
}

async function saveTeam(members: TeamMember[]) {
  await Bun.write(TEAM_PATH, JSON.stringify({ members }, null, 2) + "\n");
}

/** Is this code taken by anyone other than `except` -- admin, owner or team? */
async function codeInUse(code: string, data: Portfolio, except?: string) {
  if (code === ((await adminCode()) ?? "").toLowerCase()) return true;
  if (data.investors.some((i) => i.id !== except && i.code === code)) return true;
  return (await loadTeam()).some((m) => m.id !== except && m.code === code);
}

/**
 * Where the admin's uploads land: notes typed into the page and files dropped
 * on it. Nothing here is read, parsed or acted on by the server -- it is an
 * inbox. What an upload means, and what it changes on the site, is decided by
 * whoever works through it afterwards. Gitignored: it will hold real leases,
 * rents and owners' figures.
 */
const INBOX_DIR = `${import.meta.dir}/data/inbox`;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 20;

/** A name that is safe as a single path segment, whatever was uploaded. */
function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
}

async function listInbox() {
  const names = await readdir(INBOX_DIR).catch(() => [] as string[]);
  const rows = await Promise.all(
    names.map(async (name) => {
      const s = await stat(`${INBOX_DIR}/${name}`);
      return { name, bytes: s.size, at: s.mtime.toISOString() };
    }),
  );
  return rows.sort((a, b) => b.name.localeCompare(a.name));
}

async function saveUpload(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Couldn't read the upload." }, 400);
  const note = String(form.get("note") ?? "").trim();
  // The admin's own name for the note, kept readable: spaces survive, anything
  // that could mean something to a filesystem doesn't.
  const title = String(form.get("title") ?? "").replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").replace(/^[. ]+/, "").trim().slice(0, 80);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!note && !files.length) return json({ error: "Nothing to upload: add a note or a file." }, 400);
  if (files.length > MAX_UPLOAD_FILES) return json({ error: `At most ${MAX_UPLOAD_FILES} files at a time.` }, 400);
  const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (tooBig) return json({ error: `${tooBig.name} is over 10 MB.` }, 400);
  if (note.length > MAX_UPLOAD_BYTES) return json({ error: "That note is over 10 MB." }, 400);

  await mkdir(INBOX_DIR, { recursive: true });
  // One stamp per upload, so a note and the files sent with it sort together.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const saved: string[] = [];
  if (note) {
    const name = title ? `${stamp}__note_${title}.txt` : `${stamp}__note.txt`;
    await Bun.write(`${INBOX_DIR}/${name}`, note + "\n");
    saved.push(name);
  }
  for (const [i, f] of files.entries()) {
    const name = `${stamp}__${i + 1}_${safeName(f.name)}`;
    await Bun.write(`${INBOX_DIR}/${name}`, f);
    saved.push(name);
  }
  return json({ ok: true, saved });
}

const ADMIN: Investor = { id: "admin", name: "Reach Homes admin", code: "", admin: true, holdings: [] };

async function adminCode(): Promise<string | null> {
  const fromEnv = (process.env.ADMIN_CODE ?? "").trim();
  if (fromEnv) return fromEnv;
  const f = file(ADMIN_CODE_PATH);
  return (await f.exists()) ? (await f.text()).trim() || null : null;
}

/**
 * Every building under management, for the admin only: what address.txt says
 * about it, the public listings at that address, and which of the properties
 * with a statement here belong to it. Matching is by address, since the three
 * sources each have ids of their own. address.txt is kept out of the repo, so
 * on a machine without it the list is simply empty.
 */
async function wholePortfolio(data: Portfolio) {
  const [buildings, listings, registry] = await Promise.all([
    (await file(ADDRESS_PATH).exists()) ? loadPortfolio(ADDRESS_PATH) : [],
    file(LISTINGS_PATH).json() as Promise<Array<Record<string, unknown>>>,
    loadRegistry(),
  ]);
  const at = (address: string) => (x: { title?: unknown }) =>
    String(x.title ?? "").toLowerCase().startsWith(address.toLowerCase());
  const out = buildings.map((b) => ({
    ...b,
    listings: listings.filter(at(b.address)),
    properties: data.properties.filter(at(b.address)).map((p) => p.id),
    registry: [] as RegistryRow[],
    unlisted: false,
  }));

  // Each registry row goes to the building with its house number. The number
  // is taken from the address as written and, failing that, the abbreviation --
  // the two disagree on a couple of rows, and which is the typo isn't ours to
  // decide, so the row is attached and shown exactly as given.
  const number = (s: string) => s.match(/^\d+/)?.[0] ?? "";
  const extras = new Map<string, (typeof out)[number]>();
  for (const row of registry) {
    const byNumber = (n: string) => (n ? out.filter((b) => number(b.address) === n) : []);
    let hits = byNumber(number(row.address));
    if (hits.length !== 1) hits = byNumber(number(row.abbr));
    if (hits.length === 1) {
      hits[0].registry.push(row);
      continue;
    }
    // Not in address.txt at all: still a building the admin manages, listed on
    // its own so the gap between the two lists is visible.
    const key = number(row.address) || row.address;
    let extra = extras.get(key);
    if (!extra) {
      extra = {
        id: "reg-" + key.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        address: row.address.replace(/\s+#?\S*$/, (m) => (/#/.test(m) ? "" : m)),
        city: "", zip: null, neighborhood: "", units: [], parking: [], unitCount: 0,
        listings: [], properties: [], registry: [], unlisted: true,
      };
      extras.set(key, extra);
    }
    extra.registry.push(row);
    extra.unitCount = extra.registry.length;
  }
  const places = await loadPlaces();
  return [...out, ...extras.values()].map((b) => {
    const place = places[number(b.address)] ?? null;
    // address.txt buildings get their neighbourhood from lib/portfolio; the
    // ones only on the owner list get it from their confirmed address.
    // A neighbourhood the admin has set on the address wins over the one
    // lib/portfolio infers from the street grid.
    return { ...b, place, neighborhood: place?.neighborhood || b.neighborhood || "", city: b.city || place?.city || "" };
  });
}

type RegistryRow = {
  id?: string; address: string; abbr: string; owner: string;
  mgmt?: number; doors?: number; leases?: number; note?: string;
};
type Registry = { _note?: string; rows: RegistryRow[]; places: Record<string, Place> };

/**
 * The admin's own list of every building: address, the abbreviation they use
 * for it, and its owner. Private and gitignored -- it names owners.
 *
 * Rows get a stable id the first time they are read, so the admin page can
 * say which row it is editing without relying on position or wording.
 */
async function readRegistryFile(): Promise<Registry> {
  const f = file(REGISTRY_PATH);
  const reg: Registry = (await f.exists()) ? await f.json() : { rows: [], places: {} };
  reg.rows ??= [];
  reg.places ??= {};
  if (reg.rows.some((r) => !r.id)) {
    reg.rows.forEach((r) => { r.id ??= "row-" + crypto.randomUUID().slice(0, 8); });
    await writeRegistryFile(reg);
  }
  return reg;
}

async function writeRegistryFile(reg: Registry) {
  await Bun.write(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
}

async function loadRegistry(): Promise<RegistryRow[]> {
  return (await readRegistryFile()).rows;
}

/** An owner's login id, from their name as the registry writes it. */
function ownerId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "owner";
}

const CODE_RULE = /^[a-z0-9][a-z0-9_-]{5,63}$/;
const CODE_RULE_TEXT = "A code is 6 to 64 letters, numbers, hyphens or underscores.";

type Place = { street: string; city: string; state: string; zip: string; neighborhood?: string };

/** Full postal addresses, keyed by house number. Blank fields are ones nobody has confirmed. */
async function loadPlaces(): Promise<Record<string, Place>> {
  return (await readRegistryFile()).places;
}

type Unit = { label: string; detail?: string; rent: number | null; leasedUntil?: string; status?: string };
type Holding = { property: string; share: number };
type Investor = { id: string; name: string; code: string; admin?: boolean; holdings: Holding[] };
type Property = { id: string; unitsFrom?: string; units?: Unit[]; [key: string]: unknown };
type Portfolio = { demo: boolean; demoNote: string; investors: Investor[]; properties: Property[] };

/** Admin sessions with an assistant turn in flight. */
const busy = new Set<string>();

/** Session token -> investor id. */
const sessions = new Map<string, string>();

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function sessionToken(req: Request) {
  const match = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)investor_session=([a-f0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * 2120's rooms are read from the leasing microsite rather than copied here, so
 * a lease end date changed there is what the owner sees too. The main site
 * already mirrors that house by hand and drifts; this doesn't add a third copy.
 */
async function units(p: Property): Promise<Unit[]> {
  if (p.unitsFrom !== "2120") return p.units ?? [];
  const listings: Array<Unit & { kind: string }> = await file(ROOMS_2120_PATH).json();
  return listings
    .filter((l) => l.kind === "room")
    .map(({ label, rent, leasedUntil, status }) => ({ label, rent, leasedUntil, status }));
}

/**
 * Every lease end the site records, for placing last-month rent paid in
 * advance in the month it pays for. 2120's rooms come live from the
 * microsite; the rest are the portfolio's hand copy. A property that is one
 * part of a building says so in its title ("— Lower Unit").
 */
/** A property's house number, and the part of the building it is when it is one ("— Lower Unit"). */
function partOf(p: Property) {
  const title = String(p.title ?? "");
  return { house: title.match(/^\d+/)?.[0] ?? "", prefix: /— Lower/i.test(title) ? "L" : /— Upper/i.test(title) ? "U" : "" };
}

async function knownLeaseEnds(data: Portfolio): Promise<KnownLeaseEnd[]> {
  const out: KnownLeaseEnd[] = [];
  for (const p of data.properties) {
    const { house, prefix } = partOf(p);
    if (!house) continue;
    const us = await units(p);
    for (const u of us) {
      if (u.leasedUntil) out.push({ house, prefix, label: u.label, end: u.leasedUntil, single: us.length === 1 });
    }
  }
  return out;
}

/** A lease end the payments give only to the month ("2027-08") runs to that month's last day. */
const endOf = (d: string) => (d.length === 7 ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).toISOString().slice(0, 10) : d);

/**
 * Who is in each unit, from the signed leases rather than the payment
 * platform's own titles: each tenant paying now (within 45 days of the newest
 * export) is matched to the newest signed lease filed for their unit that is
 * still running at their latest payment. A lease naming them (by first name)
 * wins; a tenancy the payments don't name takes the one lease left once
 * leases naming someone paying in another unit are set aside (402's Kezia,
 * now in 405). More than one left, and none is picked: the row lists them.
 * A matched lease gives the end where nothing else on file does.
 */
function applySignedLeases(leases: Lease[], files: LeaseFile[], codes: Record<string, string>, through: string) {
  const signed = files.flatMap((f) => {
    const s = signedLeaseOf(f);
    return s ? [{ f, s }] : [];
  });
  if (!signed.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.parse(through || today) - 45 * 86400e3).toISOString().slice(0, 10);
  const unitKey = (u: string) => (u.replace(/#/g, " ").trim().split(/\s+/).pop() ?? "").toLowerCase();
  const first = (n: string) => (n.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const byUnit = files.some((f) => f.unit);
  // A code's end month as the admin has given it; one not given ends, at the
  // latest, in the year it starts with ("25" -> 2025).
  const endMonth = (code: string) => codes[code] ?? `20${code.slice(0, 2)}-12`;
  const current = leases.filter((l) => l.last >= cutoff && (!l.ends || endOf(l.ends) >= today));
  for (const l of current) {
    const here = signed.filter(({ f, s }) =>
      (!byUnit || (f.unit && unitKey(f.unit) === unitKey(l.unit))) &&
      endMonth(s.code) >= l.last.slice(0, 7));
    if (!here.length) continue;
    const newest = here.reduce((m, x) => (endMonth(x.s.code) > m ? endMonth(x.s.code) : m), "");
    const tops = here.filter((x) => endMonth(x.s.code) === newest);
    const named = l.tenant && tops.find((x) => first(x.s.tenant) === first(l.tenant));
    const elsewhere = new Set(current.filter((o) => o !== l && unitKey(o.unit) !== unitKey(l.unit)).map((o) => first(o.tenant)).filter(Boolean));
    const free = tops.filter((x) => !elsewhere.has(first(x.s.tenant)));
    const pick = named || (!l.tenant && free.length === 1 ? free[0] : null);
    if (pick) {
      l.signed = pick.s;
      if (!l.ends && codes[pick.s.code]) {
        l.ends = codes[pick.s.code];
        l.endsBasis = `signed lease, code ${pick.s.code}`;
      }
    } else if (!l.tenant && free.length > 1) {
      l.signedCandidates = free.map((x) => x.s.tenant);
    }
  }
}

/**
 * The units of a building whose rent roll comes from its payments (4544):
 * one per unit the leases name. A unit is leased until the latest end its
 * leases give; with no end on file, it is leased only while its rent is still
 * coming in (paid within 45 days of the newest export) and otherwise vacant.
 * Rent is the latest TurboTenant charge, where there is one.
 */
function unitsFromLeases(leases: Lease[], through: string): Unit[] {
  const today = new Date().toISOString().slice(0, 10);
  const recent = through ? new Date(Date.parse(through) - 45 * 86400e3).toISOString().slice(0, 10) : today;
  const byUnit = new Map<string, Lease[]>();
  for (const l of leases) if (l.unit) (byUnit.get(l.unit) ?? byUnit.set(l.unit, []).get(l.unit)!).push(l);
  return [...byUnit].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([label, ls]) => {
    const current = ls.filter((l) => l.ends && endOf(l.ends) >= today).sort((a, b) => b.ends.localeCompare(a.ends))[0];
    const paying = ls.filter((l) => !l.ends && l.last >= recent).sort((a, b) => b.last.localeCompare(a.last))[0];
    const lease = current ?? paying;
    const rent = (lease ?? ls[0]).rent ?? ls.find((l) => l.rent != null)?.rent ?? null;
    const unit: Unit = { label, rent };
    if (current) unit.leasedUntil = current.ends;
    else if (paying) unit.status = "leased";
    return unit;
  });
}

/**
 * The investor's own properties, each with their share of it. Nothing else
 * leaves the server.
 *
 * An admin is the manager's view: every property, at the whole of its figures,
 * with who owns how much of each. It is the one account that sees across
 * owners, so it is a flag on the account, never something a request can ask for.
 */
async function holdingsFor(investor: Investor, data: Portfolio) {
  const holdings: Holding[] = investor.admin
    ? data.properties.map((p) => ({ property: p.id, share: 1 }))
    : investor.holdings;
  const out = [];
  for (const h of holdings) {
    const p = data.properties.find((x) => x.id === h.property);
    if (!p) continue;
    // The hand-entered monthly statements were sample figures; income now
    // comes from the payments, and only for the admin (see /api/portfolio).
    const { unitsFrom: _source, months: _months, ...rest } = p;
    const owners = investor.admin
      ? data.investors.flatMap((i) =>
          i.holdings.filter((x) => x.property === p.id).map((x) => ({ name: i.name, share: x.share })),
        )
      : undefined;
    out.push({ ...rest, units: await units(p), share: h.share, owners });
  }
  return out;
}

const routes = {
  async fetch(req: Request, srv: Server) {
    const { pathname } = new URL(req.url);
    // The private copy once the assistant has applied anything, the sample before.
    const data = (await loadData()) as unknown as Portfolio;
    const token = sessionToken(req);
    const signedInAs = sessions.get(token ?? "");
    const investor = signedInAs === ADMIN.id ? ADMIN : data.investors.find((i) => i.id === signedInAs);
    const teamMember = investor || !signedInAs ? undefined : (await loadTeam()).find((m) => m.id === signedInAs);
    const viewer: Viewer | null = investor?.admin
      ? { kind: "admin", name: ADMIN.name }
      : investor ? { kind: "owner", name: investor.name }
      : teamMember ? { kind: "team", name: teamMember.name }
      : null;

    if (pathname === "/api/login" && req.method === "POST") {
      const { code } = (await req.json().catch(() => ({}))) as { code?: string };
      const given = String(code ?? "").trim();
      const admin = await adminCode();
      const found = admin && given === admin
        ? ADMIN
        : data.investors.find((i) => i.code === given.toLowerCase())
          ?? (await loadTeam()).find((m) => m.code === given.toLowerCase());
      if (!found) return json({ error: "That access code isn't recognised." }, 401);
      const fresh = crypto.randomUUID();
      sessions.set(fresh, found.id);
      return json({ ok: true }, 200, {
        "Set-Cookie": `investor_session=${fresh}; Path=/; HttpOnly; SameSite=Lax`,
      });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      if (token) sessions.delete(token);
      return json({ ok: true }, 200, {
        "Set-Cookie": "investor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      });
    }

    if (pathname === "/api/portfolio") {
      // A team member has no properties of their own; their page is /payments.
      if (teamMember) return json({ error: "Not signed in.", go: "/payments" }, 401);
      if (!investor) return json({ error: "Not signed in." }, 401);
      const properties = await holdingsFor(investor, data);
      // The viewer's own payments, filtered on the server as on /payments: an
      // owner's leases are only ever drawn from the rows they may see.
      const known = await knownLeaseEnds(data);
      const mine = await paymentsFor(viewer!, await readRegistryFile(), known);
      const payments = mine.payments as Payment[];
      const ends = await loadLeaseEnds();
      const leaseFiles = await leaseFilesFor(viewer!, await readRegistryFile());
      for (const p of properties) {
        const { house, prefix } = partOf(p as Property);
        const leases = leasesFrom(paymentsOfProperty(payments, house, prefix), ends, known);
        applySignedLeases(leases, leaseFiles.filter((f) => f.building === house + prefix), ends.codes, mine.updated.through);
        // The signed documents filed for this property: its folder is the house
        // number with its part, "4316L" for the lower unit.
        Object.assign(p, { leases, leaseFiles: leaseFiles.filter((f) => f.building === house + prefix) });
        if (data.properties.find((x) => x.id === p.id)?.unitsFrom === "payments") Object.assign(p, { units: unitsFromLeases(leases, mine.updated.through) });
      }
      // Income is the admin's alone: net income is all the rent collected,
      // from the payment exports, month by month, overall and per property.
      let income;
      if (investor.admin) {
        income = incomeByMonth(payments);
        for (const p of properties) {
          const { house, prefix } = partOf(p as Property);
          Object.assign(p, { income: incomeByMonth(paymentsOfProperty(payments, house, prefix), income.through).months });
        }
      }
      return json({
        demo: data.demo,
        demoNote: data.demoNote,
        investor: { name: investor.name, admin: Boolean(investor.admin) },
        properties,
        income,
        buildings: investor.admin ? await wholePortfolio(data) : undefined,
        contacts: await contactsFor(viewer!, await readRegistryFile()),
        leaseFiles,
        // The newest payment on file, so "paying now" is measured from the exports, not today.
        paymentsThrough: mine.updated.through,
      });
    }

    // Rental payments: everything for the admin and team, an owner's own for an owner.
    // A signed lease or addendum, opened from the list the viewer was sent.
    if (pathname.startsWith("/api/leases/")) {
      if (!viewer) return json({ error: "Not signed in." }, 401);
      const path = decodeURIComponent(pathname.slice("/api/leases/".length));
      return (await leaseFileResponse(viewer, await readRegistryFile(), path)) ?? json({ error: "Not found." }, 404);
    }

    if (pathname === "/api/payments") {
      if (!viewer) return json({ error: "Not signed in." }, 401);
      const registry = await readRegistryFile();
      return json({
        viewer,
        ...(await paymentsFor(viewer, registry, await knownLeaseEnds(data))),
        contacts: await contactsFor(viewer, registry),
      });
    }

    if (pathname === "/api/admin/payments" && req.method === "POST") {
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      const form = await req.formData().catch(() => null);
      const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
      if (!files.length) return json({ error: "Choose a CSV export first." }, 400);
      const bad = files.find((f) => !/\.csv$/i.test(f.name) || f.size > MAX_UPLOAD_BYTES);
      if (bad) return json({ error: `${bad.name}: payments are added as CSV files of up to 10 MB. Anything else goes in the upload inbox.` }, 400);
      const saved: string[] = [];
      for (const f of files) {
        const res = await savePaymentExport(f);
        if ("error" in res) return json({ error: res.error, saved }, 400);
        saved.push(res.name);
      }
      return json({ ok: true, saved });
    }

    // Team logins, for the admin to add, re-code and remove.
    if (pathname === "/api/admin/team") {
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      const team = await loadTeam();
      if (req.method === "GET") return json({ members: team });
      const body = (await req.json().catch(() => ({}))) as { id?: string; name?: string; code?: string; remove?: boolean };
      const target = team.find((m) => m.id === body.id);
      const signOut = (id: string) => { for (const [s, who] of sessions) if (who === id) sessions.delete(s); };
      if (body.remove) {
        if (!target) return json({ error: "No such team member." }, 400);
        await saveTeam(team.filter((m) => m !== target));
        signOut(target.id);
        return json({ ok: true });
      }
      const code = String(body.code ?? "").trim().toLowerCase();
      if (!CODE_RULE.test(code)) return json({ error: CODE_RULE_TEXT }, 400);
      if (await codeInUse(code, data, target?.id)) return json({ error: "That code is already in use. Each code must be different." }, 400);
      if (target) {
        target.code = code;
        signOut(target.id);
      } else {
        const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (!name) return json({ error: "Give the team member a name." }, 400);
        if (team.some((m) => m.name.toLowerCase() === name.toLowerCase())) return json({ error: "There is already a team member by that name." }, 400);
        // Prefixed, so a team id can never be mistaken for an owner's or the admin's.
        let id = "team-" + ownerId(name);
        while (team.some((m) => m.id === id)) id += "-2";
        team.push({ id, name, code });
      }
      await saveTeam(team);
      return json({ ok: true, code });
    }

    if (pathname === "/api/admin/uploads") {
      // 404 rather than 403: an investor has no reason to learn this exists.
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      if (req.method === "POST") return saveUpload(req);
      return json({ uploads: await listInbox() });
    }

    // The assistant: chat in, staged changes out, applied only on request.
    if (pathname.startsWith("/api/admin/agent")) {
      if (!investor?.admin || !token) return json({ error: "Not found." }, 404);
      const convo = conversationFor(token);
      const state = () => ({
        configured: agentConfigured(),
        summary: convo.summary,
        pending: convo.pending.map(describeChange),
      });

      if (pathname === "/api/admin/agent" && req.method === "GET") return json(state());

      if (pathname === "/api/admin/agent" && req.method === "POST") {
        if (!agentConfigured()) return json({ error: "The assistant isn't set up: this server has no ANTHROPIC_API_KEY." }, 503);
        const { message } = (await req.json().catch(() => ({}))) as { message?: string };
        const text = String(message ?? "").trim();
        if (!text) return json({ error: "Type an instruction first." }, 400);
        if (text.length > 200_000) return json({ error: "That's too long for one message. Upload it as a file and tell me to read it." }, 400);
        // One turn at a time: two at once would interleave in the same history.
        if (busy.has(token)) return json({ error: "Still working on your last message." }, 409);
        busy.add(token);
        try {
          return json({ reply: await runTurn(convo, text), ...state() });
        } finally {
          busy.delete(token);
        }
      }

      if (pathname === "/api/admin/agent/apply" && req.method === "POST") {
        if (!convo.pending.length) return json({ error: "Nothing is staged." }, 400);
        // Checked again here against the data as it is now, not as it was when staged.
        const { data: next, errors } = applyChanges(await loadData(), convo.pending);
        if (errors.length) return json({ error: "Couldn't apply: " + errors.join("; ") }, 400);
        await Bun.write(PRIVATE_PATH, JSON.stringify(next, null, 2) + "\n");
        const applied = convo.pending.length;
        convo.pending = [];
        convo.summary = "";
        // So the assistant knows, next turn, that these are no longer proposals.
        convo.messages.push({ role: "user", content: `[The admin applied the ${applied} staged change(s).]` });
        return json({ applied, ...state() });
      }

      if (pathname === "/api/admin/agent/discard" && req.method === "POST") {
        if (convo.pending.length) convo.messages.push({ role: "user", content: "[The admin discarded the staged changes.]" });
        convo.pending = [];
        convo.summary = "";
        return json(state());
      }

      if (pathname === "/api/admin/agent/reset" && req.method === "POST") {
        resetConversation(token);
        return json({ configured: agentConfigured(), summary: "", pending: [] });
      }
      return json({ error: "Not found." }, 404);
    }

    // Owners' access codes, for the admin to see and set. A code is the whole
    // of an owner's sign-in, so this is the one place they are ever sent out.
    if (pathname === "/api/admin/codes") {
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      const live = await loadData();
      if (req.method === "GET") {
        // Every owner on the registry is listed, with or without a login yet,
        // so the admin can see who still needs one.
        const regOwners = [...new Set((await loadRegistry()).map((r) => r.owner).filter(Boolean))];
        const withLogin = new Set(live.investors.map((i) => i.name));
        const buildingsOf = async (name: string) =>
          (await loadRegistry()).filter((r) => r.owner === name).map((r) => r.address);
        return json({
          owners: [
            ...(await Promise.all(live.investors.map(async (i) => ({
              id: i.id,
              name: i.name,
              code: i.code,
              properties: i.holdings.map((h) => live.properties.find((p) => p.id === h.property)?.title ?? h.property),
              buildings: await buildingsOf(i.name),
            })))),
            ...(await Promise.all(regOwners.filter((n) => !withLogin.has(n)).map(async (name) => ({
              id: null, name, code: null, properties: [], buildings: await buildingsOf(name),
            })))),
          ],
        });
      }
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { id?: string; name?: string; code?: string };
        // Sign-in compares codes in lower case, so that is how they are kept.
        const code = String(body.code ?? "").trim().toLowerCase();
        if (!CODE_RULE.test(code)) return json({ error: CODE_RULE_TEXT }, 400);
        let target = live.investors.find((i) => i.id === body.id);
        if (!target && body.name) {
          // A first login for an owner who is on the registry but has none yet.
          const name = String(body.name).trim();
          if (!(await loadRegistry()).some((r) => r.owner === name)) return json({ error: "No such owner on the list." }, 400);
          if (live.investors.some((i) => i.name === name)) return json({ error: "That owner already has a login." }, 400);
          let id = ownerId(name);
          while (live.investors.some((i) => i.id === id) || id.startsWith("demo-")) id += "-2";
          target = { id, name, code: "", holdings: [] };
          live.investors.push(target);
        }
        if (!target) return json({ error: "No such owner." }, 400);
        if (await codeInUse(code, live, target.id)) {
          return json({ error: "That code is already in use. Each code must be different." }, 400);
        }
        target.code = code;
        await Bun.write(PRIVATE_PATH, JSON.stringify(live, null, 2) + "\n");
        // Anyone signed in on the old code is signed out: changing a code is
        // how access is taken away.
        for (const [session, id] of sessions) if (id === target.id) sessions.delete(session);
        return json({ ok: true, code });
      }
    }

    // Editing the registry: a row's owner and figures, and a building's address.
    if (pathname === "/api/admin/registry/row" && req.method === "POST") {
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const reg = await readRegistryFile();
      const row = reg.rows.find((r) => r.id === body.id);
      if (!row) return json({ error: "No such row." }, 400);
      const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
      // Blank means "not given", which is different from zero.
      const num = (v: unknown, max: number): number | undefined | null => {
        if (v === "" || v == null) return undefined;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
      };
      const next = { ...row, owner: text(body.owner, 60), note: text(body.note, 200) };
      for (const [key, max] of [["mgmt", 100], ["doors", 1000], ["leases", 1000]] as const) {
        const n = num(body[key], max);
        if (n === null) return json({ error: `${key === "mgmt" ? "M%" : key[0].toUpperCase() + key.slice(1)} must be a whole number from 0 to ${max}, or blank.` }, 400);
        if (n === undefined) delete next[key];
        else next[key] = n;
      }
      if (!next.note) delete next.note;
      Object.assign(row, next);
      for (const k of ["mgmt", "doors", "leases", "note"] as const) if (!(k in next)) delete row[k];
      await writeRegistryFile(reg);
      return json({ ok: true, row });
    }

    if (pathname === "/api/admin/registry/place" && req.method === "POST") {
      if (!investor?.admin) return json({ error: "Not found." }, 404);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const key = String(body.key ?? "");
      const reg = await readRegistryFile();
      const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
      const place: Place = {
        street: text(body.street, 120),
        city: text(body.city, 60),
        state: text(body.state, 20).toUpperCase(),
        zip: text(body.zip, 10),
        neighborhood: text(body.neighborhood, 60),
      };
      if (!/^\d+$/.test(key)) return json({ error: "No such building." }, 400);
      // Buildings are matched to their rows by house number; a different
      // number would detach this address from the building it belongs to.
      if (!place.street.startsWith(key + " ")) {
        return json({ error: `The street address must still start with ${key}. To change a house number, ask for the address list to be updated as well.` }, 400);
      }
      if (place.state && !/^[A-Z]{2}$/.test(place.state)) return json({ error: "State is two letters, e.g. WA." }, 400);
      if (place.zip && !/^\d{5}(-\d{4})?$/.test(place.zip)) return json({ error: "Zip is five digits." }, 400);
      reg.places[key] = place;
      await writeRegistryFile(reg);
      return json({ ok: true, place });
    }

    // The demo sign-in page lists the codes so there is something to type.
    // This goes when real accounts do.
    if (pathname === "/api/demo-codes") {
      // Only the made-up demo investors: a real owner's code is never offered.
      return json(data.investors.filter((i) => i.id.startsWith("demo-")).map((i) => ({ name: i.name, code: i.code })));
    }

    if (pathname === "/login") return new Response(file(`${PUBLIC_DIR}/login.html`));
    if (pathname === "/payments") {
      if (!viewer) return new Response(null, { status: 302, headers: { Location: "/login" } });
      return new Response(file(`${PUBLIC_DIR}/payments.html`), { headers: { "Cache-Control": "no-store" } });
    }
    if (pathname === "/") {
      if (teamMember || (srv.port === TEAM_PORT && viewer)) return new Response(null, { status: 302, headers: { Location: "/payments" } });
      // A relative Location, so the redirect holds behind a proxy or a forwarded
      // port, where the host and scheme this process sees aren't the visitor's.
      if (!investor) return new Response(null, { status: 302, headers: { Location: "/login" } });
      return new Response(file(`${PUBLIC_DIR}/index.html`), { headers: { "Cache-Control": "no-store" } });
    }

    if (!pathname.includes("..")) {
      const staticFile = file(`${PUBLIC_DIR}${pathname}`);
      if (await staticFile.exists()) return new Response(staticFile);
    }
    return new Response("Not found", { status: 404 });
  },
};

const server = Bun.serve({ port: PORT, ...routes });
console.log(`Investor site running at http://localhost:${server.port}`);
if (TEAM_PORT && TEAM_PORT !== PORT) {
  const team = Bun.serve({ port: TEAM_PORT, ...routes });
  console.log(`Team payments page at http://localhost:${team.port}/payments`);
}
