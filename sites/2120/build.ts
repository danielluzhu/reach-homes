/**
 * Builds a static copy of the 2120 sites.
 *
 * The server renders the pages and serves their JSON at request time; a static
 * host does neither, so both are done here. Exported rather than run directly
 * so the main site's build can place this at /2120 within its own output, and
 * the two publish together.
 *
 *   BASE_PATH=/reach-homes/2120 bun build.ts   # standalone, into ./dist
 *
 * There are two sites, one per lease term, and both are written here: the
 * long-term one at the root and the short-term one at /short-term. They share
 * every asset, so only the HTML is written twice.
 */

import { file, write } from "bun";
import { mkdir, rm, cp } from "node:fs/promises";
import { renderSite, withBackLink, type Term } from "./render";

const ROOT = import.meta.dir;

/**
 * Rewrites the site's root-relative URLs and API calls to sit under `base`.
 * Shared with the main site's server, which serves these pages live at /2120
 * the same way the static build publishes them.
 */
export function rewriter(base: string) {
  const BASE = base.replace(/\/+$/, "");
  return (text: string) => {
    let out = text
      .replace(/fetch\("\/api\/listings"\)/g, `fetch("${BASE}/api/listings.json")`)
      .replace(/fetch\("\/api\/property"\)/g, `fetch("${BASE}/api/property.json")`);
    if (BASE) {
      out = out.replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
      out = out.replace(/url\((['"]?)\/(?!\/)/g, `url($1${BASE}/`);
    }
    return out;
  };
}

/** `mainHref` is the main site's front page, where the build sits inside one. */
export async function build2120(outDir: string, base: string, mainHref?: string) {
  const publicDir = `${ROOT}/public`;
  const dataDir = `${ROOT}/data`;

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(publicDir, outDir, { recursive: true });
  await rm(`${outDir}/partials`, { recursive: true, force: true });
  await rm(`${outDir}/index.html`, { force: true });

  const rewrite = rewriter(base);

  const property = await file(`${dataDir}/property.json`).json();
  const terms: Term[] = property.terms;
  for (const term of terms) {
    // "/" lands at the root, "/short-term/" in a directory of its own; both
    // reach the shared assets and JSON by the same root-relative paths.
    const dir = `${outDir}${term.path}`.replace(/\/+$/, "");
    await mkdir(dir, { recursive: true });
    await write(`${dir}/index.html`, withBackLink(rewrite(await renderSite(term, terms)), mainHref));
  }

  // The in-page anchors the header links to are relative to the page, so the
  // rewrite above must not have touched them; only site.js needs it.
  await write(`${outDir}/site.js`, rewrite(await file(`${outDir}/site.js`).text()));
  await write(`${outDir}/styles.css`, rewrite(await file(`${outDir}/styles.css`).text()));

  await write(`${outDir}/api/listings.json`, JSON.stringify(await file(`${dataDir}/listings.json`).json()));
  await write(`${outDir}/api/property.json`, JSON.stringify(property));

  return outDir;
}

if (import.meta.main) {
  const out = await build2120(`${ROOT}/dist`, process.env.BASE_PATH ?? "");
  console.log(`Built 2120 into ${out} with base "${process.env.BASE_PATH ?? "/"}"`);
}
