function money(n) {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? "−" + s : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/**
 * Dates stay as the YYYY-MM-DD strings the data uses and compare as strings,
 * as on the leasing sites: through Date, "2026-11-30" is the 29th on the west
 * coast.
 */
function isoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The leasing sites put a room back on offer this far ahead of its lease ending. */
const OPEN_WINDOW_DAYS = 90;

/**
 * Where a unit stands, from the owner's side: rent is coming in ("occupied"),
 * rent is coming in but the unit is being advertised for the next tenant
 * ("marketing"), or nobody is in it ("vacant").
 */
function unitState(u) {
  const ends = u.leasedUntil;
  if (ends && ends > isoDate(0)) return ends > isoDate(OPEN_WINDOW_DAYS) ? "occupied" : "marketing";
  // No end date on file: only an explicit status says someone is in it.
  if (!ends && (u.status === "leased" || u.status === "pending")) return u.status === "leased" ? "occupied" : "vacant";
  return "vacant";
}

const STATE_PILLS = {
  occupied: ["pill-occupied", "Leased"],
  marketing: ["pill-market", "Leased · advertised for re-let"],
  vacant: ["pill-vacant", "Vacant · on the market"],
};

function isPaying(u) {
  return unitState(u) !== "vacant";
}

const COSTS = [
  ["management", "Management"],
  ["repairs", "Repairs"],
  ["utilities", "Utilities"],
  ["taxesInsurance", "Taxes & insurance"],
];

function net(m) {
  return m.rent - COSTS.reduce((sum, [key]) => sum + (m[key] || 0), 0);
}

function shareLabel(share) {
  return Math.round(share * 100) + "%";
}

/**
 * Set once the portfolio loads. The admin sees every property at the whole of
 * its figures, so "your share" has no meaning there: the wording changes and
 * the owners are named instead.
 */
let ADMIN = false;

function ownersLabel(p) {
  if (!p.owners || !p.owners.length) return "No owner on file";
  const held = p.owners.reduce((s, o) => s + o.share, 0);
  const named = p.owners.map((o) => `${o.name} ${shareLabel(o.share)}`).join(", ");
  // Shares that don't reach 100% are worth seeing rather than hiding.
  return held < 0.999 ? `${named} · ${shareLabel(1 - held)} unassigned` : named;
}

function nextLeaseEnd(p) {
  return p.units.map((u) => u.leasedUntil).filter((d) => d && d > isoDate(0)).sort()[0] || null;
}

/* ---------- Overview ---------- */

function overview(data) {
  const props = data.properties;
  const units = props.flatMap((p) => p.units);
  const paying = units.filter(isPaying).length;
  const last = props[0] ? props[0].months[props[0].months.length - 1].month : null;
  const lastNet = props.reduce((sum, p) => sum + net(p.months[p.months.length - 1]) * p.share, 0);
  const allNet = props.reduce((sum, p) => sum + p.months.reduce((s, m) => s + net(m), 0) * p.share, 0);
  const comingUp = units.filter((u) => unitState(u) !== "occupied").length;

  return `
    <h1>${escapeHtml(data.investor.name)}</h1>
    <p class="sub">${ADMIN && data.buildings && data.buildings.length
      ? `${data.buildings.length} buildings under management · ${props.length} with statements, shown at whole-property figures`
      : `${props.length} ${props.length === 1 ? "property" : "properties"} under management`}</p>

    <div class="tiles">
      <div class="tile"><div class="tile-key">Occupancy</div><div class="tile-val">${paying} of ${units.length}</div><div class="tile-note">units and rooms leased today</div></div>
      <div class="tile"><div class="tile-key">Vacant or turning over</div><div class="tile-val">${comingUp}</div><div class="tile-note">empty, or lease ending within ${OPEN_WINDOW_DAYS} days</div></div>
      <div class="tile"><div class="tile-key">Net income, ${last ? escapeHtml(monthLabel(last)) : ""}</div><div class="tile-val">${money(lastNet)}</div><div class="tile-note">${ADMIN ? "all properties" : "your share"}</div></div>
      <div class="tile"><div class="tile-key">Net income, last ${props[0] ? props[0].months.length : 0} months</div><div class="tile-val">${money(allNet)}</div><div class="tile-note">${ADMIN ? "all properties" : "your share"}</div></div>
    </div>

    <section class="section">
      <div class="section-heading"><h2>${ADMIN ? "Properties with statements" : "Your properties"}</h2><p>Select one for its rent roll, statement and building record.</p></div>
      <div class="panel table-scroll"><table>
        <thead><tr><th>Property</th>${ADMIN ? "<th>Owners</th>" : '<th class="num">Your share</th>'}<th>Leased</th><th>Next lease end</th><th class="num">Net, ${last ? escapeHtml(monthLabel(last)) : ""}${ADMIN ? "" : " (your share)"}</th></tr></thead>
        <tbody>${props.map((p) => {
          const n = net(p.months[p.months.length - 1]) * p.share;
          const end = nextLeaseEnd(p);
          return `<tr class="clickable" data-href="#/p/${encodeURIComponent(p.id)}">
            <td><a href="#/p/${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a><br /><span class="sub">${escapeHtml(p.kind)} · ${escapeHtml(p.neighborhood)}</span></td>
            ${ADMIN ? `<td>${escapeHtml(ownersLabel(p))}</td>` : `<td class="num">${shareLabel(p.share)}</td>`}
            <td>${p.units.filter(isPaying).length} of ${p.units.length}</td>
            <td>${end ? escapeHtml(dateLabel(end)) : "—"}</td>
            <td class="num${n < 0 ? " neg" : ""}">${money(n)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </section>
    ${data.buildings ? portfolioTable(data) : ""}`;
}

/* ---------- The whole portfolio (admin) ---------- */

const LISTING_STATUS = { available: "Listed", pending: "Application pending", taken: "Rented" };

function listingRent(l) {
  if (l.rent != null) return money(l.rent);
  if (l.rentFrom != null && l.rentTo != null && l.rentFrom !== l.rentTo) return money(l.rentFrom) + "\u2013" + money(l.rentTo);
  return l.rentFrom != null ? money(l.rentFrom) : "\u2014";
}

/**
 * Every building under management, including the ones with no statement here.
 * A row says what is actually on file for it, so a gap reads as a gap.
 */
function portfolioTable(data) {
  const b = data.buildings;
  const doors = b.reduce((s, x) => s + x.unitCount, 0);
  return `
    <section class="section">
      <div class="section-heading"><h2>Whole portfolio</h2><p>${b.length} buildings, ${doors} doors, from the address list. Select one for everything on file.</p></div>
      <div class="panel table-scroll"><table>
        <thead><tr><th>Address</th><th>Area</th><th class="num">Doors</th><th>Units</th><th>Public listing</th><th>Statement</th></tr></thead>
        <tbody>${b.map((x) => {
          const href = "#/b/" + encodeURIComponent(x.id);
          const listed = x.listings.map((l) => LISTING_STATUS[l.status || "available"]).join(", ");
          return `<tr class="clickable" data-href="${href}">
            <td><a href="${href}">${escapeHtml(x.address)}</a></td>
            <td>${escapeHtml(x.neighborhood)}${x.city !== "Seattle" && x.city !== x.neighborhood ? ", " + escapeHtml(x.city) : ""}</td>
            <td class="num">${x.unitCount}</td>
            <td>${escapeHtml(x.units.join(", ") || "\u2014")}${x.parking.length ? ` <span class="sub">\u00b7 parking ${escapeHtml(x.parking.join(", "))}</span>` : ""}</td>
            <td>${listed ? escapeHtml(listed) : '<span class="sub">Not listed</span>'}</td>
            <td>${x.properties.length ? "On file" : '<span class="sub">None</span>'}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </section>`;
}

function bullets(title, items) {
  if (!items || !items.length) return "";
  return `<div class="section-heading" style="margin-top:20px"><h2>${escapeHtml(title)}</h2></div>
    <div class="panel"><ul class="plain-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`;
}

function listingBlock(l) {
  const specs = [l.bedsLabel, l.baths != null ? l.baths + " ba" : "", l.sqft ? l.sqft.toLocaleString() + " sqft" : l.sqftFrom ? `${l.sqftFrom}\u2013${l.sqftTo} sqft` : ""].filter(Boolean).join(" \u00b7 ");
  const rows = (l.leaseOptions || []).map((o) => [o.name, o.detail + (o.available ? " \u00b7 from " + dateLabel(o.available) : "") + (o.status ? " \u00b7 " + o.status : ""), o.rentLabel || money(o.rent)])
    .concat((l.layouts || []).map((o) => [o.name, `${o.sqft} sqft \u00b7 ${o.notes || ""}`, o.rent]));
  const units = l.upcomingUnits || [];
  return `
    <section class="section">
      <div class="section-heading"><h2>Public listing: ${escapeHtml(l.title)}</h2><p>${escapeHtml(l.subtitle || "")}</p></div>
      <div class="tiles" style="margin-top:0">
        <div class="tile"><div class="tile-key">Status</div><div class="tile-val">${escapeHtml(LISTING_STATUS[l.status || "available"])}</div><div class="tile-note">${escapeHtml(l.availableLabel || "")}</div></div>
        <div class="tile"><div class="tile-key">Asking rent</div><div class="tile-val">${escapeHtml(listingRent(l))}</div><div class="tile-note">per month</div></div>
        <div class="tile"><div class="tile-key">Size</div><div class="tile-val" style="font-size:1.15rem">${escapeHtml(specs)}</div><div class="tile-note">${l.totalUnits ? l.totalUnits + " " + escapeHtml(l.unitNoun || "units") : ""}</div></div>
      </div>
      <p style="max-width:80ch">${escapeHtml(l.summary || "")}</p>
      ${rows.length ? `<div class="panel table-scroll"><table>
        <thead><tr><th>Option</th><th>Details</th><th class="num">Rent</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td><td class="num">${escapeHtml(r[2])}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
      ${units.length ? `<div class="section-heading" style="margin-top:20px"><h2>Units tracked on the listing</h2></div><div class="panel table-scroll"><table>
        <thead><tr><th>Unit</th><th>Status</th><th>Available</th></tr></thead>
        <tbody>${units.map((u) => `<tr><td>${escapeHtml(u.unit)}</td>
          <td><span class="pill ${u.status === "unavailable" ? "pill-occupied" : u.status === "pending" ? "pill-market" : "pill-vacant"}">${u.status === "unavailable" ? "Rented" : u.status === "pending" ? "Application pending" : "Open"}</span></td>
          <td>${escapeHtml(u.available ? dateLabel(u.available) : u.availableText || "\u2014")}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
      <div class="two-col">
        <div>${bullets("The building", l.building)}${bullets("Lease terms", l.lease)}</div>
        <div>${bullets("The unit", l.unit)}</div>
      </div>
      <p><a href="${escapeHtml(l.zillow || "#")}" target="_blank" rel="noopener">Zillow listing</a></p>
    </section>`;
}

function buildingView(b, data) {
  const where = [b.address, b.city, "WA", b.zip].filter(Boolean).join(", ");
  const held = data.properties.filter((p) => b.properties.includes(p.id));
  return `
    <a class="back-link" href="#/">\u2190 All properties</a>
    <h1>${escapeHtml(b.address)}</h1>
    <p class="sub">${escapeHtml(b.neighborhood)} \u00b7 ${escapeHtml(where)} \u00b7 <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}" target="_blank" rel="noopener">Map</a></p>

    <div class="tiles">
      <div class="tile"><div class="tile-key">Doors</div><div class="tile-val">${b.unitCount}</div><div class="tile-note">${escapeHtml(b.units.length ? "Units " + b.units.join(", ") : "single home, or not broken out")}</div></div>
      <div class="tile"><div class="tile-key">Parking</div><div class="tile-val">${b.parking.length || "\u2014"}</div><div class="tile-note">${escapeHtml(b.parking.join(", ") || "none listed")}</div></div>
      <div class="tile"><div class="tile-key">Public listings</div><div class="tile-val">${b.listings.length}</div><div class="tile-note">${escapeHtml(b.listings.map((l) => LISTING_STATUS[l.status || "available"]).join(", ") || "not on the leasing site")}</div></div>
      <div class="tile"><div class="tile-key">Statements</div><div class="tile-val">${held.length}</div><div class="tile-note">${held.length ? "rent roll and financials below" : "no rent roll or financials on file"}</div></div>
    </div>

    ${held.length ? `<section class="section">
      <div class="section-heading"><h2>Rent roll and statement</h2></div>
      <div class="panel"><ul class="plain-list">${held.map((p) => `<li><a href="#/p/${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a> \u00b7 ${escapeHtml(ownersLabel(p))}</li>`).join("")}</ul></div>
    </section>` : ""}

    ${b.listings.map(listingBlock).join("")}

    ${!held.length && !b.listings.length ? `<section class="section"><div class="panel"><p style="padding:6px 16px">The address list is the only record of this building here: no lease dates, rents, owners or financials have been entered for it.</p></div></section>` : ""}`;
}

/* ---------- One property ---------- */

function rentRoll(p) {
  const scheduled = p.units.filter(isPaying).reduce((s, u) => s + u.rent, 0);
  const potential = p.units.reduce((s, u) => s + u.rent, 0);
  return `
    <div class="panel table-scroll"><table>
      <thead><tr><th>${escapeHtml(p.unitNoun)}</th><th>Status</th><th>Lease ends</th><th class="num">Rent</th></tr></thead>
      <tbody>${p.units.map((u) => {
        const [cls, label] = STATE_PILLS[unitState(u)];
        const ends = u.leasedUntil && u.leasedUntil > isoDate(0) ? dateLabel(u.leasedUntil) : "—";
        return `<tr>
          <td>${escapeHtml(u.label)}${u.detail ? ` <span class="sub">· ${escapeHtml(u.detail)}</span>` : ""}</td>
          <td><span class="pill ${cls}">${escapeHtml(label)}</span></td>
          <td>${escapeHtml(ends)}</td>
          <td class="num">${money(u.rent)}</td>
        </tr>`;
      }).join("")}</tbody>
      <tfoot><tr><td colspan="3">Rent on leased ${escapeHtml(p.unitNoun)}s, of ${money(potential)} if full</td><td class="num">${money(scheduled)}</td></tr></tfoot>
    </table></div>`;
}

/**
 * Net income by month, one bar each. A single series in the brand colour: the
 * heading names it, so there is no legend, and the statement below is the
 * table view of the same numbers. Bars grow from a zero line because a
 * turnover month can go negative.
 */
function netChart(p) {
  const W = 640, H = 220, left = 52, right = 10, top = 14, bottom = 26;
  const values = p.months.map(net);
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  // Round the scale out to a tidy step so the gridlines land on round figures.
  const step = [500, 1000, 2000, 2500, 5000, 10000].find((s) => (hi - lo) / s <= 5) || 20000;
  const max = Math.ceil(hi / step) * step, min = Math.floor(lo / step) * step;
  const y = (v) => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
  const slot = (W - left - right) / values.length;
  const barW = Math.min(36, slot * 0.5);

  let grid = "";
  for (let v = min; v <= max; v += step) {
    grid += `<line class="${v === 0 ? "zero-line" : "grid-line"}" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" />
      <text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${escapeHtml(money(v))}</text>`;
  }

  const bars = values.map((v, i) => {
    const x = left + slot * i + (slot - barW) / 2;
    const y0 = y(0), y1 = y(v);
    const r = Math.min(4, Math.abs(y1 - y0));
    // Rounded at the data end only; square where it meets the zero line.
    const d = v >= 0
      ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
    return `<g data-tip="${escapeHtml(monthLabel(p.months[i].month) + ": " + money(v))}" data-x="${x + barW / 2}" data-y="${Math.min(y0, y1)}">
      <rect class="hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${H - top - bottom}" />
      <path class="bar" d="${d}" />
      <text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${escapeHtml(MONTHS[Number(p.months[i].month.split("-")[1]) - 1])}</text>
    </g>`;
  }).join("");

  return `<div class="panel chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net income by month for ${escapeHtml(p.title)}">${grid}${bars}</svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

function statement(p) {
  const total = (key) => p.months.reduce((s, m) => s + (m[key] || 0), 0);
  const totalNet = p.months.reduce((s, m) => s + net(m), 0);
  // Red is for a month or a total that lost money, not for every cost: a
  // statement where each expense shouts hides the one line that matters.
  const cell = (n) => `<td class="num${n < 0 ? " neg" : ""}">${money(n)}</td>`;
  const cost = (n) => `<td class="num cost">${n ? money(-n) : "\u2014"}</td>`;
  return `
    <div class="panel table-scroll"><table>
      <thead><tr><th>Month</th><th class="num">Rent collected</th>${COSTS.map(([, label]) => `<th class="num">${label}</th>`).join("")}<th class="num">Net</th>${ADMIN ? "" : `<th class="num">Your ${shareLabel(p.share)}</th>`}</tr></thead>
      <tbody>${p.months.map((m) => `<tr>
        <td>${escapeHtml(monthLabel(m.month))}</td>
        ${cell(m.rent)}${COSTS.map(([key]) => cost(m[key] || 0)).join("")}${cell(net(m))}${ADMIN ? "" : cell(net(m) * p.share)}
      </tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${cell(total("rent"))}${COSTS.map(([key]) => cost(total(key))).join("")}${cell(totalNet)}${ADMIN ? "" : cell(totalNet * p.share)}</tr></tfoot>
    </table></div>`;
}

function building(p) {
  return `
    <div class="two-col">
      <div>
        <div class="section-heading"><h2>The building</h2></div>
        <div class="panel"><ul class="plain-list">${p.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>
        <div class="section-heading" style="margin-top:24px"><h2>Documents</h2><p>Listed for the demo; nothing is attached yet.</p></div>
        <div class="panel"><ul class="plain-list">${p.documents.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul></div>
      </div>
      <div>
        <div class="section-heading"><h2>Maintenance</h2></div>
        <div class="panel table-scroll"><table>
          <thead><tr><th>Date</th><th>Work</th><th>Status</th><th class="num">Cost</th></tr></thead>
          <tbody>${[...p.maintenance].sort((a, b) => b.date.localeCompare(a.date)).map((w) => `<tr>
            <td style="white-space:nowrap">${escapeHtml(dateLabel(w.date))}</td>
            <td>${escapeHtml(w.item)}</td>
            <td><span class="pill ${w.status === "done" ? "pill-done" : "pill-market"}">${w.status === "done" ? "Done" : "Scheduled"}</span></td>
            <td class="num">${money(w.cost)}${w.status === "done" ? "" : " est."}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>
    </div>`;
}

function propertyView(p) {
  return `
    <a class="back-link" href="#/">← ${ADMIN ? "All properties" : "All your properties"}</a>
    <h1>${escapeHtml(p.title)}</h1>
    <p class="sub">${escapeHtml(p.kind)} · ${escapeHtml(p.neighborhood)} · ${ADMIN ? "Owners: " + escapeHtml(ownersLabel(p)) : "you own " + shareLabel(p.share)}</p>

    <section class="section">
      <div class="section-heading"><h2>Leasing</h2><p>Every ${escapeHtml(p.unitNoun)}, who is in it until when, and what is being advertised. A lease within ${OPEN_WINDOW_DAYS} days of ending is already on the leasing site.</p></div>
      ${rentRoll(p)}
    </section>

    <section class="section">
      <div class="section-heading"><h2>Net income by month</h2><p>Rent collected less every cost, for the whole property.</p></div>
      ${netChart(p)}
    </section>

    <section class="section">
      <div class="section-heading"><h2>Statement</h2><p>The same months, line by line.</p></div>
      ${statement(p)}
    </section>

    <section class="section">${building(p)}</section>`;
}

/* ---------- Wiring ---------- */

function render(data) {
  const view = document.getElementById("view");
  const match = location.hash.match(/^#\/p\/(.+)$/);
  // Only the signed-in investor's properties were ever sent, so an id that
  // isn't theirs simply isn't found.
  const p = match && data.properties.find((x) => x.id === decodeURIComponent(match[1]));
  const bMatch = location.hash.match(/^#\/b\/(.+)$/);
  const b = bMatch && (data.buildings || []).find((x) => x.id === decodeURIComponent(bMatch[1]));
  view.innerHTML = p ? propertyView(p) : b ? buildingView(b, data) : overview(data);
  window.scrollTo(0, 0);

  view.querySelectorAll("tr[data-href]").forEach((tr) =>
    tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));

  const tip = view.querySelector(".chart-tip");
  if (tip) {
    const svg = view.querySelector(".chart svg");
    svg.querySelectorAll("g[data-tip]").forEach((g) => {
      g.addEventListener("mouseenter", () => {
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        tip.textContent = g.dataset.tip;
        tip.style.left = svg.offsetLeft + Number(g.dataset.x) * scale + "px";
        tip.style.top = svg.offsetTop + Number(g.dataset.y) * scale - 8 + "px";
        tip.hidden = false;
      });
      g.addEventListener("mouseleave", () => { tip.hidden = true; });
    });
  }
}

fetch("/api/portfolio").then(async (res) => {
  if (res.status === 401) { location.href = "/login"; return; }
  const data = await res.json();
  ADMIN = Boolean(data.investor.admin);
  document.getElementById("who").textContent = data.investor.name;
  if (data.demo) {
    const banner = document.getElementById("demo-banner");
    banner.hidden = false;
    banner.querySelector("p").textContent = data.demoNote;
  }
  render(data);
  window.addEventListener("hashchange", () => render(data));
});

document.getElementById("sign-out").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});
