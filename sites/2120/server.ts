/**
 * Standalone site for 2120 NE 54th St, where the ten bedrooms are let
 * individually or in groups. Runs on its own port so it can sit alongside the
 * main Reach Homes server.
 *
 *   PORT=2120 bun run server.ts
 */

import { file } from "bun";

const PORT = Number(process.env.PORT ?? 2120);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const DATA_DIR = `${import.meta.dir}/data`;

const PAGE_ROUTES: Record<string, string> = {
  "/": "index.html",
};

async function renderPage(fileName: string) {
  const [page, header, footer] = await Promise.all([
    file(`${PUBLIC_DIR}/${fileName}`).text(),
    file(`${PUBLIC_DIR}/partials/header.html`).text(),
    file(`${PUBLIC_DIR}/partials/footer.html`).text(),
  ]);
  const html = page.replace("<!--HEADER-->", header).replace("<!--FOOTER-->", footer);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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

    if (pathname in PAGE_ROUTES) return renderPage(PAGE_ROUTES[pathname]);

    const staticFile = file(`${PUBLIC_DIR}${pathname}`);
    if (await staticFile.exists()) return new Response(staticFile);

    return new Response("Not found", { status: 404 });
  },
});

console.log(`2120 site running at http://localhost:${server.port}`);
