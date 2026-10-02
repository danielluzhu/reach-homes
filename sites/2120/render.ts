/**
 * Renders one of the two 2120 sites from the shared template.
 *
 * The house is let on two different terms, and each has its own site: the
 * long-term one at "/", the short-term one at "/short-term/", both under
 * /2120 on the main site. They are the
 * same page with different rents and, on the short term, without the pairs,
 * floors and whole-house options. Both the main site's server and the static
 * build render through here, so the two cannot drift apart.
 */

import { file } from "bun";

export type Term = {
  id: string;
  label: string;
  months: string;
  path: string;
  title: string;
  description: string;
  roomsOnly?: boolean;
  premium: { room: number; private: number };
  leaseNote: string;
  crossLink: string;
};

const ROOT = import.meta.dir;

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Keeps the blocks that belong on this term's site and drops the rest, so each
 * site ships only its own copy rather than hiding the other's.
 *
 *   <!--IF:bundles-->…<!--END:bundles-->     only where floors and pairs are let
 *   <!--IF:rooms-only-->…<!--END:rooms-only--> only where they are not
 */
function resolveBlocks(html: string, term: Term) {
  const keep: Record<string, boolean> = {
    bundles: !term.roomsOnly,
    "rooms-only": Boolean(term.roomsOnly),
  };
  return html
    // Blocks for the other term go, along with the line they sat on.
    .replace(/[ \t]*<!--IF:([a-z-]+)-->[\s\S]*?<!--END:\1-->[ \t]*\n?/g, (block, name: string) =>
      keep[name] ? block : "",
    )
    // The markers around the ones that stay go too, leaving the body as
    // written: a marker with a line to itself takes the line with it, and one
    // sitting inline leaves the rest of its line alone.
    .replace(/^[ \t]*<!--(?:IF|END):[a-z-]+-->[ \t]*\n/gm, "")
    .replace(/<!--(?:IF|END):[a-z-]+-->/g, "");
}

/**
 * The way back to the main Reach Homes site, for when these pages are served
 * inside it at /2120. A standalone build (bun build.ts) has no main site to go
 * back to, so the marker is simply dropped. Applied after any base-path rewrite,
 * since the link points outside this site's own base.
 */
export function withBackLink(html: string, mainHref?: string) {
  return html.replace(
    /[ \t]*<!--BACK-->[ \t]*\n?/,
    mainHref ? `  <a class="back-link" href="${escapeHtml(mainHref)}">\u2190 All listings</a>\n` : "",
  );
}

export async function renderSite(term: Term, terms: Term[]) {
  const publicDir = `${ROOT}/public`;
  const [page, header, footer] = await Promise.all([
    file(`${publicDir}/index.html`).text(),
    file(`${publicDir}/partials/header.html`).text(),
    file(`${publicDir}/partials/footer.html`).text(),
  ]);

  // Each site points at the other one once, in the footer, for the visitor who
  // landed on the wrong term.
  const other = terms.find((t) => t.id !== term.id);
  const crossLink = other
    ? `<p class="cross-site"><a href="${escapeHtml(other.path)}">${escapeHtml(other.crossLink)}</a></p>`
    : "";

  // The title and description differ per site, and TERM_ID tells the page's
  // script which rents to draw.
  const head = [
    `<title>${escapeHtml(term.title)}</title>`,
    `<meta name="description" content="${escapeHtml(term.description)}" />`,
    `<script>const TERM_ID = ${JSON.stringify(term.id)};</script>`,
  ].join("\n");

  return resolveBlocks(
    page
      .replace("<!--HEAD-->", head)
      .replace("<!--HEADER-->", header)
      .replace("<!--FOOTER-->", footer)
      .replace("<!--CROSS-LINK-->", crossLink)
      .replaceAll("{{HOME}}", escapeHtml(term.path)),
    term,
  );
}
