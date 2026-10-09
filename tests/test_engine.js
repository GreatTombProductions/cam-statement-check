// Engine tests. Expected values are hand-computed in the comments, not
// produced by the engine — a case the engine "agrees with itself" on proves nothing.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
// Source layout keeps the site under frontend/; the published repository has it at the root.
const E = require(["../frontend/engine.js", "../engine.js"]
  .map((p) => path.join(__dirname, p)).find((p) => fs.existsSync(p)));

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { console.error("FAIL:", name, "\n ", err.message); process.exitCode = 1; }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);

function baseCase() {
  return {
    lease: {
      structure: "net",
      share: { basis: "rsf", tenant_rsf: 2000, denominator_rsf: 50000 },   // 4%
      gross_up: { mode: "recompute", target_pct: 95, actual_pct: 80 },     // factor 1.1875
      fee: { enabled: true, cap_pct: 10 },
      cap: { enabled: true, rate_pct: 5, method: "compound", base_amount: 3600, years_since_base: 3, includes_fee: true },
    },
    lines: [
      { id: "a", label: "Landscaping", amount: 30000, treatment: "recoverable", kind: "expense", variable: false, controllable: true, in_fee_base: true },
      { id: "b", label: "Janitorial", amount: 60000, treatment: "recoverable", kind: "expense", variable: true, controllable: true, in_fee_base: true },
      { id: "c", label: "Property tax", amount: 100000, treatment: "recoverable", kind: "expense", variable: false, controllable: false, in_fee_base: false },
      { id: "d", label: "Insurance", amount: 40000, treatment: "recoverable", kind: "expense", variable: false, controllable: false, in_fee_base: false },
      { id: "e", label: "Roof replacement", amount: 48000, treatment: "excluded", clause: "6.3(b) capital expenditures", kind: "expense", variable: false, controllable: false, in_fee_base: true },
      { id: "f", label: "Management fee", amount: 16000, treatment: "recoverable", kind: "fee" },
    ],
    statement: { tenant_charge: 12400, estimates_paid: 9000, share_pct: 4.2 },
  };
}

test("net lease, gross-up, fee cap, compounding cap — hand computed", () => {
  const r = E.check(baseCase());
  // janitorial 60,000 x 95/80 = 71,250; pool expenses 30,000+71,250+100,000+40,000 = 241,250
  near(r.low.pool_expenses, 241250, "pool expenses");
  // fee base 30,000 + 71,250 = 101,250 (roof excluded); allowed 10% = 10,125 < charged 16,000
  near(r.low.fee_base, 101250, "fee base");
  near(r.low.fee_used, 10125, "fee used");
  // pool 251,375 x 4% = 10,055
  near(r.low.gross, 10055, "gross share");
  // controllable at share 4% x (101,250 + 10,125) = 4,455; limit 3,600 x 1.05^3 = 4,167.45; excess 287.55
  near(r.low.cap.limit, 4167.45, "cap limit");
  near(r.low.cap.excess, 287.55, "cap excess");
  near(r.low.tenant, 9767.45, "tenant share");
  assert.strictEqual(r.verdict, "above");
  near(r.difference_high, 2632.55, "overstatement");
  near(r.balance_low, 767.45, "recomputed balance");
  near(r.statement_balance, 3400, "statement balance");
  const types = r.findings.map((f) => f.type);
  assert.deepStrictEqual(types, ["share", "excluded", "fee", "gross_up", "cap"]);
  near(r.findings[1].at_share, 1920, "roof at share");
});

test("unsure line produces a range, and a charge inside it is 'within'", () => {
  const c = baseCase();
  c.lines.push({ id: "g", label: "Parking resurfacing", amount: 20000, treatment: "unsure", kind: "expense", variable: false, controllable: false, in_fee_base: false });
  c.statement.tenant_charge = 10200;
  const r = E.check(c);
  near(r.low.tenant, 9767.45, "low excludes unsure");
  near(r.high.tenant, 10567.45, "high adds 4% of 20,000");
  assert.strictEqual(r.verdict, "within");
});

test("charge equal to recomputation within $1 matches; below is reported as below", () => {
  const c = baseCase();
  c.statement.tenant_charge = 9767.95;
  assert.strictEqual(E.check(c).verdict, "matches");
  c.statement.tenant_charge = 9000;
  assert.strictEqual(E.check(c).verdict, "below");
});

function plain(structure, extra) {
  return {
    lease: Object.assign({ structure, share: { basis: "fixed", fixed_pct: 4, denominator_rsf: 50000 }, gross_up: { mode: "none" }, fee: { enabled: false }, cap: { enabled: false } }, extra),
    lines: [{ id: "x", label: "All operating expenses", amount: 300000, treatment: "recoverable", kind: "expense" }],
    statement: { tenant_charge: 2000 },
  };
}

test("base year: 4% x (300,000 - 250,000) = 2,000; never negative", () => {
  near(E.check(plain("base_year", { base_year_pool: 250000 })).low.tenant, 2000, "base year");
  near(E.check(plain("base_year", { base_year_pool: 400000 })).low.tenant, 0, "below base");
});

test("expense stop: 4% x (300,000 - 5.50 x 50,000) = 1,000", () => {
  near(E.check(plain("expense_stop", { expense_stop_psf: 5.5 })).low.tenant, 1000, "stop");
});

test("cap formulas: year-over-year 4,000 x 1.05; simple 3,600 x 1.15", () => {
  near(E.capLimit({ method: "yoy", rate_pct: 5, prior_allowed: 4000 }), 4200, "yoy");
  near(E.capLimit({ method: "simple", rate_pct: 5, base_amount: 3600, years_since_base: 3 }), 4140, "simple");
  near(E.capLimit({ method: "compound", rate_pct: 5, base_amount: 3600, years_since_base: 3 }), 4167.45, "compound");
});

test("cap with a base-year lease is reported as not modeled, not silently applied", () => {
  const r = E.check(plain("base_year", { base_year_pool: 250000, cap: { enabled: true, rate_pct: 5, method: "yoy", prior_allowed: 1 } }));
  assert.ok(r.findings.some((f) => f.type === "cap_not_modeled"));
  near(r.low.tenant, 2000, "uncapped base-year figure");
});

test("no gross-down when occupancy is above target; 'already grossed' is flagged unverified", () => {
  assert.strictEqual(E.grossUpFactor({ mode: "recompute", target_pct: 95, actual_pct: 97 }), 1);
  const c = baseCase();
  c.lease.gross_up = { mode: "already" };
  const r = E.check(c);
  assert.ok(r.findings.some((f) => f.type === "gross_up_unverified"));
  near(r.low.pool_expenses, 230000, "no recompute on already-grossed amounts");
});

test("missing amount stops the calculation; it is never zero", () => {
  const c = baseCase();
  c.lines[0].amount = null;
  assert.throws(() => E.check(c), (e) => e instanceof E.InputError && e.problems.some((p) => p.includes("Landscaping")));
});

test("building smaller than the premises is rejected", () => {
  const c = baseCase();
  c.lease.share.denominator_rsf = 1000;
  assert.throws(() => E.check(c), E.InputError);
});

test("fee lines are not grossed up and an excluded fee line drops out entirely", () => {
  const c = baseCase();
  c.lease.fee = { enabled: false };
  c.lines[5].treatment = "excluded";
  const r = E.check(c);
  near(r.low.fee_used, 0, "excluded fee");
  near(r.low.pool, 241250, "pool without fee");
});

console.log(`engine tests: ${passed} passed${process.exitCode ? ", FAILURES above" : ""}`);
