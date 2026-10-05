'use strict';
// Browser smoke for CAM Statement Check. SMOKE_BASE = site root URL.
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const base = process.env.SMOKE_BASE;
  const origin = new URL(base).origin;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const foreign = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url()); });

    const resp = await page.goto(base, { waitUntil: 'networkidle' });
    assert(resp.ok(), 'index ' + resp.status());

    // empty start: nothing computed, nothing assumed zero
    assert((await page.locator('#verdict').count()) === 0);
    assert((await page.locator('.verdict.pending').textContent()).includes('Nothing is assumed to be zero'));
    assert(await page.locator('#requestSection').isHidden());

    // example: hand-computed figures (see tests/test_engine.js)
    await page.click('#btnExample');
    const verdict = await page.locator('#verdict').textContent();
    assert(verdict.includes('$1,832.55') && verdict.includes('more than your lease terms produce'), verdict);
    const total = await page.locator('table.bridge tr.total').textContent();
    assert(total.includes('$9,767.45') && total.includes('$10,567.45'), total);
    assert.strictEqual(await page.locator('.findings li').count(), 6);
    const req = await page.inputValue('#requestText');
    for (const s of ['Roof replacement', '6.3(b)', 'Parking lot resurfacing', '4.2%', 'Section 6.7', 'General ledger detail', '$10,567.45 at most'])
      assert(req.includes(s), 'request missing ' + s);
    assert((await page.locator('#requestPrint').textContent()) === req, 'print mirror out of sync');

    // personalizing the request
    await page.fill('#reqTenant', 'Corner Bakery LLC');
    assert((await page.inputValue('#requestText')).includes('Corner Bakery LLC'));

    // downloadable notes retain inputs, result and draft
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnDownload')]);
    const notes = fs.readFileSync(await dl.path(), 'utf8');
    for (const s of ['RESULT', 'Janitorial: $60,000.00', 'DRAFT REQUEST', 'Corner Bakery LLC', 'not legal advice'])
      assert(notes.includes(s), 'notes missing ' + s);

    // an edit flows through: roof marked recoverable raises the range by 4% of 48,000 + fee/cap effects
    const roofRow = page.locator('#lineTable tbody tr').nth(4);
    await roofRow.locator('select').nth(1).selectOption('recoverable');
    const total2 = await page.locator('table.bridge tr.total').textContent();
    assert(!total2.includes('$9,767.45'), 'edit did not recompute: ' + total2);
    await roofRow.locator('select').nth(1).selectOption('excluded');

    // a blank amount stops the calculation and names the line
    await page.locator('#lineTable tbody tr').nth(0).locator('.f-amount').fill('');
    assert((await page.locator('.verdict.pending').textContent()).includes('"Landscaping"'));
    assert(await page.locator('#requestSection').isHidden());
    await page.locator('#lineTable tbody tr').nth(0).locator('.f-amount').fill('30000');

    // user text is rendered as text, never markup
    await page.locator('#lineTable tbody tr').nth(5).locator('.f-label').fill('<img src=x onerror="window.__x=1">');
    assert((await page.locator('.findings').textContent()).includes('<img src=x'));
    assert.strictEqual(await page.evaluate(() => window.__x), undefined);

    // print media shows the full draft, hides the form
    await page.emulateMedia({ media: 'print' });
    assert(await page.locator('#requestPrint').isVisible());
    assert(await page.locator('.card').first().isHidden());
    await page.emulateMedia({ media: 'screen' });

    // clear returns to the not-calculated state
    await page.click('#btnClear');
    assert((await page.locator('.verdict.pending').count()) === 1);

    // secondary pages
    for (const p of ['methodology.html', 'sources.html']) {
      const r = await page.goto(new URL(p, base).toString(), { waitUntil: 'networkidle' });
      assert(r.ok(), p + ' ' + r.status());
    }

    // mobile: page itself does not scroll sideways (tables scroll inside their wrappers)
    const mobile = await browser.newPage({ viewport: { width: 390, height: 800 } });
    mobile.on('pageerror', (e) => errors.push('mobile: ' + e.message));
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await mobile.click('#btnExample');
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, 'horizontal overflow ' + overflow + 'px');
    assert((await mobile.locator('#verdict').textContent()).includes('$1,832.55'));

    assert.deepStrictEqual(errors, [], 'errors: ' + errors.join(' | '));
    assert.deepStrictEqual(foreign, [], 'third-party requests: ' + foreign.join(' | '));
    console.log(`SMOKE PASS ${base}: example verdict + bridge exact, 6 findings, request + notes download, edits recompute, blanks stop, escaping, print, mobile 390px, no third-party requests`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
