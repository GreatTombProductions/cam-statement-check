# CAM Statement Check

Your landlord sent the year-end CAM / operating-expense reconciliation and a balance due. This free, static page recomputes the statement from **your lease's own cost terms**, shows where the two disagree, and drafts a request for the documents behind each questioned line.

**Live:** https://greattombproductions.github.io/cam-statement-check/

## What it checks

- **Your share** — your square feet ÷ the lease's divisor (or the lease's fixed percentage), compared with the share the statement printed.
- **Exclusions** — each statement line is marked recoverable, excluded by your lease (with the section you cite), or *not sure*. Not-sure lines are computed both ways, so the result is a range instead of a guess.
- **Gross-up** — variable lines raised to the occupancy your lease names (never grossed down; fixed lines untouched). If the statement is already grossed up, the page says it cannot check that and asks for the actual amounts.
- **Management fee** — the lease's fee percentage applied to the expense lines you mark as the fee base.
- **Controllable-expense cap** — year-over-year, compounding-from-base, or simple-from-base, written as formulas rather than the inconsistent "cumulative / non-cumulative" labels (net leases).
- **Structures** — net/NNN, base year, expense stop.

It ends with a verdict (above / within / matches / below the range your lease terms produce), a line-by-line list of questions, and an editable request for supporting documents. You can copy it, download it (with your inputs and results) as a text file, or print it.

## What it does not do

It does not read your lease, verify that expenses were real, compute deadlines, or tell you whether to pay or dispute. It is arithmetic on the terms you enter — not legal or accounting advice. Your lease's notice clause governs how, where and when to object.

## Privacy

No accounts, no uploads, no storage, no tracking, no third-party requests. Everything runs in your browser; closing the page discards what you typed.

## Layout

```
frontend/  index.html, engine.js (pure reconciliation math), app.js (page), style.css,
           methodology.html (every formula), sources.html (background + where to get help)
tests/     test_engine.js (hand-computed cases), browser_smoke.js + run_browser_smoke.py
```

## Run the tests

```bash
node tests/test_engine.js
python3 tests/run_browser_smoke.py   # needs Node + Playwright (Chromium)
```

## License

MIT
