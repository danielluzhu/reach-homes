/**
 * Standalone site for 2120 NE 54th St, where the ten bedrooms are let
 * individually or in groups. Runs on its own port so it can sit alongside the
 * main Reach Homes server.
 *
 *   PORT=2120 bun run server.ts
 *
 * It serves two sites off that port, one per lease term: the long-term site at
 * "/" and the short-term one at "/short-term". Both come from the same
 * template, and data/property.json says which paths they answer on.
 */

import { file } from "bun";
import { renderSite, type Term } from "./render";

const PORT = Number(process.env.PORT ?? 2120);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_DIR = `${import.meta.dir}/data`;

async function terms(): Promise<Term[]> {
  return (await file(`${DATA_DIR}/property.json`).json()).terms;
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/api/listings") return json(await file(`${DATA_DIR}/listings.json`).json());
    if (pathname === "/api/property") return json(await file(`${DATA_DIR}/property.json`).json());

    // "/short-term" and "/short-term/" are the same site.
    const route = pathname.replace(/\/+$/, "") || "/";
    const all = await terms();
    const term = all.find((t) => t.path.replace(/\/+$/, "") === (route === "/" ? "" : route));
    if (term) {
      return new Response(await renderSite(term, all), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const staticFile = file(`${PUBLIC_DIR}${pathname}`);
    if (await staticFile.exists()) return new Response(staticFile);

    return new Response("Not found", { status: 404 });
  },
});

console.log(`2120 site running at http://localhost:${server.port}`);
