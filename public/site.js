// Shared formatting helpers for listing data.

function money(n) {
  return "$" + Number(n).toLocaleString();
}

function rentLabel(l) {
  if (l.rent != null) return money(l.rent) + "<small>/mo</small>";
  if (l.rentFrom != null && l.rentTo != null) {
    if (l.rentFrom === l.rentTo) return money(l.rentFrom) + "<small>/mo</small>";
    return money(l.rentFrom) + "–" + money(l.rentTo) + "<small>/mo</small>";
  }
  if (l.rentFrom != null) return "From " + money(l.rentFrom) + "<small>/mo</small>";
  return "<small>Contact for pricing</small>";
}

function sqftLabel(l) {
  if (l.sqft != null) return l.sqft.toLocaleString() + " sqft";
  if (l.sqftFrom != null && l.sqftTo != null) {
    return l.sqftFrom.toLocaleString() + "–" + l.sqftTo.toLocaleString() + " sqft";
  }
  return null;
}

function bathLabel(l) {
  return l.baths + " ba";
}

/**
 * A listing's "status" is "available" (open to inquiries), "pending" (an
 * application is in progress) or "taken" (rented, no longer on the market).
 * Neither of the latter is removed from the site -- the portfolio still reads
 * as active -- but every place they appear is labelled.
 *
 * Every non-available status needs an entry here: the contact page prints the
 * label beside the listing name and would fail on a status without one.
 */
const STATUS_LABELS = {
  pending: "Application pending",
  taken: "Rented",
};

/**
 * What a listing that isn't open says in place of the availability date. A
 * rented unit has no date to advertise, and printing one reads as an
 * invitation to inquire about something already gone.
 */
const STATUS_NOTES = {
  pending: "An application is in progress on this unit. We're still taking inquiries in case it falls through.",
  taken: "This one is rented and is here so you can see what we manage. Ask us about anything similar coming up.",
};

/**
 * Per-unit states within a multi-unit building. A unit with no status is open,
 * and shows its availability date instead of a label. Units marked
 * "unavailable" carry no label because they aren't listed at all.
 */
const UNIT_STATUS_LABELS = {
  pending: "Application pending",
};

function unitStatusLabel(u) {
  return UNIT_STATUS_LABELS[u.status] || null;
}

/**
 * Where a listing's details live, relative to the site root. A listing with a
 * site of its own -- 2120's room-by-room pages -- sends people there instead
 * of to the generic listing page. Callers write the leading slash themselves
 * (href="/${listingPath(l)}") so the static build's base-path rewrite sees it.
 */
function listingPath(l) {
  return l.site || "listing?id=" + encodeURIComponent(l.id);
}

function isAvailable(l) {
  return (l.status || "available") === "available";
}

/**
 * Today as the same YYYY-MM-DD string the data uses, so the two compare as
 * plain strings rather than through Date and its timezones.
 */
function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date still ahead of us: the thing is on offer, but can't be moved into yet. */
function isFuture(iso) {
  return Boolean(iso) && iso > todayIso();
}

/**
 * "Available" and "available soon" are different offers: one can be moved into
 * today, the other is a lease ending on a known date. A listing is soon while
 * its own date is ahead, and turns into plain available on the day -- nothing
 * to edit.
 */
function isSoon(l) {
  return isAvailable(l) && isFuture(l.available);
}

/**
 * How many of a listing's open units are only open later. All of them where
 * the listing itself is dated ahead; otherwise the lease options carrying a
 * future date of their own, which is how one room in a unit comes up while the
 * one beside it is already empty.
 */
function unitsSoon(l, open) {
  if (isSoon(l)) return open;
  return Math.min(open, (l.leaseOptions || []).filter((o) => isFuture(o.available)).length);
}

/** The pill on a room card: when it can be had, for the ones that can. */
function optionAvailability(o) {
  if (o.status) return "";
  return isFuture(o.available)
    ? `<span class="pill-soon">Available soon \u00b7 ${escapeHtml(fmtDate(o.available))}</span>`
    : `<span class="pill-now">Available now</span>`;
}

function statusLabel(l) {
  return STATUS_LABELS[l.status] || (isSoon(l) ? "Available soon" : null);
}

function statusNote(l) {
  return STATUS_NOTES[l.status] || null;
}

function isTaken(l) {
  return l.status === "taken";
}

/** Sort key: open first, then opening soon, then pending, then what's gone. */
function statusRank(l) {
  return isAvailable(l) ? (isSoon(l) ? 1 : 0) : isTaken(l) ? 3 : 2;
}

/**
 * Units still open in a listing that tracks them individually: upcomingUnits
 * entries carrying no status. Null for listings without per-unit data.
 */
function unitsRemaining(l) {
  if (!l.upcomingUnits) return null;
  return l.upcomingUnits.filter((u) => !u.status).length;
}

/**
 * How many of a building's units are on the market. Derived from the unit table
 * where there is one, so it can't fall out of step with the unit statuses;
 * otherwise taken from a stated unitsAvailable.
 */
function unitsPending(l) {
  if (l.unitsPending != null) return l.unitsPending;
  if (!l.upcomingUnits) return null;
  return l.upcomingUnits.filter((u) => u.status === "pending").length;
}

function unitCounts(l) {
  if (l.totalUnits == null) return null;
  const available = l.unitsAvailable != null ? l.unitsAvailable : unitsRemaining(l);
  return available == null
    ? null
    : {
        available: available,
        soon: unitsSoon(l, available),
        total: l.totalUnits,
        pending: unitsPending(l) || 0,
      };
}

/**
 * Compact count for listing cards, e.g. "4/31 available" or, where some of the
 * rest are spoken for, "4/10 available, 3 pending". Pending is named rather
 * than folded into the unavailable remainder: an application can fall through,
 * so it is a different thing to a renter than a place that is gone. Units
 * opening later are split out the same way -- "1/4 available, 1 soon", or
 * "7/10 available soon" where none can be had today.
 */
function unitCountLabel(l) {
  const c = unitCounts(l);
  if (!c) return null;
  const now = c.available - c.soon;
  const open = !c.soon
    ? c.available + "/" + c.total + " available"
    : !now
      ? c.soon + "/" + c.total + " available soon"
      : now + "/" + c.total + " available, " + c.soon + " soon";
  return open + (c.pending ? `, ${c.pending} pending` : "");
}

/**
 * Availability line for the detail page: the count, where we have one, plus the
 * timing that the card doesn't have room for.
 */
function availabilityLabel(l) {
  // A rented listing's date is in the past as an offer; the status replaces it.
  if (isTaken(l)) return STATUS_LABELS.taken;
  const c = unitCounts(l);
  if (!c) return l.availableLabel;
  // "units" for a building let by the unit, "rooms" for a house let by the
  // room -- calling a bedroom a unit reads as a separate address.
  const noun = l.unitNoun || "units";
  const pending = c.pending ? c.pending + " pending \u00b7 " : "";
  const now = c.available - c.soon;
  if (c.soon && now) {
    return now + " of " + c.total + " " + noun + " available now \u00b7 " + c.soon + " soon" +
      (c.pending ? " \u00b7 " + c.pending + " pending" : "");
  }
  const soon = c.soon ? " available soon" : "";
  return c.available + " of " + c.total + " " + noun + soon + " \u00b7 " + pending + l.availableLabel;
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
