# Rental payment exports

One CSV per month, as exported, e.g. `2026-09.csv`. Everything here except
this README is gitignored: it holds tenants' names and what they paid.

Add them from the admin's Payments page (`/payments`), or copy them in here
directly. Files are read as they are and never rewritten; to correct a month,
add the corrected export under a new name and delete the old one. A payment
that appears in two overlapping exports is counted once.

Name each file by its export date (`costar-2026-10-06.csv`): files are read in
name order, and where two share a reference id the later file's row wins, so a
payment "In Progress" in one export is "Completed" in the next.

**CoStar** exports are a ledger, not a list of payments. Only rows of Type
`Payment` are read; charges (rent due, bills, late fees, move-in costs) and
credits are skipped, as are Failed and Canceled payments. In Progress and Paid
Offline payments are shown, flagged. The amount is `Credit Amt`, the date
`Completed On` (or `Initiated On` when that is blank), the payer `Initiated By`.

**TurboTenant** exports charges, not payments: each has a due date, an
amount and the amount still due, and the "Lease Title" typed when the lease
was set up. What was paid is Amount minus Amount Due; a charge with nothing
paid is skipped. There is no payment date, so **TurboTenant payments are dated
by their due date**. The property, unit and tenant come out of the lease title,
which takes two shapes: `4544 104 27 Alex Smith` (house number, unit, term
code, tenant) and `4544 20th Ave NE, 102 - September 2026`. A title with no
building in it matches no owner until it is corrected in
`lease-titles.json` here: title as exported -> the title it should have been,
e.g. `"003 27 Sam": "4544 003 27 Sam"`, as confirmed by the admin. The
export itself is never edited, so the correction holds for every later export
that repeats the title.

Every payment keeps its export row whole, and the page's combined log shows it
alongside the platform it came through. Leases are named from the confirmed
street address on the owner list (`places` in `registry.json`), so CoStar's
"4544 20th Ave" and TurboTenant's "4544" land on the same lease.

Columns are found by header name, so the order doesn't matter:

| Field | Headers recognised |
| --- | --- |
| date | date, payment date, paid on, completed on, transaction date, posted date, initiated on, … |
| amount (required) | amount, amount paid, paid, payment, credit amt, credit, deposit, total |
| payer | payer, tenant, tenant name, resident, name, from, sender, paid by, initiated by |
| property | property, property address, address, building, abbr |
| unit | unit, room, apt |
| memo | memo, description, note, notes, reference |
| type | type, transaction type — when present, only rows containing "payment" |
| status | status — failed, canceled, declined, returned and voided rows are dropped |
| reference | referenceid, reference id, confirmation |

Who sees a payment is decided in `payments.ts`: the admin and the team see
all of them; an owner sees one only when its property (plus unit) matches the
owner list in `data/registry.json` to exactly one named owner. A building
with several owners, or a unit whose owner is blank, needs the unit's own
abbreviation (e.g. `303` for 121 12th Ave E #303) or it stays with the admin
and team.
