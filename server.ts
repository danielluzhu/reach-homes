import { file } from "bun";
import { loadPortfolio, toMapPayload } from "./lib/portfolio";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const LISTINGS_PATH = `${import.meta.dir}/data/listings.json`;
const LEASING_INFO_PATH = `${import.meta.dir}/data/leasing-info.json`;
const SITE_FACTS_PATH = `${import.meta.dir}/data/site-facts.json`;
const ADDRESS_PATH = `${import.meta.dir}/address.txt`;
const GEO_PATH = `${import.meta.dir}/data/geo.json`;
const SUBMISSIONS_PATH = `${import.meta.dir}/data/submissions.json`;

const PAGE_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/listing": "listing.html",
  "/portfolio": "portfolio.html",
  "/team": "team.html",
  "/leasing": "leasing.html",
  "/contact": "contact.html",
};

/** Nav highlight: which top-level nav entry a route belongs to. */
const NAV_PARENT: Record<string, string> = {
  "/listing": "/",
};

/**
 * Serves an HTML page with the shared header/footer injected, so nav markup
 * lives in exactly one place.
 */
async function renderPage(pathname: string, fileName: string) {
  const [page, header, footer] = await Promise.all([
    file(`${PUBLIC_DIR}/${fileName}`).text(),
    file(`${PUBLIC_DIR}/partials/header.html`).text(),
    file(`${PUBLIC_DIR}/partials/footer.html`).text(),
  ]);

  const activePath = NAV_PARENT[pathname] ?? pathname;
  const activeHeader = header.replace(`href="${activePath}"`, `href="${activePath}" class="active"`);

  const html = page
    .replace("<!--HEADER-->", activeHeader)
    .replace("<!--FOOTER-->", footer);

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Listings fall back to a generated placeholder image, but any real photo
 * dropped at public/images/photos/<id>.<ext> takes precedence. Lets photos be
 * added (by hand or via scripts/fetch-photos.ts) without editing listings.json.
 */
const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"];

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

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

async function saveSubmission(entry: Record<string, unknown>) {
  const f = file(SUBMISSIONS_PATH);
  const existing = (await f.exists()) ? await f.json() : [];
  existing.push(entry);
  await Bun.write(SUBMISSIONS_PATH, JSON.stringify(existing, null, 2));
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/api/listings" && req.method === "GET") {
      return json(await withPhotos(await file(LISTINGS_PATH).json()));
    }

    if (pathname === "/api/leasing-info" && req.method === "GET") {
      return json(await file(LEASING_INFO_PATH).json());
    }

    // Headline figures the business states directly. Kept apart from the
    // portfolio payload below, which is derived from address.txt.
    if (pathname === "/api/site-facts" && req.method === "GET") {
      const facts: Record<string, unknown> = await file(SITE_FACTS_PATH).json();
      // "_"-prefixed keys are maintainer notes, not page data.
      return json(Object.fromEntries(Object.entries(facts).filter(([k]) => !k.startsWith("_"))));
    }

    // Public map data only. Street addresses are intentionally NOT exposed here —
    // the portfolio is meant to show footprint and scale, and most of these homes
    // are currently occupied.
    if (pathname === "/api/portfolio/map" && req.method === "GET") {
      const [buildings, geo] = await Promise.all([
        loadPortfolio(ADDRESS_PATH),
        file(GEO_PATH).json(),
      ]);
      return json(toMapPayload(buildings, geo));
    }

    if (pathname === "/api/contact" && req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body." }, { status: 400 });
      }

      const name = String(body.name ?? "").trim();
      const phone = String(body.phone ?? "").trim();
      const email = String(body.email ?? "").trim();
      const occupation = String(body.occupation ?? "").trim();
      const listing = String(body.listing ?? "").trim();
      const comment = String(body.comment ?? "").trim();

      if (!name || !phone || !email || !comment) {
        return json({ error: "Name, phone, email, and comment are required." }, { status: 400 });
      }
      if (!isValidEmail(email)) {
        return json({ error: "Please provide a valid email address." }, { status: 400 });
      }

      const submission = {
        name,
        phone,
        email,
        occupation: occupation || null,
        listing: listing || null,
        comment,
        submittedAt: new Date().toISOString(),
      };

      try {
        await saveSubmission(submission);
      } catch (err) {
        console.error("Failed to save submission:", err);
        return json({ error: "Server error saving your message." }, { status: 500 });
      }

      console.log(`New contact submission from ${name} <${email}>`);
      return json({ ok: true });
    }

    if (pathname in PAGE_ROUTES) {
      return renderPage(pathname, PAGE_ROUTES[pathname]);
    }

    const staticFile = file(`${PUBLIC_DIR}${pathname}`);
    if (await staticFile.exists()) {
      return new Response(staticFile);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Site running at http://localhost:${server.port}`);
