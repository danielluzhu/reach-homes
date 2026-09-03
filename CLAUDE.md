# Working in this repo

README.md covers the layout, the dev commands and how the sites deploy. This
file is the things that have actually gone wrong, or are easy to get wrong.

## Two sites, two sets of data

- The main site: `data/listings.json` + `public/`. One card per property, plus
  a detail page rendered from `?id=` by `public/listing.html`.
- The 2120 microsite: `sites/2120/`, with its own `data/listings.json` (rooms
  and combinations) and `data/property.json` (floors, lease terms, contact).

They are separate data. The main site's `2120-ne-54th-st` entry **mirrors the
microsite by hand** and drifts from it — check both when either changes.

## Never reserialize data/listings.json

`upcomingUnits` and `leaseOptions` rows sit on one line each; everything else
is expanded. This is deliberate, and `scripts/sync-availability.ts` depends on
it — it edits unit rows by line regex so a daily one-word status change doesn't
produce a whole-file diff.

Rewriting the file with a plain `json.dumps`/`JSON.stringify` reflows those
rows and **silently breaks the 4544 sync**: it matches the bare `"unit": "401",`
line, finds no status and no closing brace on it, and writes nothing while
still reporting changes. This has happened once already.

Edit the file by hand, or with a writer that preserves the one-line rows.

## Status vocabularies — three of them, don't mix

| Level | Values | Notes |
| --- | --- | --- |
| Listing (`data/listings.json`) | `available`, `pending`, `taken` | `taken` is dropped from the front page entirely; the detail page stays reachable |
| Unit (4544 `upcomingUnits`) | *absent* = open, `pending`, `unavailable` | `unavailable` means rented and drops the row from the unit table |
| 2120 room (`sites/2120/`) | *absent* = open, `pending`, `leased` | see below |

A **leased** 2120 room withdraws every combination that needs it — those can no
longer be assembled, so they stop being offered. A **pending** room does not: an
application can fall through, so the combination stays on offer and is flagged
with what's outstanding.

## What derives itself, and what doesn't

Derived at render time — change a status and stop:

- Which 2120 combinations are offered, the headline rent range, and whether the
  "more than one floor" section exists at all
- Front-page listing grid, the count line, and the neighbourhood chips
- Room availability dates: shown only while still in the future, so a past date
  disappears on its own. Pairs and floors take the latest of their rooms'.

**Prose does not derive, and goes stale every time.** After any status change,
re-read: `sites/2120/public/index.html` hero and section copy, both terms'
`description`, `leaseNote` and `crossLink` in `sites/2120/data/property.json`,
and the listing `summary`/`subtitle`/`unit`/`lease` fields. Withdrawing the
lower floor left three separate sentences still selling it.

## Photos

- `public/images/photos/<listing-id>.<ext>` is the card photo, resolved
  automatically — first hit of jpg, jpeg, png, webp wins, so keep exactly one
  per id (`scripts/add-photo.ts` deletes the others on purpose).
- Galleries live in `public/images/photos/<listing-id>/`. A `photos` entry is a
  path or `{ src, caption }`. A `leaseOption` with a `photo` becomes a room card
  instead — photo beside price — and those rooms leave the gallery.
- Raw uploads land in `data/`. Convert to progressive JPEG at a 1600px long edge
  before publishing; originals stay in `data/`. HEIC won't render in a browser.
- **Some photos in `data/` carry an NWMLS watermark** and came from the sale
  listing rather than the rental. One was on 4316L's card showing a room that
  isn't even in the unit. Look at an image before publishing it.

## Don't invent property facts

Utilities, laundry, furnishing, which room has which bathroom — these come from
the owner, not from inference. Say what's known, ask for the rest, and flag the
assumption rather than filling the gap with something plausible.

## Before pushing

No test suite. Build both, since neither covers the other:

```sh
bun scripts/build-static.ts          # main site + /2120 within it
cd sites/2120 && bun build.ts        # microsite standalone
```

Commits are one per distinct change, with a message explaining the reasoning
rather than the diff. Push to `main`; it deploys via `.github/workflows/pages.yml`.

## Known drift, still unfixed

Nothing outstanding. The three that used to sit here — the main site's 2120
card advertising withdrawn combinations, the rent range computed across leased
rooms, and the front-page count disagreeing with the microsite — were all
cleared when L1, L2 and M1 leased. The rent range now derives from the rooms
still on offer; the card and the count are still mirrored by hand and will
drift again.
