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

## Hosting the server

`deploy/reach-homes.service` runs `server.ts` under systemd. It supersedes
`scripts/serve.sh` and `scripts/tmux-up.sh`: `Restart=always` replaces the
shell restart loop and journald replaces the tee-to-file, with rotation.

```sh
sudo cp deploy/reach-homes.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now reach-homes
journalctl -u reach-homes -f
```

`deploy/reach-homes-tmux.service` is a variant that runs the server inside a
tmux session, if you want to attach to a live terminal. It is the weaker
option: systemd cannot see a process inside tmux, so a crash leaves the unit
reporting `active` while the site is down, and output goes to tmux scrollback
rather than the journal. The header of that file explains the tradeoffs.

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

## The 2120 microsites

`sites/2120/` is a separate site for 2120 NE 54th St, whose ten bedrooms are
let individually, in pairs, by the floor, or as a whole house — more detail
than one listing card can carry.

The house is let on two terms, and each has a site of its own:

| Term | Path | What it shows |
| --- | --- | --- |
| Long term, 6–12 months | `/` | Rooms at the standard rates, plus the pairs, whole floors and the whole house |
| Short term, 3–5 months | `/short-term/` | Single rooms only, $150 above the long-term rate — $200 for a room with its own bathroom |

Both come from one template. `data/property.json` holds a `terms` entry per
site with its path, title, rent premium and copy; `sites/2120/render.ts` bakes
one of them into the page, keeping the `<!--IF:bundles-->` blocks on the
long-term site and the `<!--IF:rooms-only-->` ones on the short-term site, so
neither ships the other's markup. Each links to the other once, in the footer.

One server process serves both, on its own port:

```sh
cd sites/2120 && bun run server.ts     # http://localhost:2120
                                       # http://localhost:2120/short-term
```

`deploy/reach-2120.service` runs it under systemd alongside the main site.

They also publish as part of the main static build, under `/2120` on the main
site, so they have links of their own without a second host or repo:

    https://danielluzhu.github.io/reach-homes/2120/
    https://danielluzhu.github.io/reach-homes/2120/short-term/

`sites/2120/build.ts` produces that output and is called by
`scripts/build-static.ts`; it can also be run standalone into `sites/2120/dist`.
Assets and `api/*.json` are written once and shared by both pages.

Its rates are the source for the "Lease options" table on the main site's
2120 listing; `data/listings.json` there mirrors them, so change a rate in
`sites/2120/data/listings.json` and update the listing to match. The short-term
premium is applied at render time and is not mirrored there.

A combination's `separately` is the sum of its rooms' rents, and its `rent`
comes off that by a fixed discount: $50 for a pair, $100 for a whole floor, and
$200 for the main and upper floors together. Room rents therefore move the
combination rates too — recompute both when one changes, or the savings shown on
each card stop being true.

Which combinations are offered is just which ones `sites/2120/data/listings.json`
holds: the main floor, the upper floor and the whole house were dropped, so a
`bundle` entry for each of them was removed rather than hidden. Adding one back
means restoring its entry and recomputing `separately` and `rent` from the room
rents at the time.

A room carries a `status` of `pending` (an application is in progress) or
`leased` (someone has taken it); a room without one is open. Both stay listed
and greyed, but they differ in what they do to the combinations: a pending room
leaves its pairs and floors on offer, flagged with what's outstanding, because
an application can fall through, while a **leased room withdraws every
combination that needs it** — those can no longer be assembled, so the page
stops offering them rather than pricing something nobody can take. That is
derived at render time, so the headline range and the "more than one floor"
section (which disappears when nothing is left in it) follow from the room
statuses alone. The hero sentence naming the options is prose, though, so check
it still reads true after a status change.

A room may also carry an `available` date (`YYYY-MM-DD`) for when it comes
open, shown on its card as "Available September 5". It is for a room whose date
differs from the rest, in either direction; a room without one is open on the
house's own date in `property.json`, which the heading already gives. A date
that has passed stops being shown, so an old one is inert rather than wrong.
Pairs and floors take theirs from the last of their rooms to come free, since
none of them can be moved into before that.

## Availability sync

The studios at 4544 20th Ave NE are also listed on the building's own site,
which is the source of truth for which are open and moves faster than this
repo does. `.github/workflows/sync-availability.yml` pulls it once a day and
commits any change; `scripts/sync-availability.ts` does the work and can be
run by hand:

```sh
bun run sync-availability            # apply
bun run sync-availability -- --check # report only, exit 1 if stale
```

It syncs status only. That page gives coarse phrases ("Late September") while
`data/listings.json` holds exact dates, so a unit already listed here keeps
its date. A newly vacant unit has no date yet and is added with the source's
phrase in `availableText` until someone sets a real one.

If the fetch fails or the table doesn't parse, it writes nothing and exits
non-zero, so a redesign of that page can't blank out availability quietly.

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
