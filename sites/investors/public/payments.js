/**
 * Rental payments. The server sends only the rows this viewer may see -- every
 * payment for the admin and the team, an owner's own properties for an owner --
 * so the filters here narrow what was sent and never widen it.
 */

function money(n) {
  const s = "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? "−" + s : s;
}

/** To the nearest dollar, for the summary grid, where cents would crowd the columns. */
function dollars(n) {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? "−" + s : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Dates stay as YYYY-MM-DD strings, as on the rest of the site. */
function dateLabel(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function monthLabel(ym) {
  if (!ym) return "No date";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * The building a payment was for, as the export wrote it: CoStar gives the
 * address and the unit separately, so the street (before the first comma) is
 * the building and the unit is shown on the row. "" when no property was given.
 */
function addressOf(p) {
  return (p.property.split(",")[0] || "").trim();
}

/** The rest of the export's address -- city, state, zip -- for under the street. */
function cityOf(p) {
  return p.property.split(",").slice(1).map((x) => x.trim()).filter((x) => x && x !== "US").join(", ");
}

const NO_ADDRESS = "No property given";

/** "Jan ’26": short enough for a column per month. */
function shortMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
}

/** "Updated Oct 7, 2026 · payments through Oct 6, 2026", from the newest export. */
function updatedLine(u) {
  if (!u || !u.addedAt) return "";
  const added = new Date(u.addedAt);
  const pad = (n) => String(n).padStart(2, "0");
  const addedIso = `${added.getFullYear()}-${pad(added.getMonth() + 1)}-${pad(added.getDate())}`;
  return `<p class="updated">Last updated ${escapeHtml(dateLabel(addedIso))}${u.through ? ` · payments through ${escapeHtml(dateLabel(u.through))}` : ""}</p>`;
}

let DATA = null;
const filter = { month: "", address: "" };

function render() {
  const { viewer, payments } = DATA;
  const seesAll = viewer.kind !== "owner";
  const addr = (p) => addressOf(p) || NO_ADDRESS;
  const monthOf = (p) => p.date.slice(0, 7);
  const months = [...new Set(payments.map(monthOf))].sort();
  const addresses = [...new Set(payments.map(addr))].sort((a, b) =>
    a === NO_ADDRESS ? 1 : b === NO_ADDRESS ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  const rows = payments.filter((p) =>
    (!filter.month || monthOf(p) === filter.month) && (!filter.address || addr(p) === filter.address));
  const total = rows.reduce((s, p) => s + p.amount, 0);
  const option = (value, label, current) =>
    `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`;

  document.getElementById("view").innerHTML = `
    ${viewer.kind === "team" ? "" : '<a class="back-link" href="/">← Back to overview</a>'}
    <h1>Rental payments</h1>
    <p class="sub">${seesAll
      ? "Every payment on file, from the monthly exports."
      : "Payments received for your properties."}</p>
    ${updatedLine(DATA.updated)}

    <div class="tiles">
      <div class="tile"><div class="tile-key">Collected${filter.month ? ", " + escapeHtml(monthLabel(filter.month)) : ""}</div><div class="tile-val">${money(total)}</div><div class="tile-note">${filter.address ? escapeHtml(filter.address) : seesAll ? "all properties" : "your properties"}</div></div>
      <div class="tile"><div class="tile-key">Payments</div><div class="tile-val">${rows.length}</div><div class="tile-note">${addresses.length} address${addresses.length === 1 ? "" : "es"} · ${months.length} month${months.length === 1 ? "" : "s"} on file</div></div>
      ${seesAll ? `<div class="tile"><div class="tile-key">No owner matched</div><div class="tile-val">${DATA.unassigned}</div><div class="tile-note">seen by admin and team only</div></div>` : ""}
    </div>

    ${payments.length ? summary(payments, addresses, months, addr, monthOf) : ""}

    <section class="section">
      <div class="section-heading"><h2>Payments by address</h2><p>Each payment, grouped by the address it was for.</p></div>
      <div class="pay-filters">
        <label>Month <select id="f-month">${option("", "All months", filter.month)}${[...months].reverse().map((m) => option(m, monthLabel(m), filter.month)).join("")}</select></label>
        <label>Address <select id="f-address">${option("", "All addresses", filter.address)}${addresses.map((a) => option(a, a, filter.address)).join("")}</select></label>
        ${filter.month || filter.address ? '<button class="btn btn-quiet" id="f-clear" type="button">Show all</button>' : ""}
      </div>
      ${rows.length ? addresses.filter((a) => rows.some((p) => addr(p) === a)).map((a) => group(a, rows.filter((p) => addr(p) === a), seesAll)).join("")
        : `<div class="panel"><p class="sub" style="padding:8px 16px">${payments.length ? "No payments match these filters." : "No payments on file yet."}</p></div>`}
    </section>

    ${viewer.kind === "admin" ? adminSection() : ""}`;

  const view = document.getElementById("view");
  document.getElementById("f-month").addEventListener("change", (e) => { filter.month = e.target.value; render(); });
  document.getElementById("f-address").addEventListener("change", (e) => { filter.address = e.target.value; render(); });
  document.getElementById("f-clear")?.addEventListener("click", () => { filter.month = ""; filter.address = ""; render(); });
  // A cell in the summary narrows the list below to that address and month.
  view.querySelectorAll("[data-cell]").forEach((el) => el.addEventListener("click", () => {
    filter.address = el.dataset.address || "";
    filter.month = el.dataset.month || "";
    render();
    document.getElementById("f-month").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  wireUpload();
}

/** Address down the side, month across the top, the amount collected in each. */
function summary(payments, addresses, months, addr, monthOf) {
  const sum = (ps) => ps.reduce((s, p) => s + p.amount, 0);
  const cell = (ps, address, month, cls = "") => ps.length
    ? `<td class="num${cls}"><button class="cell-link" type="button" data-cell data-address="${escapeHtml(address)}" data-month="${month}" title="${money(sum(ps))} · ${ps.length} payment${ps.length === 1 ? "" : "s"}">${dollars(sum(ps))}</button></td>`
    : `<td class="num empty${cls}">—</td>`;
  return `
    <section class="section">
      <div class="section-heading"><h2>Summary by address and month</h2><p>Collected at each address in each month, by payment date, to the nearest dollar. Select an amount to see its payments.</p></div>
      <div class="panel table-scroll"><table class="pivot">
        <thead><tr><th>Address</th>${months.map((m) => `<th class="num">${escapeHtml(shortMonth(m))}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${addresses.map((a) => {
          const here = payments.filter((p) => addr(p) === a);
          return `<tr><td>${escapeHtml(a)}</td>${months.map((m) => cell(here.filter((p) => monthOf(p) === m), a, m)).join("")}${cell(here, a, "", " row-total")}</tr>`;
        }).join("")}</tbody>
        <tfoot><tr><td>All addresses</td>${months.map((m) => cell(payments.filter((p) => monthOf(p) === m), "", m)).join("")}${cell(payments, "", "", " row-total")}</tr></tfoot>
      </table></div>
    </section>`;
}

/** One address's payments, with its subtotal. */
function group(address, ps, seesAll) {
  const sum = ps.reduce((s, p) => s + p.amount, 0);
  const city = ps.map(cityOf).find(Boolean);
  return `
    <div class="panel table-scroll pay-group">
      <div class="pay-group-head"><div><strong>${escapeHtml(address)}</strong>${city ? ` <span class="sub">${escapeHtml(city)}</span>` : ""}</div><div class="sub">${ps.length} payment${ps.length === 1 ? "" : "s"} · <span class="pay-group-total">${money(sum)}</span></div></div>
      <table>
        <thead><tr><th>Date</th><th>Unit</th><th>Paid by</th><th>Memo</th>${seesAll ? "<th>Owner</th>" : ""}<th class="num">Amount</th></tr></thead>
        <tbody>${ps.map((p) => `<tr${seesAll ? ` title="${escapeHtml(p.source)}"` : ""}>
          <td style="white-space:nowrap">${escapeHtml(dateLabel(p.date))}</td>
          <td>${escapeHtml(p.unit)}</td>
          <td>${escapeHtml(p.payer)}</td>
          <td>${escapeHtml([p.memo, p.method].filter(Boolean).join(" · "))}${p.status ? ` <span class="pill pill-market">${escapeHtml(p.status)}</span>` : ""}</td>
          ${seesAll ? `<td>${p.owner ? escapeHtml(p.owner) : '<span class="pill pill-market">No match</span>'}</td>` : ""}
          <td class="num${p.amount < 0 ? " neg" : ""}">${money(p.amount)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

/**
 * The admin adds each month's export here. Files are kept as uploaded and
 * never overwritten; a payment in two overlapping exports counts once.
 */
function adminSection() {
  const files = DATA.files || [];
  return `
    <section class="section">
      <div class="section-heading"><h2>Add a month's export</h2><p>A CSV with a header row. Columns are found by name: date, amount, payer or tenant, property or address, unit, memo. An owner sees a payment only when its property matches one owner on your owner list; anything else stays with you and the team.</p></div>
      <form class="panel upload-form" id="pay-upload">
        <input type="file" name="files" accept=".csv,text/csv" multiple />
        <div class="upload-actions"><button class="btn btn-primary" type="submit" style="width:auto;margin:0">Add</button><span id="pay-status" role="status"></span></div>
      </form>
      <div class="section-heading" style="margin-top:20px"><h2>Exports on file</h2></div>
      <div class="panel table-scroll">${files.length ? `<table>
        <thead><tr><th>File</th><th>Added</th><th>Payments through</th><th class="num">Payments read</th><th>Note</th></tr></thead>
        <tbody>${files.map((f) => `<tr><td>${escapeHtml(f.name)}</td><td style="white-space:nowrap">${escapeHtml(new Date(f.addedAt).toLocaleString())}</td><td style="white-space:nowrap">${escapeHtml(dateLabel(f.through))}</td><td class="num">${f.rows}</td><td>${f.problem ? escapeHtml(f.problem) : ""}</td></tr>`).join("")}</tbody>
      </table>` : '<p class="sub" style="padding:8px 16px">None yet.</p>'}</div>
    </section>`;
}

function wireUpload() {
  const form = document.getElementById("pay-upload");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("pay-status");
    status.textContent = "Adding…";
    const res = await fetch("/api/admin/payments", { method: "POST", body: new FormData(form) });
    const body = await res.json();
    if (!res.ok) { status.textContent = body.error; return; }
    await load();
    document.getElementById("pay-status").textContent = `Added ${body.saved.join(", ")}.`;
  });
}

async function load() {
  const res = await fetch("/api/payments");
  if (res.status === 401) { location.href = "/login"; return; }
  DATA = await res.json();
  document.getElementById("who").textContent = DATA.viewer.name;
  // A team member has no overview to go back to.
  if (DATA.viewer.kind === "team") document.getElementById("home").href = "/payments";
  render();
}

load();

document.getElementById("sign-out").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});
