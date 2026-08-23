/**
 * Builds a fully static copy of the site into dist/, for GitHub Pages.
 *
 * The Bun server (server.ts) renders pages and serves JSON at request time.
 * Pages only serves files, so everything the server computes is done here
 * instead and written to disk:
 *
 *   - header/footer injection and the active-nav class  -> prerendered per route
 *   - clean routes (/portfolio, /leasing, ...)          -> <route>/index.html
 *   - GET /api/*                                        -> api/*.json
 *   - POST /api/contact                                 -> no static equivalent;
 *     the contact form is swapped for the Google Form (see partials/contact-static.html)
 *
 * Base path: a project site lives at https://<user>.github.io/<repo>/, so every
 * root-relative URL needs that prefix. Pass it via BASE_PATH (e.g. "/reach").
 * Leave it empty for a user site or a custom domain.
 */

import { file, write } from "bun";
import { mkdir, rm, cp } from "node:fs/promises";
import { loadPortfolio, toMapPayload } from "../lib/portfolio";
import { build2120 } from "../sites/2120/build";

const ROOT = `${import.meta.dir}/..`;
const PUBLIC_DIR = `${ROOT}/public`;
const DATA_DIR = `${ROOT}/data`;
const DIST = `${ROOT}/dist`;

/** e.g. "/reach". Normalized to have no trailing slash. */
const BASE = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");

/** Same route table as server.ts. */
const PAGE_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/listing": "listing.html",
  "/portfolio": "portfolio.html",
  "/team": "team.html",
  "/leasing": "leasing.html",
  "/contact": "contact.html",
};

const NAV_PARENT: Record<string, string> = {
  "/listing": "/",
};

const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"];

/**
 * Rewrites the root-relative URLs the source HTML uses into base-path-aware
 * ones, and repoints the fetch() calls at the generated JSON files.
 *
 * Done as text replacement over the whole file so it catches URLs inside the
 * inline <script> template literals too (e.g. href="/listing?id=${id}").
 */
function rewriteUrls(text: string): string {
  let out = text
    // GET endpoints become static JSON documents.
    .replace(/fetch\("\/api\/listings"\)/g, `fetch("${BASE}/api/listings.json")`)
    .replace(/fetch\("\/api\/leasing-info"\)/g, `fetch("${BASE}/api/leasing-info.json")`)
    .replace(/fetch\("\/api\/site-facts"\)/g, `fetch("${BASE}/api/site-facts.json")`)
    .replace(/fetch\("\/api\/portfolio\/map"\)/g, `fetch("${BASE}/api/portfolio-map.json")`);

  if (BASE) {
    // href="/..." and src="/...", but never protocol-relative "//host/...".
    out = out.replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
    // url(/...) in stylesheets, quoted or bare.
    out = out.replace(/url\((['"]?)\/(?!\/)/g, `url($1${BASE}/`);
  }
  return out;
}

/** Drops "_"-prefixed keys, which are maintainer notes rather than page data. */
function stripNotes<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !k.startsWith("_")),
  ) as Partial<T>;
}

/** Root-relative paths inside JSON data (listing images) need the same prefix. */
function rewriteJsonPaths<T>(value: T): T {
  if (!BASE) return value;
  return JSON.parse(
    JSON.stringify(value).replace(/"\/(images|api)\//g, `"${BASE}/$1/`),
  ) as T;
}

/** Mirrors server.ts: a real photo at images/photos/<id>.<ext> beats the placeholder. */
async function withPhotos(listings: Array<Record<string, unknown>>) {
  return Promise.all(
    listings.map(async (l) => {
      for (const ext of PHOTO_EXTS) {
        const rel = `/images/photos/${l.id}.${ext}`;
        if (await file(`${PUBLIC_DIR}${rel}`).exists()) {
          return { ...l, image: rel, hasRealPhoto: true };
        }
      }
      return { ...l, hasRealPhoto: false };
    }),
  );
}

/**
 * The public map payload.
 *
 * address.txt and data/geo.json hold exact street addresses and coordinates for
 * occupied homes and are deliberately kept out of the repo, so they may not
 * exist here (CI in particular never sees them). data/portfolio-map.json is the
 * committed, already-anonymized output of scripts/gen-map.ts -- rounded pins and
 * neighborhood counts, no addresses -- and is what a build normally reads.
 */
async function loadMapPayload() {
  const prebuilt = file(`${DATA_DIR}/portfolio-map.json`);
  if (await prebuilt.exists()) return prebuilt.json();

  const addressPath = `${ROOT}/address.txt`;
  if (!(await file(addressPath).exists())) {
    throw new Error(
      "No data/portfolio-map.json and no address.txt to derive it from.\n" +
        "Run `bun scripts/gen-map.ts` on a machine that has address.txt, and commit the result.",
    );
  }
  const [buildings, geo] = await Promise.all([
    loadPortfolio(addressPath),
    file(`${DATA_DIR}/geo.json`).json(),
  ]);
  return toMapPayload(buildings, geo);
}

async function renderPage(pathname: string, fileName: string) {
  const [page, header, footer] = await Promise.all([
    file(`${PUBLIC_DIR}/${fileName}`).text(),
    file(`${PUBLIC_DIR}/partials/header.html`).text(),
    file(`${PUBLIC_DIR}/partials/footer.html`).text(),
  ]);

  const activePath = NAV_PARENT[pathname] ?? pathname;
  const activeHeader = header.replace(
    `href="${activePath}"`,
    `href="${activePath}" class="active"`,
  );

  let html = page
    .replace("<!--HEADER-->", activeHeader)
    .replace("<!--FOOTER-->", footer);

  if (pathname === "/contact") {
    // Leading comment in the partial is maintainer notes; don't ship it.
    const staticForm = (await file(`${PUBLIC_DIR}/partials/contact-static.html`).text())
      .replace(/^\s*<!--[\s\S]*?-->\s*/, "");
    html = html
      .replace(/<!--FORM-START-->[\s\S]*?<!--FORM-END-->/, staticForm)
      .replace(/\/\*FORM-JS-START\*\/[\s\S]*?\/\*FORM-JS-END\*\//g, "");
  }

  return rewriteUrls(html);
}

async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // Static assets. Page templates and partials are prerendered instead, so they
  // are not copied as-is.
  await cp(PUBLIC_DIR, DIST, { recursive: true });
  await rm(`${DIST}/partials`, { recursive: true, force: true });
  for (const fileName of Object.values(PAGE_ROUTES)) {
    await rm(`${DIST}/${fileName}`, { force: true });
  }

  // Rewrite URLs in the copied client-side assets.
  for (const asset of ["site.js", "styles.css"]) {
    const target = `${DIST}/${asset}`;
    await write(target, rewriteUrls(await file(target).text()));
  }

  for (const [route, fileName] of Object.entries(PAGE_ROUTES)) {
    const html = await renderPage(route, fileName);
    const dest = route === "/" ? `${DIST}/index.html` : `${DIST}${route}/index.html`;
    await write(dest, html);
  }

  const listings = rewriteJsonPaths(
    await withPhotos(await file(`${DATA_DIR}/listings.json`).json()),
  );
  await write(`${DIST}/api/listings.json`, JSON.stringify(listings));
  await write(
    `${DIST}/api/leasing-info.json`,
    JSON.stringify(await file(`${DATA_DIR}/leasing-info.json`).json()),
  );
  await write(
    `${DIST}/api/site-facts.json`,
    JSON.stringify(stripNotes(await file(`${DATA_DIR}/site-facts.json`).json())),
  );
  await write(`${DIST}/api/portfolio-map.json`, JSON.stringify(await loadMapPayload()));

  // Pages serves 404.html for unknown paths; send them to the listings page.
  await write(`${DIST}/404.html`, await renderPage("/", "index.html"));

  // The two 2120 sites publish at /2120 and /2120/short-term under this one,
  // so they get links of their own without needing a second host or repo.
  await build2120(`${DIST}/2120`, `${BASE}/2120`);

  // Skip Jekyll, which would otherwise ignore files and folders beginning "_".
  await write(`${DIST}/.nojekyll`, "");

  console.log(`Built dist/ with base path "${BASE || "/"}"`);
}

await build();
