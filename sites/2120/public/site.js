function money(n) {
  return "$" + Number(n).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** "2 shared, 1 private" — how the bathrooms on a floor are arranged. */
function bathSummary(rooms) {
  const priv = rooms.filter((r) => r.private).length;
  // Rooms sharing a bath are paired, so each pair accounts for one bathroom.
  const shared = Math.ceil((rooms.length - priv) / 2);
  const parts = [];
  if (shared) parts.push(`${shared} shared`);
  if (priv) parts.push(`${priv} private`);
  return parts.join(", ") || "—";
}

function roomCard(r) {
  // Only some rooms have been photographed. Showing a different room's photo
  // in the gap would misrepresent what you are renting, so those cards get a
  // labelled placeholder instead.
  const photo = r.photo
    ? `<div class="photo"><img src="/images/${escapeHtml(r.photo)}" alt="${escapeHtml(r.label)}" loading="lazy" /></div>`
    : `<div class="photo photo-none"><span>Photo on request</span></div>`;
  return `
    <article class="card">
      ${photo}
      <div class="card-body">
        <h4>${escapeHtml(r.label)}</h4>
        <span class="tag${r.private ? " tag-private" : ""}">${escapeHtml(r.bath)}</span>
        <div class="price-row">
          <span class="price">${money(r.rent)}<small>/mo</small></span>
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
