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

import { file } from "bun";
import { mkdir, readdir, stat } from "node:fs/promises";
import { loadPortfolio } from "../../lib/portfolio";
import {
  agentConfigured, applyChanges, conversationFor, describeChange, loadData,
  PRIVATE_PATH, resetConversation, runTurn,
} from "./agent";

const PORT = Number(process.env.PORT ?? 8888);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_PATH = `${import.meta.dir}/data/portfolio.json`;
const ROOMS_2120_PATH = `${import.meta.dir}/../2120/data/listings.json`;
const ADMIN_CODE_PATH = `${import.meta.dir}/data/admin-code.txt`;
const ADDRESS_PATH = `${import.meta.dir}/../../address.txt`;
const LISTINGS_PATH = `${import.meta.dir}/../../data/listings.json`;
const REGISTRY_PATH = `${import.meta.dir}/data/registry.json`;

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
    return { ...b, place, neighborhood: b.neighborhood || place?.neighborhood || "", city: b.city || place?.city || "" };
  });
}

type RegistryRow = { address: string; abbr: string; owner: string };

/**
 * The admin's own list of every building: address, the abbreviation they use
 * for it, and its owner. Private and gitignored -- it names owners.
 */
async function loadRegistry(): Promise<RegistryRow[]> {
  const f = file(REGISTRY_PATH);
  return (await f.exists()) ? ((await f.json()).rows ?? []) : [];
}

type Place = { street: string; city: string; state: string; zip: string; neighborhood?: string };

/** Full postal addresses, keyed by house number. Blank fields are ones nobody has confirmed. */
async function loadPlaces(): Promise<Record<string, Place>> {
  const f = file(REGISTRY_PATH);
  return (await f.exists()) ? ((await f.json()).places ?? {}) : {};
}

type Unit = { label: string; detail?: string; rent: number; leasedUntil?: string; status?: string };
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
    const { unitsFrom: _source, ...rest } = p;
    const owners = investor.admin
      ? data.investors.flatMap((i) =>
          i.holdings.filter((x) => x.property === p.id).map((x) => ({ name: i.name, share: x.share })),
        )
      : undefined;
    out.push({ ...rest, units: await units(p), share: h.share, owners });
  }
  return out;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    // The private copy once the assistant has applied anything, the sample before.
    const data = (await loadData()) as unknown as Portfolio;
    const token = sessionToken(req);
    const signedInAs = sessions.get(token ?? "");
    const investor = signedInAs === ADMIN.id ? ADMIN : data.investors.find((i) => i.id === signedInAs);

    if (pathname === "/api/login" && req.method === "POST") {
      const { code } = (await req.json().catch(() => ({}))) as { code?: string };
      const given = String(code ?? "").trim();
      const admin = await adminCode();
      const found = admin && given === admin
        ? ADMIN
        : data.investors.find((i) => i.code === given.toLowerCase());
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
      if (!investor) return json({ error: "Not signed in." }, 401);
      return json({
        demo: data.demo,
        demoNote: data.demoNote,
        investor: { name: investor.name, admin: Boolean(investor.admin) },
        properties: await holdingsFor(investor, data),
        buildings: investor.admin ? await wholePortfolio(data) : undefined,
      });
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
        return json({
          owners: live.investors.map((i) => ({
            id: i.id,
            name: i.name,
            code: i.code,
            properties: i.holdings.map((h) => live.properties.find((p) => p.id === h.property)?.title ?? h.property),
          })),
        });
      }
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { id?: string; code?: string };
        // Sign-in compares codes in lower case, so that is how they are kept.
        const code = String(body.code ?? "").trim().toLowerCase();
        const target = live.investors.find((i) => i.id === body.id);
        if (!target) return json({ error: "No such owner." }, 400);
        if (!/^[a-z0-9][a-z0-9_-]{5,63}$/.test(code)) {
          return json({ error: "A code is 6 to 64 letters, numbers, hyphens or underscores." }, 400);
        }
        if (live.investors.some((i) => i.id !== target.id && i.code === code) || code === ((await adminCode()) ?? "").toLowerCase()) {
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

    // The demo sign-in page lists the codes so there is something to type.
    // This goes when real accounts do.
    if (pathname === "/api/demo-codes") {
      // Only the made-up demo investors: a real owner's code is never offered.
      return json(data.investors.filter((i) => i.id.startsWith("demo-")).map((i) => ({ name: i.name, code: i.code })));
    }

    if (pathname === "/login") return new Response(file(`${PUBLIC_DIR}/login.html`));
    if (pathname === "/") {
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
});

console.log(`Investor site running at http://localhost:${server.port}`);
