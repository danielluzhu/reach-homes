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

/**
 * Months a payment can count in besides the calendar ones: last-month rent
 * paid in advance for a month after the newest payment on file, and that for
 * a lease whose end isn't known yet.
 */
const LATER = "later";
const UNKNOWN = "unknown";

function monthLabel(ym) {
  if (ym === LATER) return "Later months";
  if (ym === UNKNOWN) return "Lease end not known";
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

/** City, state and zip, for under the street. */
function cityOf(p) {
  return p.city || "";
}

const NO_ADDRESS = "No property given";

/**
 * A unit as the lease is known: "#306" for a numbered unit, "L" or "U2" or
 * "Lower Private 3 Beds" as written otherwise. "" for a whole house.
 */
function unitLabel(p) {
  const u = p.unit.trim().replace(/^#\s*/, "");
  return !u ? "" : /^\d/.test(u) ? "#" + u : u;
}

/**
 * The lease a payment belongs to: the address and the unit. Each lease has
 * one owner -- 121 12th Ave is several units with several owners, so it is
 * several leases, never one building's worth.
 */
function leaseOf(p) {
  if (p.lease) return p.lease;
  const a = p.building || addressOf(p);
  return a ? [a, unitLabel(p)].filter(Boolean).join(" ") : NO_ADDRESS;
}

/** "Jan ’26": short enough for a column per month. */
function shortMonth(ym) {
  if (ym === LATER) return "Later";
  if (ym === UNKNOWN) return "End unknown";
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
/** Which view of the payments below the summary: grouped by lease, or the combined log. */
let VIEW = location.hash === "#log" ? "log" : "lease";

function render() {
  const { viewer, payments } = DATA;
  const seesAll = viewer.kind !== "owner";
  const addr = leaseOf;
  // Every payment on a lease resolves to the same owner: the match is made
  // from the address and unit, which is what makes it one lease.
  const ownerOf = new Map(payments.map((p) => [addr(p), p.owner]));
  // A payment counts in the month it pays for: the month it was paid, except
  // last-month rent paid in advance, which the server places in the lease's
  // final month. Months after the newest payment are gathered as "later".
  const newest = payments.reduce((m, p) => (p.date > m ? p.date : m), "").slice(0, 7);
  const monthOf = (p) => (p.appliesTo === "" ? UNKNOWN : p.appliesTo > newest ? LATER : p.appliesTo || p.date.slice(0, 7));
  const buckets = new Set(payments.map(monthOf));
  const months = [...buckets].filter((m) => m !== LATER && m !== UNKNOWN).sort()
    .concat(buckets.has(LATER) ? [LATER] : [], buckets.has(UNKNOWN) ? [UNKNOWN] : []);
  const ahead = payments.filter((p) => p.allocation?.kind === "last-month" && monthOf(p) !== p.date.slice(0, 7) && (monthOf(p) === LATER || monthOf(p) === UNKNOWN));
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
      <div class="tile"><div class="tile-key">Payments</div><div class="tile-val">${rows.length}</div><div class="tile-note">${addresses.length} lease${addresses.length === 1 ? "" : "s"} · ${months.filter((m) => m !== LATER && m !== UNKNOWN).length} months on file</div></div>
      ${ahead.length ? `<div class="tile"><div class="tile-key">Last-month rent held</div><div class="tile-val">${money(ahead.reduce((s, p) => s + p.amount, 0))}</div><div class="tile-note">${ahead.length} prepayment${ahead.length === 1 ? "" : "s"} for later months, or leases whose end isn't known</div></div>` : ""}
      ${seesAll ? `<div class="tile"><div class="tile-key">No owner matched</div><div class="tile-val">${DATA.unassigned}</div><div class="tile-note">seen by admin and team only</div></div>` : ""}
    </div>

    ${payments.length ? summary(payments, addresses, months, addr, monthOf, seesAll && ownerOf) : ""}

    <section class="section">
      <div class="section-heading"><h2>Payments</h2><p>${VIEW === "log"
        ? "Every payment from every platform in one log, newest first. Select a row for everything the platform's export said about it."
        : "Each payment, grouped by the lease it was for: the address and unit."}</p></div>
      <div class="view-tabs" role="tablist">
        <button type="button" role="tab" data-view="lease" aria-selected="${VIEW === "lease"}">By lease</button>
        <button type="button" role="tab" data-view="log" aria-selected="${VIEW === "log"}">Combined log</button>
        ${VIEW === "log" ? '<button type="button" class="btn btn-quiet" id="log-csv">Download CSV</button>' : ""}
      </div>
      <div class="pay-filters">
        <label>Month <select id="f-month">${option("", "All months", filter.month)}${[...months].reverse().map((m) => option(m, monthLabel(m), filter.month)).join("")}</select></label>
        <label>Lease <select id="f-address">${option("", "All leases", filter.address)}${addresses.map((a) => option(a, a, filter.address)).join("")}</select></label>
        ${filter.month || filter.address ? '<button class="btn btn-quiet" id="f-clear" type="button">Show all</button>' : ""}
      </div>
      ${!rows.length ? `<div class="panel"><p class="sub" style="padding:8px 16px">${payments.length ? "No payments match these filters." : "No payments on file yet."}</p></div>`
        : VIEW === "log" ? log(rows, addr, seesAll)
        : addresses.filter((a) => rows.some((p) => addr(p) === a)).map((a) => group(a, rows.filter((p) => addr(p) === a), seesAll ? ownerOf.get(a) : undefined)).join("")}
    </section>

    ${viewer.kind === "admin" ? adminSection() : ""}`;

  const view = document.getElementById("view");
  document.getElementById("f-month").addEventListener("change", (e) => { filter.month = e.target.value; render(); });
  document.getElementById("f-address").addEventListener("change", (e) => { filter.address = e.target.value; render(); });
  document.getElementById("f-clear")?.addEventListener("click", () => { filter.month = ""; filter.address = ""; render(); });
  view.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { VIEW = b.dataset.view; history.replaceState(null, "", VIEW === "log" ? "#log" : location.pathname); render(); }));
  // A log row opens to show every column of the export's row beneath it.
  view.querySelectorAll(".log-row").forEach((tr) => tr.addEventListener("click", () => {
    const row = tr.nextElementSibling;
    row.hidden = !row.hidden;
    tr.setAttribute("aria-expanded", String(!row.hidden));
  }));
  document.getElementById("log-csv")?.addEventListener("click", () => downloadLog(rows, addr, seesAll));
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
function summary(payments, addresses, months, addr, monthOf, ownerOf) {
  const sum = (ps) => ps.reduce((s, p) => s + p.amount, 0);
  const cell = (ps, address, month, cls = "") => ps.length
    ? `<td class="num${cls}"><button class="cell-link" type="button" data-cell data-address="${escapeHtml(address)}" data-month="${month}" title="${money(sum(ps))} · ${ps.length} payment${ps.length === 1 ? "" : "s"}">${dollars(sum(ps))}</button></td>`
    : `<td class="num empty${cls}">—</td>`;
  return `
    <section class="section">
      <div class="section-heading"><h2>Summary by lease and month</h2><p>Collected on each lease — each address and unit — in the month each payment is for, to the nearest dollar. Last-month rent paid in advance counts in the lease's final month: under "Later" when that is after the newest payment, under "End unknown" until the lease's end is known. Select an amount to see its payments.</p></div>
      <div class="panel table-scroll"><table class="pivot">
        <thead><tr><th>Lease</th>${ownerOf ? "<th>Owner</th>" : ""}${months.map((m) => `<th class="num">${escapeHtml(shortMonth(m))}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${addresses.map((a) => {
          const here = payments.filter((p) => addr(p) === a);
          const owner = ownerOf && ownerOf.get(a);
          return `<tr><td>${escapeHtml(a)}</td>${ownerOf ? `<td>${owner ? escapeHtml(owner) : '<span class="pill pill-market">No match</span>'}</td>` : ""}${months.map((m) => cell(here.filter((p) => monthOf(p) === m), a, m)).join("")}${cell(here, a, "", " row-total")}</tr>`;
        }).join("")}</tbody>
        <tfoot><tr><td>All leases</td>${ownerOf ? "<td></td>" : ""}${months.map((m) => cell(payments.filter((p) => monthOf(p) === m), "", m)).join("")}${cell(payments, "", "", " row-total")}</tr></tfoot>
      </table></div>
    </section>`;
}

/**
 * One lease's payments, with its subtotal. `owner` is given to the admin and
 * team only: undefined for an owner, who sees just their own leases.
 */
function group(address, ps, owner) {
  const sum = ps.reduce((s, p) => s + p.amount, 0);
  const city = ps.map(cityOf).find(Boolean);
  return `
    <div class="panel table-scroll pay-group">
      <div class="pay-group-head"><div><strong>${escapeHtml(address)}</strong>${city ? ` <span class="sub">${escapeHtml(city)}</span>` : ""}${owner === undefined ? "" : ` · ${owner ? `Owner: ${escapeHtml(owner)}` : '<span class="pill pill-market">No owner matched</span>'}`}</div><div class="sub">${ps.length} payment${ps.length === 1 ? "" : "s"} · <span class="pay-group-total">${money(sum)}</span></div></div>
      <table>
        <thead><tr><th>Date</th><th>Platform</th><th>Paid by</th><th>Memo</th><th class="num">Amount</th></tr></thead>
        <tbody>${ps.map((p) => `<tr${p.source ? ` title="${escapeHtml(p.source)}"` : ""}>
          <td style="white-space:nowrap">${escapeHtml(dateLabel(p.date))}</td>
          <td>${escapeHtml(p.platform)}</td>
          <td>${escapeHtml(p.payer)}</td>
          <td>${escapeHtml([p.category, p.memo, p.method].filter(Boolean).join(" · "))}${p.status ? ` <span class="pill pill-market">${escapeHtml(p.status)}</span>` : ""}${allocationPill(p)}</td>
          <td class="num${p.amount < 0 ? " neg" : ""}">${money(p.amount)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

/** Where a payment counts, when that isn't the month it was paid; why, on hover. */
function allocationPill(p) {
  const a = p.allocation;
  if (!a) return "";
  const text = a.kind === "combined" ? "First + last month, not split"
    : p.appliesTo ? `Last month's rent → ${monthLabel(p.appliesTo)}` : "Last month's rent → lease end not known";
  return ` <span class="pill ${a.kind === "combined" || !p.appliesTo ? "pill-market" : "pill-vacant"}" title="${escapeHtml(a.basis)}">${escapeHtml(text)}</span>`;
}

/**
 * Every payment from every platform, newest first, in one table. The columns
 * are the ones the platforms share; each row's details hold the rest -- every
 * column of the export's row, exactly as it was given.
 */
function log(rows, addr, seesAll) {
  const total = rows.reduce((s, p) => s + p.amount, 0);
  return `
    <div class="panel table-scroll"><table class="log">
      <thead><tr><th>Date</th><th>Platform</th><th>Lease</th>${seesAll ? "<th>Owner</th>" : ""}<th>Paid by</th><th>For</th><th>Memo</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="clickable log-row" aria-expanded="false" title="Show everything the export said">
        <td style="white-space:nowrap">${escapeHtml(dateLabel(p.date))}</td>
        <td>${escapeHtml(p.platform)}</td>
        <td class="lease-cell">${escapeHtml(addr(p))}</td>
        ${seesAll ? `<td>${p.owner ? escapeHtml(p.owner) : '<span class="pill pill-market">No match</span>'}</td>` : ""}
        <td>${escapeHtml(p.payer)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${escapeHtml([p.memo, p.method].filter(Boolean).join(" · "))}${p.status ? ` <span class="pill pill-market">${escapeHtml(p.status)}</span>` : ""}${allocationPill(p)}</td>
        <td class="num${p.amount < 0 ? " neg" : ""}">${money(p.amount)}</td>
      </tr>
      <tr class="fields-row" hidden><td colspan="${seesAll ? 8 : 7}"><dl class="fields">${Object.entries(p.fields).map(([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${v ? escapeHtml(v) : '<span class="sub">—</span>'}</dd>`).join("")}${p.source ? `<dt>File</dt><dd>${escapeHtml(p.source)}</dd>` : ""}</dl></td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="${seesAll ? 7 : 6}">Total, ${rows.length} payment${rows.length === 1 ? "" : "s"}</td><td class="num">${money(total)}</td></tr></tfoot>
    </table></div>`;
}

/**
 * The log as a spreadsheet: the shared columns first, then every column any
 * platform's export had, blank where a platform has no such column. Built
 * from what the server already sent, so it holds no more than the page does.
 */
function downloadLog(rows, addr, seesAll) {
  const own = ["Date", "Counts in", "Allocation", "Platform", "Lease", ...(seesAll ? ["Owner"] : []), "Paid by", "For", "Memo", "Status", "Amount"];
  const extra = [...new Set(rows.flatMap((p) => Object.keys(p.fields)))];
  const cell = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [[...own, ...extra.map((k) => k)].map(cell).join(",")];
  for (const p of rows) {
    const mine = [p.date, p.appliesTo === "" ? "lease end not known" : p.appliesTo || p.date.slice(0, 7), p.allocation ? p.allocation.basis : "", p.platform, addr(p), ...(seesAll ? [p.owner || ""] : []), p.payer, p.category, p.memo, p.status || "Paid", p.amount.toFixed(2)];
    lines.push([...mine, ...extra.map((k) => p.fields[k] ?? "")].map(cell).join(","));
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `payment-log-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
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
