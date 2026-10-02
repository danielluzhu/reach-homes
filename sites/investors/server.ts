/**
 * Investor site: what an owner sees about their own properties -- leasing,
 * money and the building -- and nothing about anyone else's. Runs on its own
 * port beside the public sites.
 *
 *   PORT=4000 bun run server.ts
 *
 * Unlike the public sites this one is never built to static files. Which
 * properties a visitor may see is decided here, per request, from their
 * session; a static build would publish every owner's figures to all of them.
 *
 * This is a demo. The access codes sit in data/portfolio.json in the clear and
 * sessions live in memory, so a restart signs everyone out. Real use needs
 * real accounts before real figures go in.
 */

import { file } from "bun";

const PORT = Number(process.env.PORT ?? 4000);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_PATH = `${import.meta.dir}/data/portfolio.json`;
const ROOMS_2120_PATH = `${import.meta.dir}/../2120/data/listings.json`;

type Unit = { label: string; detail?: string; rent: number; leasedUntil?: string; status?: string };
type Holding = { property: string; share: number };
type Investor = { id: string; name: string; code: string; holdings: Holding[] };
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

/** The investor's own properties, each with their share of it. Nothing else leaves the server. */
async function holdingsFor(investor: Investor, data: Portfolio) {
  const out = [];
  for (const h of investor.holdings) {
    const p = data.properties.find((x) => x.id === h.property);
    if (!p) continue;
    const { unitsFrom: _source, ...rest } = p;
    out.push({ ...rest, units: await units(p), share: h.share });
  }
  return out;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const data: Portfolio = await file(DATA_PATH).json();
    const token = sessionToken(req);
    const investor = data.investors.find((i) => i.id === sessions.get(token ?? ""));

    if (pathname === "/api/login" && req.method === "POST") {
      const { code } = (await req.json().catch(() => ({}))) as { code?: string };
      const found = data.investors.find((i) => i.code === String(code ?? "").trim().toLowerCase());
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
        investor: { name: investor.name },
        properties: await holdingsFor(investor, data),
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
