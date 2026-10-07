/**
 * Rental payments. The server sends only the rows this viewer may see -- every
 * payment for the admin and the team, an owner's own properties for an owner --
 * so the filters here narrow what was sent and never widen it.
 */

function money(n) {
  const s = "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Where a payment was for: the registry's address when it resolved, else what the export said. */
function propertyLabel(p) {
  const given = [p.property, p.unit].filter(Boolean).join(" ");
  return p.address || given || "";
}

let DATA = null;
const filter = { month: "", property: "" };
/** The property filter's value for payments that name no property. */
const NONE = "\u0000none";

function render() {
  const { viewer, payments } = DATA;
  const seesAll = viewer.kind !== "owner";
  const months = [...new Set(payments.map((p) => p.date.slice(0, 7)))].sort().reverse();
  const properties = [...new Set(payments.map(propertyLabel))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const unnamed = payments.some((p) => !propertyLabel(p));
  const rows = payments.filter((p) =>
    (!filter.month || p.date.slice(0, 7) === filter.month) &&
    (!filter.property || (filter.property === NONE ? !propertyLabel(p) : propertyLabel(p) === filter.property)));
  const total = rows.reduce((s, p) => s + p.amount, 0);
  const option = (value, label, current) =>
    `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`;

  document.getElementById("view").innerHTML = `
    ${viewer.kind === "team" ? "" : '<a class="back-link" href="/">← Back to overview</a>'}
    <h1>Rental payments</h1>
    <p class="sub">${seesAll
      ? "Every payment on file, from the monthly exports."
      : "Payments received for your properties."}</p>

    <div class="tiles">
      <div class="tile"><div class="tile-key">Collected${filter.month ? ", " + escapeHtml(monthLabel(filter.month)) : ""}</div><div class="tile-val">${money(total)}</div><div class="tile-note">${filter.property ? escapeHtml(filter.property === NONE ? "no property given" : filter.property) : seesAll ? "all properties" : "your properties"}</div></div>
      <div class="tile"><div class="tile-key">Payments</div><div class="tile-val">${rows.length}</div><div class="tile-note">${months.length} month${months.length === 1 ? "" : "s"} on file</div></div>
      ${seesAll ? `<div class="tile"><div class="tile-key">No owner matched</div><div class="tile-val">${DATA.unassigned}</div><div class="tile-note">seen by admin and team only</div></div>` : ""}
    </div>

    <section class="section">
      <div class="pay-filters">
        <label>Month <select id="f-month">${option("", "All months", filter.month)}${months.map((m) => option(m, monthLabel(m), filter.month)).join("")}</select></label>
        <label>Property <select id="f-property">${option("", "All properties", filter.property)}${properties.map((p) => option(p, p, filter.property)).join("")}${unnamed ? option(NONE, "No property given", filter.property) : ""}</select></label>
      </div>
      <div class="panel table-scroll">${rows.length ? `<table>
        <thead><tr><th>Date</th><th>Property</th><th>Paid by</th><th>Memo</th>${seesAll ? "<th>Owner</th>" : ""}<th class="num">Amount</th></tr></thead>
        <tbody>${rows.map((p) => `<tr${seesAll ? ` title="${escapeHtml(p.source)}"` : ""}>
          <td style="white-space:nowrap">${escapeHtml(dateLabel(p.date))}</td>
          <td>${escapeHtml(propertyLabel(p)) || '<span class="sub">Not given</span>'}${p.address && (p.property || p.unit) ? `<br /><span class="sub">${escapeHtml([p.property, p.unit].filter(Boolean).join(" "))}</span>` : ""}</td>
          <td>${escapeHtml(p.payer)}</td>
          <td>${escapeHtml([p.memo, p.method].filter(Boolean).join(" · "))}</td>
          ${seesAll ? `<td>${p.owner ? escapeHtml(p.owner) : '<span class="pill pill-market">No match</span>'}</td>` : ""}
          <td class="num${p.amount < 0 ? " neg" : ""}">${money(p.amount)}</td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="${seesAll ? 5 : 4}">Total</td><td class="num">${money(total)}</td></tr></tfoot>
      </table>` : `<p class="sub" style="padding:8px 16px">${payments.length ? "No payments match these filters." : "No payments on file yet."}</p>`}</div>
    </section>

    ${viewer.kind === "admin" ? adminSection() : ""}`;

  document.getElementById("f-month").addEventListener("change", (e) => { filter.month = e.target.value; render(); });
  document.getElementById("f-property").addEventListener("change", (e) => { filter.property = e.target.value; render(); });
  wireUpload();
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
        <thead><tr><th>File</th><th class="num">Payments read</th><th>Note</th></tr></thead>
        <tbody>${files.map((f) => `<tr><td>${escapeHtml(f.name)}</td><td class="num">${f.rows}</td><td>${f.problem ? escapeHtml(f.problem) : ""}</td></tr>`).join("")}</tbody>
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
