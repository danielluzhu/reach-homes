/**
 * Builds a static copy of the 2120 site.
 *
 * The server renders the page and serves its JSON at request time; a static
 * host does neither, so both are done here. Exported rather than run directly
 * so the main site's build can place this at /2120 within its own output, and
 * the two publish together.
 *
 *   BASE_PATH=/reach-homes/2120 bun build.ts   # standalone, into ./dist
 */

import { file, write } from "bun";
import { mkdir, rm, cp } from "node:fs/promises";

const ROOT = import.meta.dir;

export async function build2120(outDir: string, base: string) {
  const publicDir = `${ROOT}/public`;
  const dataDir = `${ROOT}/data`;
  const BASE = base.replace(/\/+$/, "");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(publicDir, outDir, { recursive: true });
  await rm(`${outDir}/partials`, { recursive: true, force: true });
  await rm(`${outDir}/index.html`, { force: true });

  const rewrite = (text: string) => {
    let out = text
      .replace(/fetch\("\/api\/listings"\)/g, `fetch("${BASE}/api/listings.json")`)
      .replace(/fetch\("\/api\/property"\)/g, `fetch("${BASE}/api/property.json")`);
    if (BASE) {
      out = out.replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
      out = out.replace(/url\((['"]?)\/(?!\/)/g, `url($1${BASE}/`);
    }
    return out;
  };

  const [page, header, footer] = await Promise.all([
    file(`${publicDir}/index.html`).text(),
    file(`${publicDir}/partials/header.html`).text(),
    file(`${publicDir}/partials/footer.html`).text(),
  ]);
  await write(
    `${outDir}/index.html`,
    rewrite(page.replace("<!--HEADER-->", header).replace("<!--FOOTER-->", footer)),
  );

  // The in-page anchors the header links to are relative to the page, so the
  // rewrite above must not have touched them; only site.js needs it.
  await write(`${outDir}/site.js`, rewrite(await file(`${outDir}/site.js`).text()));
  await write(`${outDir}/styles.css`, rewrite(await file(`${outDir}/styles.css`).text()));

  await write(`${outDir}/api/listings.json`, JSON.stringify(await file(`${dataDir}/listings.json`).json()));
  await write(`${outDir}/api/property.json`, JSON.stringify(await file(`${dataDir}/property.json`).json()));

  return outDir;
}

if (import.meta.main) {
  const out = await build2120(`${ROOT}/dist`, process.env.BASE_PATH ?? "");
  console.log(`Built 2120 into ${out} with base "${process.env.BASE_PATH ?? "/"}"`);
}
