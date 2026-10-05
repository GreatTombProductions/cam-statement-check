# CAM Statement Check — project spec

**Status:** built and released 2026-10-06.

## Receiver and decision boundary
A small commercial tenant holding a year-end CAM / operating-expense reconciliation decides whether to pay it, question it, or let it stand (and set next year's base). Both documents needed — the lease and the statement — are already in the tenant's hands. The downstream receiver is the landlord / property manager who must answer a documentation request.

## Existing help inspected (2026-10-06)
- Landager free CAM/NNN calculator: aggregate inputs only (totals, one cap %, occupancy). No line items, no lease exclusions, no controllable split, no fee-base check, no next step.
- Landlord-side software (DoorLoop, A.CRE calculator): reconciliation from the landlord's books, not a tenant's check.
- Lease auditors / attorneys: right for verifying expenses and legal questions; cost-justified only for larger amounts.
Delta built: line-level recomputation from the tenant's own lease terms with tenant-cited clauses, a range (not a guess) for uncertain lines, and a documentation request the landlord can act on.

## Contract
`engine.js` `check(input)` → `{verdict, low, high, findings, ...}`. Formulas in `frontend/methodology.html`. Missing inputs raise `InputError` with field-specific problems; nothing defaults to zero. Caps modeled for net leases only; other structures report `cap_not_modeled`.

## NOT building
- No accounts, storage, uploads, reminders or deadline computation.
- No legal determination of what a clause means; no recommendation to pay or dispute.
- No amortization of capital items, partial-year occupancy, or multi-pool statements (run pools separately).

## Acceptance (met)
1. 11 hand-computed engine cases pass (net with gross-up + fee cap + compounding cap; range with unsure line; base year; expense stop; three cap formulas; cap-not-modeled; no gross-down; already-grossed flagged; blank amount stops; building < premises rejected; excluded fee).
2. Browser smoke: exact example figures, findings, request + downloadable notes, edits recompute, blanks stop, user text escaped, print view, 390px mobile, zero third-party requests — staged and live.
