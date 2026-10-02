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
import { loadPortfolio } from "../../lib/portfolio";

const PORT = Number(process.env.PORT ?? 8888);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_PATH = `${import.meta.dir}/data/portfolio.json`;
const ROOMS_2120_PATH = `${import.meta.dir}/../2120/data/listings.json`;
const ADMIN_CODE_PATH = `${import.meta.dir}/data/admin-code.txt`;
const ADDRESS_PATH = `${import.meta.dir}/../../address.txt`;
const LISTINGS_PATH = `${import.meta.dir}/../../data/listings.json`;

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
  if (!(await file(ADDRESS_PATH).exists())) return [];
  const [buildings, listings] = await Promise.all([
    loadPortfolio(ADDRESS_PATH),
    file(LISTINGS_PATH).json() as Promise<Array<Record<string, unknown>>>,
  ]);
  const at = (address: string) => (x: { title?: unknown }) =>
    String(x.title ?? "").toLowerCase().startsWith(address.toLowerCase());
  return buildings.map((b) => ({
    ...b,
    listings: listings.filter(at(b.address)),
    properties: data.properties.filter(at(b.address)).map((p) => p.id),
  }));
}

type Unit = { label: string; detail?: string; rent: number; leasedUntil?: string; status?: string };
type Holding = { property: string; share: number };
type Investor = { id: string; name: string; code: string; admin?: boolean; holdings: Holding[] };
type Property = { id: string; unitsFrom?: string; units?: Unit[]; [key: string]: unknown };
type Portfolio = { demo: boolean; demoNote: string; investors: Investor[]; properties: Property[] };

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
    const data: Portfolio = await file(DATA_PATH).json();
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

    // The demo sign-in page lists the codes so there is something to type.
    // This goes when real accounts do.
    if (pathname === "/api/demo-codes") {
      return json(data.demo ? data.investors.map((i) => ({ name: i.name, code: i.code })) : []);
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
