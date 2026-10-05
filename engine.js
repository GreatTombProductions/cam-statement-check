// CAM Statement Check — reconciliation engine (pure functions, no DOM).
// Every formula here is written out in methodology.html; tests/test_engine.js
// pins hand-computed cases. Unknown inputs stop a calculation; they are never
// treated as zero.
"use strict";

const TOLERANCE = 1.0; // dollars: statement vs recomputation treated as equal within this
const AMOUNT_MAX = 1e10;

class InputError extends Error {
  constructor(problems) {
    super(problems.join(" "));
    this.problems = problems;
  }
}

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function validate(input) {
  const p = [];
  const lease = input.lease || {};
  const share = lease.share || {};
  const lines = input.lines || [];
  const stmt = input.statement || {};

  if (!["net", "base_year", "expense_stop"].includes(lease.structure)) p.push("Choose how your lease passes expenses through.");
  if (share.basis === "rsf") {
    if (!isNum(share.tenant_rsf) || share.tenant_rsf <= 0) p.push("Enter your rentable square feet.");
    if (!isNum(share.denominator_rsf) || share.denominator_rsf <= 0) p.push("Enter the building or center square feet your lease divides by.");
    if (isNum(share.tenant_rsf) && isNum(share.denominator_rsf) && share.denominator_rsf < share.tenant_rsf)
      p.push("The building square feet must be at least your own square feet.");
  } else if (share.basis === "fixed") {
    if (!isNum(share.fixed_pct) || share.fixed_pct <= 0 || share.fixed_pct > 100) p.push("Enter the share percentage your lease states (above 0, at most 100).");
  } else {
    p.push("Choose how your lease defines your share.");
  }
  if (lease.structure === "base_year" && (!isNum(lease.base_year_pool) || lease.base_year_pool < 0))
    p.push("Enter the base-year expense total from your lease or base-year statement.");
  if (lease.structure === "expense_stop") {
    if (!isNum(lease.expense_stop_psf) || lease.expense_stop_psf < 0) p.push("Enter the expense stop per square foot.");
    if (!isNum(share.denominator_rsf) || share.denominator_rsf <= 0) p.push("An expense stop per square foot needs the building square feet.");
  }

  const gu = lease.gross_up || { mode: "none" };
  if (!["none", "recompute", "already"].includes(gu.mode)) p.push("Choose a gross-up option.");
  if (gu.mode === "recompute") {
    if (!isNum(gu.target_pct) || gu.target_pct <= 0 || gu.target_pct > 100) p.push("Enter the gross-up occupancy your lease names (above 0, at most 100).");
    if (!isNum(gu.actual_pct) || gu.actual_pct <= 0 || gu.actual_pct > 100) p.push("Enter the building's average occupancy for the year (above 0, at most 100).");
  }

  const fee = lease.fee || { enabled: false };
  if (fee.enabled && (!isNum(fee.cap_pct) || fee.cap_pct < 0 || fee.cap_pct > 100)) p.push("Enter the management-fee percentage your lease allows.");

  const cap = lease.cap || { enabled: false };
  if (cap.enabled) {
    if (!isNum(cap.rate_pct) || cap.rate_pct < 0 || cap.rate_pct > 100) p.push("Enter the cap's annual percentage.");
    if (cap.method === "yoy") {
      if (!isNum(cap.prior_allowed) || cap.prior_allowed < 0) p.push("Enter last year's allowable controllable amount (your share).");
    } else if (cap.method === "compound" || cap.method === "simple") {
      if (!isNum(cap.base_amount) || cap.base_amount < 0) p.push("Enter the cap's base-year controllable amount (your share).");
      if (!Number.isInteger(cap.years_since_base) || cap.years_since_base < 1 || cap.years_since_base > 50)
        p.push("Enter the whole number of years since the cap's base year (1 to 50).");
    } else {
      p.push("Choose how your cap is measured.");
    }
  }

  if (!lines.length) p.push("Add at least one line from the statement.");
  lines.forEach((l, i) => {
    const name = l.label ? `"${l.label}"` : `line ${i + 1}`;
    if (!isNum(l.amount) || l.amount < 0 || l.amount > AMOUNT_MAX) p.push(`Enter the dollar amount for ${name} (zero or more).`);
    if (!["recoverable", "excluded", "unsure"].includes(l.treatment)) p.push(`Choose a treatment for ${name}.`);
    if (!["expense", "fee"].includes(l.kind)) p.push(`Choose a line type for ${name}.`);
  });

  if (!isNum(stmt.tenant_charge) || stmt.tenant_charge < 0) p.push("Enter your total share as the statement charges it.");
  if (stmt.estimates_paid != null && (!isNum(stmt.estimates_paid) || stmt.estimates_paid < 0)) p.push("Estimated payments must be zero or more.");
  if (stmt.share_pct != null && (!isNum(stmt.share_pct) || stmt.share_pct <= 0 || stmt.share_pct > 100)) p.push("The statement's share percentage must be above 0 and at most 100.");
  return p;
}

function shareFraction(share) {
  return share.basis === "rsf" ? share.tenant_rsf / share.denominator_rsf : share.fixed_pct / 100;
}

function grossUpFactor(gu) {
  if (!gu || gu.mode !== "recompute") return 1;
  return gu.actual_pct < gu.target_pct ? gu.target_pct / gu.actual_pct : 1; // never gross down
}

function capLimit(cap) {
  const r = cap.rate_pct / 100;
  if (cap.method === "yoy") return cap.prior_allowed * (1 + r);
  if (cap.method === "compound") return cap.base_amount * Math.pow(1 + r, cap.years_since_base);
  return cap.base_amount * (1 + r * cap.years_since_base);
}

// One scenario: includeUnsure decides whether "unsure" lines count as recoverable.
function scenario(input, includeUnsure) {
  const lease = input.lease;
  const share = shareFraction(lease.share);
  const factor = grossUpFactor(lease.gross_up);
  const counts = (l) => l.treatment === "recoverable" || (includeUnsure && l.treatment === "unsure");

  const rows = input.lines.map((l) => {
    const included = counts(l);
    const grossed = l.kind === "expense" && l.variable && factor !== 1;
    const adjusted = l.kind === "expense" ? l.amount * (grossed ? factor : 1) : l.amount;
    return { id: l.id, included, grossed, adjusted };
  });

  let poolExpenses = 0, feeBase = 0, feeCharged = 0, controllableExpenses = 0;
  input.lines.forEach((l, i) => {
    const r = rows[i];
    if (!r.included) return;
    if (l.kind === "fee") {
      feeCharged += l.amount;
    } else {
      poolExpenses += r.adjusted;
      if (l.in_fee_base) feeBase += r.adjusted;
      if (l.controllable) controllableExpenses += r.adjusted;
    }
  });

  const fee = lease.fee || { enabled: false };
  const feeAllowed = fee.enabled ? (fee.cap_pct / 100) * feeBase : null;
  const feeUsed = fee.enabled ? Math.min(feeCharged, feeAllowed) : feeCharged;
  const pool = poolExpenses + feeUsed;

  let gross;
  if (lease.structure === "net") gross = share * pool;
  else if (lease.structure === "base_year") gross = share * Math.max(0, pool - lease.base_year_pool);
  else gross = share * Math.max(0, pool - lease.expense_stop_psf * lease.share.denominator_rsf);

  const cap = lease.cap || { enabled: false };
  let capInfo = null;
  let tenant = gross;
  if (cap.enabled) {
    if (lease.structure !== "net") {
      capInfo = { applied: false, reason: "cap-not-modeled-for-structure" };
    } else {
      const controllableTenant = share * (controllableExpenses + (cap.includes_fee ? feeUsed : 0));
      const limit = capLimit(cap);
      const excess = Math.max(0, controllableTenant - limit);
      tenant = gross - excess;
      capInfo = { applied: true, controllable_tenant: controllableTenant, limit, excess };
    }
  }

  return {
    share, gross_up_factor: factor, rows,
    pool_expenses: poolExpenses, fee_base: feeBase, fee_charged: feeCharged,
    fee_allowed: feeAllowed, fee_used: feeUsed, pool, gross, cap: capInfo, tenant,
  };
}

function check(input) {
  const problems = validate(input);
  if (problems.length) throw new InputError(problems);
  const low = scenario(input, false);
  const high = scenario(input, true);
  const stmt = input.statement;
  const charge = stmt.tenant_charge;

  let verdict;
  if (charge > high.tenant + TOLERANCE) verdict = "above";
  else if (charge < low.tenant - TOLERANCE) verdict = "below";
  else if (high.tenant - low.tenant <= TOLERANCE) verdict = "matches";
  else verdict = "within";

  const share = low.share;
  const shareFlag = stmt.share_pct != null && Math.abs(stmt.share_pct - share * 100) > 0.005
    ? { statement_pct: stmt.share_pct, lease_pct: share * 100 } : null;

  const excludedLines = input.lines.filter((l) => l.treatment === "excluded");
  const unsureLines = input.lines.filter((l) => l.treatment === "unsure");
  const lineShare = (l) => share * (l.kind === "expense" && l.variable ? l.amount * low.gross_up_factor : l.amount);

  const findings = [];
  if (shareFlag) findings.push({ type: "share", ...shareFlag });
  excludedLines.forEach((l) => findings.push({ type: "excluded", id: l.id, label: l.label, amount: l.amount, clause: l.clause || "", at_share: lineShare(l) }));
  unsureLines.forEach((l) => findings.push({ type: "unsure", id: l.id, label: l.label, amount: l.amount, at_share: lineShare(l) }));
  if (high.fee_allowed != null && high.fee_charged > high.fee_allowed + TOLERANCE)
    findings.push({ type: "fee", charged: high.fee_charged, allowed: high.fee_allowed, base: high.fee_base, cap_pct: input.lease.fee.cap_pct });
  const gu = input.lease.gross_up || { mode: "none" };
  if (gu.mode === "recompute" && low.gross_up_factor !== 1) findings.push({ type: "gross_up", factor: low.gross_up_factor, target_pct: gu.target_pct, actual_pct: gu.actual_pct });
  if (gu.mode === "already") findings.push({ type: "gross_up_unverified" });
  if (low.cap && low.cap.applied && high.cap.excess > TOLERANCE) findings.push({ type: "cap", controllable: high.cap.controllable_tenant, limit: high.cap.limit, method: input.lease.cap.method });
  if (low.cap && !low.cap.applied) findings.push({ type: "cap_not_modeled" });

  const paid = stmt.estimates_paid;
  return {
    verdict, charge, low, high,
    difference_high: charge - high.tenant,
    difference_low: charge - low.tenant,
    balance_low: paid == null ? null : low.tenant - paid,
    balance_high: paid == null ? null : high.tenant - paid,
    statement_balance: paid == null ? null : charge - paid,
    findings,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { check, validate, scenario, capLimit, grossUpFactor, shareFraction, InputError, TOLERANCE };
}
