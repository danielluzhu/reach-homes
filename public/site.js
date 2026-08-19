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
 * A listing's "status" is "available" (open to inquiries) or "pending" (an
 * application is in progress). Pending listings stay on the site so the
 * portfolio still reads as active, but every place they appear is labelled.
 */
const STATUS_LABELS = {
  pending: "Application pending",
};

/**
 * Per-unit states within a multi-unit building. A unit with no status is open,
 * and shows its availability date instead of a label.
 */
const UNIT_STATUS_LABELS = {
  pending: "Application pending",
  unavailable: "Not available",
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
