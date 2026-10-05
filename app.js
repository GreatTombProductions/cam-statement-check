/* CAM Statement Check — page wiring. All arithmetic lives in engine.js. */
"use strict";

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function money(x) {
  if (x == null) return "—";
  const sign = x < 0 ? "−" : "";
  return sign + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const pct = (x) => (Math.round(x * 1e6) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 4 }) + "%";

function num(id) {
  const v = $(id).value.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
const radio = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;

/* ------------------------------------------------------------- line rows */

let lineSeq = 0;
const TREATMENTS = [["recoverable", "Recoverable"], ["excluded", "Lease excludes it"], ["unsure", "Not sure"]];

function addLine(data = {}) {
  lineSeq += 1;
  const id = "L" + lineSeq;
  const sel = (opts, value, label) => el("select", { "aria-label": label }, opts.map(([v, t]) => el("option", { value: v, text: t, selected: v === value })));
  const check = (on, label) => el("input", { type: "checkbox", "aria-label": label, checked: !!on });
  const row = el("tr", { "data-id": id }, [
    el("td", {}, el("input", { type: "text", class: "f-label", "aria-label": "Line name", value: data.label || "", placeholder: "e.g. Landscaping" })),
    el("td", {}, el("input", { type: "number", class: "f-amount", min: "0", step: "0.01", inputmode: "decimal", "aria-label": "Amount", value: data.amount != null ? String(data.amount) : "" })),
    el("td", {}, sel([["expense", "Expense"], ["fee", "Management / admin fee"]], data.kind || "expense", "Line type")),
    el("td", {}, sel(TREATMENTS, data.treatment || "recoverable", "Treatment under the lease")),
    el("td", {}, el("input", { type: "text", class: "f-clause", "aria-label": "Lease section", value: data.clause || "", placeholder: "e.g. 6.3(b)" })),
    el("td", { class: "c" }, check(data.variable, "Variable")),
    el("td", { class: "c" }, check(data.controllable, "Controllable")),
    el("td", { class: "c" }, check(data.in_fee_base, "In fee base")),
    el("td", {}, el("button", { type: "button", class: "btn tiny", "aria-label": "Remove line", text: "×", onclick: () => { row.remove(); update(); } })),
  ]);
  $("lineTable").querySelector("tbody").append(row);
  return row;
}

function readLines() {
  return [...$("lineTable").querySelectorAll("tbody tr")].map((tr) => {
    const [kindSel, treatSel] = tr.querySelectorAll("select");
    const checks = tr.querySelectorAll('input[type="checkbox"]');
    const amountRaw = tr.querySelector(".f-amount").value.trim();
    const amount = amountRaw === "" ? null : Number(amountRaw);
    const kind = kindSel.value;
    return {
      id: tr.dataset.id,
      label: tr.querySelector(".f-label").value.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      kind,
      treatment: treatSel.value,
      clause: tr.querySelector(".f-clause").value.trim(),
      variable: kind === "expense" && checks[0].checked,
      controllable: kind === "expense" && checks[1].checked,
      in_fee_base: kind === "expense" && checks[2].checked,
    };
  });
}

/* --------------------------------------------------------------- inputs */

function readInput() {
  const structure = radio("structure");
  const basis = radio("shareBasis");
  const capMethod = $("capMethod").value;
  const opt = (x) => (x == null ? undefined : x);
  return {
    lease: {
      structure,
      share: { basis, tenant_rsf: num("tenantRsf"), denominator_rsf: num("denomRsf"), fixed_pct: num("fixedPct") },
      base_year_pool: num("baseYearPool"),
      expense_stop_psf: num("stopPsf"),
      gross_up: { mode: $("grossUpMode").value, target_pct: num("guTarget"), actual_pct: num("guActual") },
      fee: { enabled: $("feeEnabled").checked, cap_pct: num("feeCap") },
      cap: {
        enabled: $("capEnabled").checked, method: capMethod, rate_pct: num("capRate"),
        prior_allowed: num("capPrior"), base_amount: num("capBase"),
        years_since_base: num("capYears"), includes_fee: $("capIncludesFee").checked,
      },
    },
    lines: readLines(),
    statement: { tenant_charge: num("stmtCharge"), estimates_paid: opt(num("stmtPaid")), share_pct: opt(num("stmtShare")) },
  };
}

function syncVisibility() {
  const structure = radio("structure");
  const basis = radio("shareBasis");
  const on = new Set([basis, structure]);
  if (structure === "expense_stop") on.add("stop");
  if ($("grossUpMode").value === "recompute") on.add("gu-recompute");
  if ($("feeEnabled").checked) on.add("fee");
  if ($("capEnabled").checked) on.add("cap");
  on.add($("capMethod").value === "yoy" ? "cap-yoy" : "cap-base");
  document.querySelectorAll("[data-show]").forEach((node) => {
    node.hidden = !node.dataset.show.split(" ").some((k) => on.has(k));
  });
}

/* -------------------------------------------------------------- results */

const STRUCTURE_LABEL = { net: "your share of the pool", base_year: "your share of the increase over the base year", expense_stop: "your share above the expense stop" };
const CAP_LABEL = { yoy: "last year's allowable amount plus the cap", compound: "base-year amount compounded by the cap", simple: "base-year amount plus the cap times years, not compounded" };

function verdictText(r) {
  if (r.verdict === "above") return ["bad", `The statement charges ${money(r.difference_high)} more than your lease terms produce, even counting every "Not sure" line as recoverable.`];
  if (r.verdict === "below") return ["warn", `The statement charges ${money(-r.difference_low)} less than your lease terms produce, even leaving out every "Not sure" line. Check your entries first. If they are right, the landlord may correct this later.`];
  if (r.verdict === "matches") return ["good", "The statement matches what your lease terms produce, within $1."];
  return ["warn", `The statement falls between ${money(r.low.tenant)} and ${money(r.high.tenant)}, the range your lease terms produce. Whether it is right depends on the "Not sure" lines.`];
}

function findingText(f) {
  switch (f.type) {
    case "share": return `Share: the statement applies ${pct(f.statement_pct)}, but your lease's definition gives ${pct(f.lease_pct)}. Ask which square footage (or percentage) was used and why.`;
    case "excluded": return `"${f.label || "Unnamed line"}" (${money(f.amount)}${f.clause ? ", lease section " + f.clause : ""}): you marked it excluded by your lease. At your share it adds about ${money(f.at_share)}.`;
    case "unsure": return `"${f.label || "Unnamed line"}" (${money(f.amount)}): you aren't sure your lease allows it. About ${money(f.at_share)} at your share depends on it.`;
    case "fee": return `Management fee: ${money(f.charged)} charged, but ${pct(f.cap_pct)} of the ${money(f.base)} fee base allows ${money(f.allowed)}.`;
    case "gross_up": return `Gross-up: variable lines were raised by a factor of ${f.factor.toFixed(4)} (${pct(f.target_pct)} named occupancy ÷ ${pct(f.actual_pct)} actual). Ask for the occupancy figure the landlord used and which lines it grossed up.`;
    case "gross_up_unverified": return "Gross-up: you entered amounts that are already grossed up, so this page cannot check the gross-up. Ask for the actual (pre-gross-up) amounts and the occupancy used.";
    case "cap": return `Cap: controllable expenses at your share come to ${money(f.controllable)}, above the ${money(f.limit)} limit (${CAP_LABEL[f.method]}).`;
    case "cap_not_modeled": return "Cap: this page applies controllable-expense caps only to net leases. Your base-year or expense-stop result is shown without the cap.";
    default: return "";
  }
}

function renderResults(r, input) {
  const area = $("resultArea");
  area.replaceChildren();
  const [cls, text] = verdictText(r);
  area.append(el("div", { class: "verdict " + cls, id: "verdict" }, el("p", { text })));

  const ranged = Math.abs(r.high.tenant - r.low.tenant) > 0.005;
  const row = (label, lo, hi, note) => el("tr", {}, [
    el("th", { scope: "row", text: label }),
    el("td", { class: "num", text: lo }),
    ranged ? el("td", { class: "num", text: hi }) : null,
    el("td", { class: "note", text: note || "" }),
  ]);
  const head = el("tr", {}, [el("th", { text: "" }), el("th", { class: "num", text: ranged ? 'Without "Not sure" lines' : "Under your lease" }), ranged ? el("th", { class: "num", text: 'With "Not sure" lines' }) : null, el("th", { text: "" })]);
  const L = r.low, H = r.high;
  const feeNote = L.fee_allowed != null ? `charged ${money(H.fee_charged)}; your lease allows ${pct(input.lease.fee.cap_pct)} of the fee base` : "as charged";
  const rows = [
    row("Recoverable expenses" + (L.gross_up_factor !== 1 ? " (variable lines grossed up)" : ""), money(L.pool_expenses), money(H.pool_expenses), "whole building, after exclusions"),
    row("Management / admin fee counted", money(L.fee_used), money(H.fee_used), feeNote),
    row("Expense pool", money(L.pool), money(H.pool), ""),
    row("Your share", pct(L.share * 100), pct(H.share * 100), input.lease.share.basis === "rsf" ? "your square feet ÷ the lease's divisor" : "as stated in your lease"),
    row("Before any cap", money(L.gross), money(H.gross), STRUCTURE_LABEL[input.lease.structure]),
  ];
  if (L.cap && L.cap.applied) rows.push(row("Cap reduction", money(-L.cap.excess), money(-H.cap.excess), `limit ${money(L.cap.limit)} on controllable expenses at your share`));
  rows.push(el("tr", { class: "total" }, [el("th", { scope: "row", text: "Your share under your lease" }), el("td", { class: "num", text: money(L.tenant) }), ranged ? el("td", { class: "num", text: money(H.tenant) }) : null, el("td", {})]));
  rows.push(row("The statement charges", money(r.charge), money(r.charge), ""));
  rows.push(row("Statement minus your lease's result", money(r.difference_low), money(r.difference_high), "positive = the statement is higher"));
  if (r.balance_low != null) {
    rows.push(row("Balance after your estimated payments — your lease", money(r.balance_low), money(r.balance_high), "negative = credit owed to you"));
    rows.push(row("Balance after your estimated payments — statement", money(r.statement_balance), money(r.statement_balance), ""));
  }
  area.append(el("div", { class: "table-wrap" }, el("table", { class: "bridge" }, [el("thead", {}, head), el("tbody", {}, rows)])));

  if (r.findings.length) {
    area.append(el("h3", { text: "Where the statement and your lease terms meet questions" }));
    area.append(el("ul", { class: "findings" }, r.findings.map((f) => el("li", { class: "finding " + f.type, text: findingText(f) }))));
  } else {
    area.append(el("p", { class: "hint", text: "No exclusions, uncertain lines, fee, gross-up or cap questions in what you entered." }));
  }
}

function renderProblems(problems) {
  const area = $("resultArea");
  area.replaceChildren(
    el("div", { class: "verdict pending" }, [
      el("p", { text: "Not calculated yet. These inputs are missing or out of range. Nothing is assumed to be zero:" }),
      el("ul", {}, problems.map((p) => el("li", { text: p }))),
    ])
  );
}

/* -------------------------------------------------------------- request */

function filled(id, fallback) {
  const v = $(id).value.trim();
  return v || fallback;
}

function buildRequest(r, input) {
  const tenant = filled("reqTenant", "[business name]");
  const premises = filled("reqPremises", "[suite]");
  const property = filled("reqProperty", "[property]");
  const period = filled("reqPeriod", "[statement period]");
  const items = [];
  for (const f of r.findings) {
    if (f.type === "share") items.push(`Share percentage. The statement applies ${pct(f.statement_pct)}. Under the lease's definition of my share, I calculate ${pct(f.lease_pct)}. Please tell me the square footage (or percentage) used and the reason for the difference.`);
    if (f.type === "excluded") items.push(`"${f.label || "Unnamed line"}" — ${money(f.amount)}. As I read the lease${f.clause ? ` (section ${f.clause})` : ""}, this category is excluded from operating expenses. Please remove it from the reconciliation or explain why it is recoverable, with supporting invoices.`);
    if (f.type === "unsure") items.push(`"${f.label || "Unnamed line"}" — ${money(f.amount)}. Please send the invoices and a description of what this covers, so I can confirm it is recoverable under the lease.`);
    if (f.type === "fee") items.push(`Management / administrative fee — ${money(f.charged)} charged. The lease allows ${pct(f.cap_pct)}; on a fee base of ${money(f.base)} as I calculate it, that is ${money(f.allowed)}. Please show the base and percentage used.`);
    if (f.type === "gross_up") items.push(`Gross-up. Please confirm the average occupancy used for the year (I used ${pct(f.actual_pct)}), the occupancy level the expenses were grossed up to, and which expense lines were grossed up.`);
    if (f.type === "gross_up_unverified") items.push("Gross-up. Please send the actual (pre-gross-up) amount for each grossed-up line, the average occupancy used for the year, and the occupancy level used.");
    if (f.type === "cap") items.push(`Cap on controllable expenses. My share of controllable expenses comes to ${money(f.controllable)}, above the ${money(f.limit)} limit the lease's cap produces. Please show how the cap was applied.`);
  }
  items.push("General ledger detail for every line in the reconciliation, and the invoices for the lines above.");
  const lines = [
    `Re: ${period} operating-expense / CAM reconciliation — ${tenant}, ${premises}, ${property}`,
    "",
    "Hello,",
    "",
    `I have reviewed the ${period} reconciliation against the cost provisions of my lease. Before I can confirm the balance, please send the following:`,
    "",
    ...items.map((t, i) => `${i + 1}. ${t}`),
    "",
  ];
  if (r.verdict === "above") lines.push(`On the figures available to me, my share under the lease comes to ${money(r.high.tenant)}${Math.abs(r.high.tenant - r.low.tenant) > 0.005 ? " at most" : ""}, against ${money(r.charge)} on the statement.`, "");
  const clause = $("auditClause").value.trim();
  if (clause) lines.push(`I am sending this request under the review provision of my lease: "${clause}"`, "");
  lines.push("Thank you,", tenant);
  return lines.join("\n");
}

function notesText(r, input) {
  const out = ["CAM Statement Check — your notes", "Generated in your browser on " + new Date().toISOString().slice(0, 10) + ". Nothing was sent anywhere.", ""];
  out.push("RESULT", verdictText(r)[1], "");
  out.push(`Your share under your lease: ${money(r.low.tenant)}${Math.abs(r.high.tenant - r.low.tenant) > 0.005 ? " to " + money(r.high.tenant) : ""}`);
  out.push(`Statement charges: ${money(r.charge)}`, "");
  out.push("LEASE TERMS YOU ENTERED");
  const L = input.lease;
  out.push(`Structure: ${L.structure}; share basis: ${L.share.basis} (${pct(r.low.share * 100)})`);
  if (L.structure === "base_year") out.push(`Base-year expense total: ${money(L.base_year_pool)}`);
  if (L.structure === "expense_stop") out.push(`Expense stop: ${money(L.expense_stop_psf)}/SF over ${L.share.denominator_rsf} SF`);
  out.push(`Gross-up: ${L.gross_up.mode}${L.gross_up.mode === "recompute" ? ` (${L.gross_up.target_pct}% named, ${L.gross_up.actual_pct}% actual)` : ""}`);
  out.push(`Fee limit: ${L.fee.enabled ? L.fee.cap_pct + "% of fee base" : "none entered"}`);
  out.push(`Controllable cap: ${L.cap.enabled ? `${L.cap.rate_pct}% (${L.cap.method})` : "none entered"}`);
  out.push("", "STATEMENT LINES YOU ENTERED");
  for (const l of input.lines) out.push(`- ${l.label || "(unnamed)"}: ${money(l.amount)} — ${l.kind}, ${l.treatment}${l.clause ? ", section " + l.clause : ""}${l.variable ? ", variable" : ""}${l.controllable ? ", controllable" : ""}${l.in_fee_base ? ", in fee base" : ""}`);
  out.push("", "QUESTIONS");
  for (const f of r.findings) out.push("- " + findingText(f));
  out.push("", "DRAFT REQUEST", buildRequest(r, input), "");
  out.push("LIMITS", "Arithmetic on the lease terms and statement lines you entered. It is not legal advice and not a formal notice. Your lease's notice clause governs how, where and when to object.");
  return out.join("\n");
}

/* ----------------------------------------------------------------- main */

let last = null;

function update() {
  syncVisibility();
  const input = readInput();
  try {
    const r = check(input);
    last = { r, input };
    renderResults(r, input);
    $("requestSection").hidden = false;
    $("requestText").value = buildRequest(r, input);
    $("requestPrint").textContent = $("requestText").value;
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    last = null;
    renderProblems(err.problems);
    $("requestSection").hidden = true;
  }
}

const EXAMPLE = {
  fields: { tenantRsf: 2000, denomRsf: 50000, guTarget: 95, guActual: 80, feeCap: 10, capRate: 5, capBase: 3600, capYears: 3, stmtShare: 4.2, stmtCharge: 12400, stmtPaid: 9000 },
  lines: [
    { label: "Landscaping", amount: 30000, controllable: true, in_fee_base: true },
    { label: "Janitorial", amount: 60000, variable: true, controllable: true, in_fee_base: true },
    { label: "Real estate taxes", amount: 100000 },
    { label: "Property insurance", amount: 40000 },
    { label: "Roof replacement", amount: 48000, treatment: "excluded", clause: "6.3(b) capital expenditures", in_fee_base: true },
    { label: "Parking lot resurfacing", amount: 20000, treatment: "unsure" },
    { label: "Management fee", amount: 16000, kind: "fee" },
  ],
};

function clearAll() {
  document.querySelectorAll("main input[type=number], main input[type=text], main textarea").forEach((n) => { n.value = ""; });
  document.querySelectorAll("main input[type=checkbox]").forEach((n) => { n.checked = false; });
  document.querySelector('input[name="structure"][value="net"]').checked = true;
  document.querySelector('input[name="shareBasis"][value="rsf"]').checked = true;
  $("grossUpMode").value = "none";
  $("capMethod").value = "yoy";
  $("lineTable").querySelector("tbody").replaceChildren();
}

function loadExample() {
  clearAll();
  for (const [id, v] of Object.entries(EXAMPLE.fields)) $(id).value = String(v);
  $("grossUpMode").value = "recompute";
  $("feeEnabled").checked = true;
  $("capEnabled").checked = true;
  $("capMethod").value = "compound";
  $("capIncludesFee").checked = true;
  $("auditClause").value = "Section 6.7: Tenant may object in writing within 90 days after receiving the annual statement.";
  EXAMPLE.lines.forEach((l) => addLine(l));
  update();
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

document.addEventListener("input", (e) => { if (e.target.closest("main")) update(); });
document.addEventListener("change", (e) => { if (e.target.closest("main")) update(); });
$("btnAddLine").addEventListener("click", () => { addLine(); update(); });
$("btnExample").addEventListener("click", loadExample);
$("btnClear").addEventListener("click", () => { clearAll(); addLine(); update(); });
$("btnPrint").addEventListener("click", () => window.print());
$("btnCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("requestText").value); $("btnCopy").textContent = "Copied"; }
  catch (_) { $("requestText").select(); $("btnCopy").textContent = "Select + copy"; }
  setTimeout(() => { $("btnCopy").textContent = "Copy text"; }, 1500);
});
$("btnDownload").addEventListener("click", () => { if (last) download("cam-statement-check-notes.txt", notesText(last.r, last.input)); });

addLine();
update();
