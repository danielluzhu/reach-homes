# Reach Homes

**Live site: https://danielluzhu.github.io/reach-homes/**

Site for a property management company with listings across Seattle, aimed at
prospective tenants who want to learn about the company and see that it's legit.

It covers:

- active listings, with photos and details (beds, baths, sqft, availability, Zillow link)
- a portfolio map showing footprint and scale across neighborhoods
- pages about the team and company
- leasing terms and FAQ
- a contact form (name, phone, email, optional occupation, optional listing, comment)

## Running locally

```sh
bun install
bun run dev      # http://localhost:3000, with reload
```

`server.ts` renders pages from `public/`, injects the shared header/footer, and
serves the JSON the pages fetch. Contact submissions POST to `/api/contact` and
are appended to `data/submissions.json`.

## Deployment

The live site — https://danielluzhu.github.io/reach-homes/ — is a static build
published to GitHub Pages by `.github/workflows/pages.yml` on every push to
`main`.

```sh
bun run build                    # -> dist/, for a custom domain or user site
BASE_PATH=/reach-homes bun run build   # -> dist/, for a project site at /<repo>/
```

### Vercel

`vercel.json` builds the same static output and serves it from the domain
root, so no `BASE_PATH` is needed. Import the repo at vercel.com/new and it
deploys as-is; the build needs Bun, which Vercel's build image provides.

Vercel can also run the contact form for real, which Pages cannot — that
needs `POST /api/contact` reimplemented as a serverless function writing to
somewhere other than the filesystem, which is ephemeral there.

`scripts/build-static.ts` does at build time what the server does per request:
prerenders each route to `<route>/index.html`, and writes the `GET /api/*`
responses to `dist/api/*.json`.

Two things differ from the local server, because Pages serves static files only:

- **The contact form** can't POST anywhere, so the static build swaps it for a
  link to the Google Form in `data/leasing-info.json`. See
  `public/partials/contact-static.html`.
- **Base paths.** A project site is served from `https://<user>.github.io/<repo>/`,
  so root-relative URLs need that prefix. CI passes it via `BASE_PATH`, taken
  from the repo's Pages settings.

## Private data

`address.txt` and `data/geo.json` hold exact street addresses and coordinates
for properties that are mostly occupied, so both are gitignored and never
deployed. The portfolio map is built from `data/portfolio-map.json`, the
anonymized payload — neighborhood counts and pins rounded to ~110m, no
addresses — which *is* committed.

Regenerate it after editing `address.txt`, then commit the result:

```sh
bun run gen-map
```

Because the private inputs aren't in the repo, CI builds the map from that
committed file. A build with neither input fails rather than silently shipping
an empty map.
