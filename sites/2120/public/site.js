function money(n) {
  return "$" + Number(n).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
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
  return `
    <article class="card">
      ${photo}
      <div class="card-body">
        <h4>${escapeHtml(r.label)}</h4>
        <span class="tag${r.private ? " tag-private" : ""}">${escapeHtml(r.bath)}</span>
        ${r.photoOf ? `<span class="photo-note">Photo of ${escapeHtml(r.photoOf)} — ${escapeHtml(r.label)} has the same layout</span>` : ""}
        <div class="price-row">
          <span class="price">${money(roomRent(r, term))}<small>/mo</small></span>
        </div>
      </div>
    </article>`;
}

function bundleCard(b) {
  const saves = b.separately - b.rent;
  return `
    <article class="card">
      <div class="photo"><img src="/images/${escapeHtml(b.photo)}" alt="" loading="lazy" /></div>
      <div class="card-body">
        <h4>${escapeHtml(b.label)}</h4>
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
function comboCard(b, roomsOnFloor) {
  const whole = b.rooms.length === roomsOnFloor;
  const saves = b.separately - b.rent;
  return `
    <article class="card card-whole${whole ? " card-floor" : ""}">
      <div class="card-body">
        <span class="tag tag-whole">${whole ? `All ${roomsOnFloor} rooms` : "Pair"}</span>
        <h4>${whole ? "Take the whole floor" : escapeHtml(b.label)}</h4>
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
