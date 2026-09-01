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

function isAvailable(l) {
  return (l.status || "available") === "available";
}

function statusLabel(l) {
  return STATUS_LABELS[l.status] || null;
}

function statusNote(l) {
  return STATUS_NOTES[l.status] || null;
}

function isTaken(l) {
  return l.status === "taken";
}

/** Sort key: open first, then pending, then what's already gone. */
function statusRank(l) {
  return isAvailable(l) ? 0 : isTaken(l) ? 2 : 1;
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
    : { available: available, total: l.totalUnits, pending: unitsPending(l) || 0 };
}

/**
 * Compact count for listing cards, e.g. "4/31 available" or, where some of the
 * rest are spoken for, "4/10 available, 3 pending". Pending is named rather
 * than folded into the unavailable remainder: an application can fall through,
 * so it is a different thing to a renter than a place that is gone.
 */
function unitCountLabel(l) {
  const c = unitCounts(l);
  if (!c) return null;
  return c.available + "/" + c.total + " available" + (c.pending ? `, ${c.pending} pending` : "");
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
  return c.available + " of " + c.total + " " + noun + " \u00b7 " + pending + l.availableLabel;
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
