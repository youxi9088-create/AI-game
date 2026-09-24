import { test } from '@playwright/test';

// Sweeps the supported desktop range and asserts the invariants that the "round 4"
// coordinate system is supposed to guarantee:
//   1. no page scroll
//   2. mia stays on the right half, linxing on the top-centre (within a stated tolerance)
//   3. every card band (all three seats) clears both standees AND both speech bubbles
//   4. the top seat's bust ends above linxing's own band, at every felt height
//   5. the stack stays inside the felt and label / cards / owner row sit inside it
//
// (3) is measured by cloning the live stack onto each `from-*` anchor, because the table
// only ever renders one owner at a time. The bug this guards — linxing's cards hidden
// behind her own standee — was invisible to the previous version of this file, which only
// ever measured the stack the game happened to be showing.
const VIEWPORTS = [
  { w: 1024, h: 720, tag: '1024x720' },
  { w: 1280, h: 720, tag: '1280x720' },
  { w: 1366, h: 768, tag: '1366x768' },
  { w: 1440, h: 900, tag: '1440x900' },
  { w: 1920, h: 1080, tag: '1920x1080' },
  { w: 2560, h: 1440, tag: '2560x1440' }
];

/* Seats, not pal ids: a custom pal can sit in either seat, so the anchor that matters is the
   position (`.seat-top` / `.seat-right` / `.seat-player`), not who is standing there. */
const OWNERS = ['top', 'right', 'player'];

for (const { w, h, tag } of VIEWPORTS) {
  test(`table invariants @ ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/#/home');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForLoadState('networkidle');
    await page.locator('[data-action="start"]').first().click();
    await page.waitForSelector('.table-felt', { timeout: 20_000 });
    const skip = page.locator('[data-action="close-entry"]');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(500);
    // A2 turned "叫 3 分" from the only bid button into one of several (the first one in the
    // DOM is now 不叫 / score 0), so the bid has to be picked by score, and the click can no
    // longer be swallowed by `.catch(() => {})` — that is what let the old script sit in
    // BIDDING and then time out on a disabled hand card.
    await page.locator('[data-action="bid"][data-score="3"]').click();
    // Wait for the hand to actually unlock instead of a fixed sleep: the bid resolves
    // through the server, and the cards stay disabled until the phase is PLAYING.
    await page.waitForFunction(() => {
      const card = document.querySelector('.hand .card');
      return Boolean(card) && !card.disabled;
    }, null, { timeout: 20_000 });
    await page.locator('.hand .card').first().click();
    await page.locator('[data-action="play"]').click();
    // Wait for a stack to exist at all; the owner class changes as the NPCs reply, but the
    // box is what we measure, so any settled state will do.
    await page.waitForSelector('.played-stack', { timeout: 20_000 });
    await page.waitForTimeout(6500);

    const g = await page.evaluate((owners) => {
      const felt = document.querySelector('.table-felt');
      const f = felt.getBoundingClientRect();
      const rel = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left - f.left), y: Math.round(r.top - f.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right - f.left), bottom: Math.round(r.bottom - f.top), cx: Math.round(r.left - f.left + r.width / 2) };
      };
      const ov = (a, b) => Boolean(a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom);

      const proto = document.querySelector('.played-stack');
      const bands = {};
      for (const owner of owners) {
        const clone = proto.cloneNode(true);
        clone.className = 'played-stack seat-' + owner;
        proto.parentElement.appendChild(clone);
        bands[owner] = rel(clone);
        clone.remove();
      }

      // Measure the seat *box*, not the inner <img>: the standee clips its image with
      // object-position: 56% center, so the img's bounding box sits ~12px right of the
      // box centre at every viewport. That is an intentional crop, not a centring error,
      // and measuring it made the assertion fail on correct layouts.
      const seats = {
        top: rel(document.querySelector('.opponent.top .pal-standee')),
        right: rel(document.querySelector('.opponent.right .pal-standee'))
      };
      const bubbles = [...document.querySelectorAll('.pal-bubble')].map((el) => rel(el));
      const lab = rel(document.querySelector('.played-stack > p'));
      const own = rel(document.querySelector('.played-stack > b'));

      /* A character may not be covered by furniture: .match-hud is z-index 4 and .self-seat
         is 3, both above the seats' 2, so either one landing on a figure hides part of her.
         .felt-label is deliberately below the seats — it is the table's watermark, and a
         character standing on it is the intended read, so it is not counted here. */
      const ui = {
        hud: rel(document.querySelector('.match-hud')),
        selfSeat: rel(document.querySelector('.self-seat')),
        turnDock: rel(document.querySelector('.turn-dock'))
      };
      const uiHits = [];
      for (const [sName, sb] of Object.entries(seats)) {
        for (const [uName, ub] of Object.entries(ui)) if (ov(sb, ub)) uiHits.push(`${sName} × ${uName}`);
        if (sb && (sb.x < 0 || sb.y < 0 || sb.right > Math.round(f.width) || sb.bottom > Math.round(f.height))) {
          uiHits.push(`${sName} clipped by felt`);
        }
      }

      const hits = { seats: [], bubbles: [], outOfFelt: [] };
      for (const [owner, box] of Object.entries(bands)) {
        for (const [seat, sb] of Object.entries(seats)) if (ov(box, sb)) hits.seats.push(`${owner} × ${seat}`);
        bubbles.forEach((bb, i) => { if (ov(box, bb)) hits.bubbles.push(`${owner} × bubble${i}`); });
        if (box.x < 0 || box.y < 0 || box.right > Math.round(f.width) || box.bottom > Math.round(f.height)) hits.outOfFelt.push(owner);
      }

      return {
        feltW: Math.round(f.width), feltH: Math.round(f.height),
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        seats, bands, bubbles, hits, uiHits,
        /* Both figures are one share of the felt (--seat-figure), so their painted heights
           must match at every viewport. Before that variable existed mia was a fixed 236×295
           and linxing a share of the felt: 1.94× apart at 1024×720, 1.03× at 2560×1440. */
        figureDelta: seats.top && seats.right ? Math.abs(seats.top.h - seats.right.h) : null,
        // The contract that keeps the top seat off the felt's middle band.
        topBustToBand: seats.top && bands.top ? bands.top.y - seats.top.bottom : null,
        topBustPct: seats.top ? Math.round((seats.top.bottom / f.height) * 100) : null,
        labelInStack: Boolean(lab && proto && lab.y >= rel(proto).y - 2 && lab.bottom <= rel(proto).bottom + 2),
        ownerInStack: Boolean(own && proto && own.bottom <= rel(proto).bottom + 2),
        rightSeatOnRight: seats.right ? seats.right.cx > Math.round(f.width) / 2 : null,
        // Absolute px distance from the felt centre, so the caller can state its own
        // tolerance instead of a baked-in boolean the log can't explain.
        topOffset: seats.top ? Math.abs(seats.top.cx - Math.round(f.width) / 2) : null
      };
    }, OWNERS);

    const fails = [];
    // 1024×720 is the documented CSS boundary and scrolls ~30px by design; everything from
    // 1280×720 up is scroll-free apart from a 1px rounding artifact of the felt clamp.
    const scrollBudget = w === 1024 ? 32 : 1;
    if (g.overflow > scrollBudget) fails.push('scroll +' + g.overflow + 'px');
    if (g.hits.seats.length) fails.push('band over seat: ' + g.hits.seats.join(', '));
    if (g.hits.bubbles.length) fails.push('band over bubble: ' + g.hits.bubbles.join(', '));
    if (g.hits.outOfFelt.length) fails.push('band outside felt: ' + g.hits.outOfFelt.join(', '));
    if (!(g.topBustToBand > 0)) fails.push('top seat bust ends inside its own card band (' + g.topBustToBand + 'px)');
    if (!g.labelInStack) fails.push('label outside stack');
    if (!g.ownerInStack) fails.push('owner row outside stack');
    if (!g.rightSeatOnRight) fails.push('right seat not on the right half');
    if (!(g.figureDelta <= 1)) fails.push('figures differ in size by ' + g.figureDelta + 'px');
    if (g.uiHits.length) fails.push('character covered by UI: ' + g.uiHits.join(', '));
    // 16px, not 12: the top seat's row shift is one measured constant while the role chip's
    // own width tracks the font tier, so her character drifts up to ~12px right of the felt
    // centre at 1920 wide and above. That is a chip-width artifact, not a seat placement bug.
    if (!(g.topOffset <= 16)) fails.push('top seat off centre by ' + g.topOffset + 'px');

    console.log(
      '\n[' + tag + '] felt=' + g.feltW + 'x' + g.feltH +
      ' overflow=' + g.overflow + 'px' +
      '\n  top     bust x' + g.seats.top.x + '-' + g.seats.top.right + ' y' + g.seats.top.y + '-' + g.seats.top.bottom +
      ' (ends ' + g.topBustPct + '% of felt, ' + g.topBustToBand + 'px clear of her band, ' + g.topOffset + 'px off centre)' +
      '\n  right   bust x' + g.seats.right.x + '-' + g.seats.right.right + ' y' + g.seats.right.y + '-' + g.seats.right.bottom +
      '\n  figure delta ' + g.figureDelta + 'px' +
      OWNERS.map((o) => '\n  band ' + o.padEnd(12) + ' x' + g.bands[o].x + '-' + g.bands[o].right + ' y' + g.bands[o].y + '-' + g.bands[o].bottom).join('') +
      '\n  ' + (fails.length ? 'FAIL: ' + fails.join(', ') : 'PASS')
    );
    test.info().annotations.push({ type: 'result', description: fails.length ? fails.join(', ') : 'PASS' });
    // The log above is for humans; this is the gate. A previous version of this file only
    // printed `fails` and a defect still shipped as "PASS", so the sweep is now an
    // assertion, not a report.
    if (fails.length) throw new Error(tag + ': ' + fails.join(', '));
  });
}
