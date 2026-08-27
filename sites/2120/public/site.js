function money(n) {
  return "$" + Number(n).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/**
 * A room is open unless someone is partway to taking it ("pending") or has
 * taken it ("leased"). Both stay listed -- a renter reading the page wants to
 * know how full the house is -- but they differ in kind: an application can
 * fall through and we keep taking inquiries on a pending room, while a leased
 * one is gone.
 */
function isPending(r) {
  return r.status === "pending";
}

function isLeased(r) {
  return r.status === "leased";
}

/**
 * Whether a combination can still be assembled. A pending room might come back,
 * so a combination containing one stays on offer and says what's outstanding; a
 * leased room cannot, so the pairs and floors that need it are no longer
 * offered at all rather than priced as though they were.
 */
function isOfferable(b, rooms) {
  const leased = {};
  rooms.forEach((r) => { if (isLeased(r)) leased[r.label] = true; });
  return !b.rooms.some((label) => leased[label]);
}

/**
 * Which of a combination's rooms have an application in progress. Derived from
 * the rooms rather than recorded on the combination, so marking a room pending
 * cannot leave the pairs and floors out of step with it.
 */
function pendingIn(b, rooms) {
  const pending = {};
  rooms.forEach((r) => { if (isPending(r)) pending[r.label] = true; });
  return b.rooms.filter((label) => pending[label]);
}

/** How a combination reads when some of its rooms are spoken for. */
function pendingNote(names, total) {
  if (!names.length) return "";
  const all = names.length === total;
  const which = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return all
    ? "Application pending"
    : which + (names.length === 1 ? " has" : " have") + " an application pending";
}

/**
 * "Shared with L2", or "Private" — the room's bathroom, short enough for a
 * table cell. The cards carry the full phrase.
 */
function bathShort(r) {
  return r.bath.replace(/\s*bathroom\s*/i, " ").trim();
}

/**
 * What a room rents for on the selected term. Short stays carry a premium over
 * the long-term rate, and a room with its own bathroom carries a larger one.
 */
function roomRent(r, term) {
  const premium = term.premium ?? {};
  return r.rent + (r.private ? premium.private ?? 0 : premium.room ?? 0);
}

function roomCard(r, term) {
  // Only some rooms have been photographed. An unphotographed room gets a
  // labelled placeholder rather than a stand-in, unless the stand-in is a room
  // of the same layout — then it is shown and said so, on the caption below.
  const photo = r.photo
    ? `<div class="photo"><img src="/images/${escapeHtml(r.photo)}" alt="${escapeHtml(r.photoOf || r.label)}" loading="lazy" /></div>`
    : `<div class="photo photo-none"><span>Photo on request</span></div>`;
  const off = isPending(r) || isLeased(r);
  return `
    <article class="card${off ? " card-pending" : ""}">
      ${photo}
      <div class="card-body">
        <h4>${escapeHtml(r.label)}</h4>
        ${isLeased(r) ? '<span class="tag tag-leased">Leased</span>' : ""}
        ${isPending(r) ? '<span class="tag tag-pending">Application pending</span>' : ""}
        <span class="tag${r.private ? " tag-private" : ""}">${escapeHtml(r.bath)}</span>
        ${r.photoOf ? `<span class="photo-note">Photo of ${escapeHtml(r.photoOf)} — ${escapeHtml(r.label)} has the same layout</span>` : ""}
        <div class="price-row">
          <span class="price">${money(roomRent(r, term))}<small>/mo</small></span>
        </div>
      </div>
    </article>`;
}

function bundleCard(b, rooms) {
  const saves = b.separately - b.rent;
  const pending = pendingIn(b, rooms);
  return `
    <article class="card${pending.length ? " card-pending" : ""}">
      <div class="photo"><img src="/images/${escapeHtml(b.photo)}" alt="" loading="lazy" /></div>
      <div class="card-body">
        <h4>${escapeHtml(b.label)}</h4>
        ${pending.length ? `<span class="tag tag-pending">${escapeHtml(pendingNote(pending, b.rooms.length))}</span>` : ""}
        <span class="bath">${b.beds} bedroom${b.beds === 1 ? "" : "s"}${b.blurb ? " — " + escapeHtml(b.blurb) : ""}</span>
        <div class="price-row">
          <span class="price">${money(b.rent)}<small>/mo</small></span>
          ${saves > 0
            ? `<span class="saves"><span class="strike">${money(b.separately)}</span> save ${money(saves)}</span>`
            : ""}
        </div>
      </div>
    </article>`;
}

/**
 * A combination offered within a floor's row: either a pair of its rooms or the
 * whole floor. Styled apart from the room cards beside it because it isn't a
 * room, it's the alternative to taking them one at a time.
 */
function comboCard(b, roomsOnFloor, rooms) {
  const whole = b.rooms.length === roomsOnFloor;
  const saves = b.separately - b.rent;
  const pending = pendingIn(b, rooms);
  return `
    <article class="card card-whole${whole ? " card-floor" : ""}${pending.length ? " card-pending" : ""}">
      <div class="card-body">
        <span class="tag tag-whole">${whole ? `All ${roomsOnFloor} rooms` : "Pair"}</span>
        <h4>${whole ? "Take the whole floor" : escapeHtml(b.label)}</h4>
        ${pending.length ? `<span class="tag tag-pending">${escapeHtml(pendingNote(pending, b.rooms.length))}</span>` : ""}
        <span class="bath">${escapeHtml(whole ? b.label : b.blurb)}</span>
        <div class="price-row">
          <span class="price">${money(b.rent)}<small>/mo</small></span>
          ${saves > 0
            ? `<span class="saves"><span class="strike">${money(b.separately)}</span> save ${money(saves)}</span>`
            : ""}
        </div>
      </div>
    </article>`;
}
