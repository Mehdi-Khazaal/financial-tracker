import { expect } from '@playwright/test';
import { test, loginViaUi, ensureCategory } from './fixtures';

/**
 * Layout probe.
 *
 * A full-page screenshot paints `position: fixed` elements wherever the
 * viewport happened to be, so the mobile dock and the segmented control appear
 * stranded in the middle of the image. That makes a full-page capture useless
 * for answering the one question that matters on a phone — does the last card
 * clear the fixed controls — so this measures instead, and captures the bottom
 * of the scroll as a viewport shot.
 */

const API = 'http://127.0.0.1:8000';

test('measure dashboard spacing and verify bottom clearance', async ({ page, request, registeredUser }) => {
  test.setTimeout(120_000);

  const seedHeaders = { Origin: API };
  const login = await request.post(`${API}/auth/login`, {
    data: { identifier: registeredUser.email, password: registeredUser.password },
    headers: seedHeaders,
  });
  expect(login.ok()).toBeTruthy();

  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${API}${path}`, { data, headers: seedHeaders });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return res.json();
  };

  const checking = await post('/accounts', { name: 'Everyday', type: 'checking', balance: 5000 });
  await post('/accounts', { name: 'Venture Card', type: 'credit_card', balance: -213.37, credit_limit: 6000 });
  const groceries = await ensureCategory(request, seedHeaders, { name: 'Groceries', type: 'expense', color: '#22C55E' });
  await post('/transactions', { account_id: checking.id, category_id: groceries.id, amount: -42, description: 'Corner Shop', transaction_date: new Date().toISOString().slice(0, 10) });
  await post('/savings-goals', { name: 'Summer 2027', target_amount: 20000 });

  await loginViaUi(page, registeredUser.email, registeredUser.password);
  await page.goto('/');
  await expect(page.locator('#overview-net-worth-label')).toBeVisible({ timeout: 20_000 });

  // ── Desktop: what sits between the greeting and the first card ──────────────
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(1200);

  const boxes = await page.evaluate(() => {
    const pick = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      header: pick('.product-page-header'),
      tabBar: pick('.hidden.md\\:block.sticky'),
      brief: pick('section[aria-labelledby="morning-brief-heading"]'),
      hero: pick('.hero-card'),
    };
  });
  // eslint-disable-next-line no-console
  console.log('DESKTOP BOXES', JSON.stringify(boxes));

  const tabStyles = await page.evaluate(() => {
    const wrap = document.querySelector('.hidden.md\\:block.sticky');
    const track = wrap?.querySelector('div');
    const buttons = Array.from(wrap?.querySelectorAll('button') ?? []);
    const cs = (el: Element | null | undefined) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        opacity: s.opacity,
        visibility: s.visibility,
        display: s.display,
        background: s.backgroundColor,
        color: s.color,
      };
    };
    return {
      wrapper: cs(wrap),
      track: cs(track),
      buttons: buttons.map(b => ({ text: b.textContent, ...cs(b) })),
    };
  });
  // eslint-disable-next-line no-console
  console.log('TAB STYLES', JSON.stringify(tabStyles));

  // ── Phone: does the final card clear the dock and the segmented control? ────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);

  const clearance = await page.evaluate(() => {
    const last = document.querySelectorAll('main section, main > div > div');
    const lastEl = last[last.length - 1];
    const tabs = document.querySelector('.mobile-context-tabs');
    const dock = document.querySelector('.mobile-dock');
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const lastRect = r(lastEl);
    const tabsRect = r(tabs);
    return {
      lastCardBottom: lastRect ? Math.round(lastRect.bottom) : null,
      tabsTop: tabsRect ? Math.round(tabsRect.top) : null,
      dockTop: r(dock) ? Math.round(r(dock)!.top) : null,
      gapAboveTabs: lastRect && tabsRect ? Math.round(tabsRect.top - lastRect.bottom) : null,
      viewportHeight: window.innerHeight,
    };
  });
  // eslint-disable-next-line no-console
  console.log('PHONE CLEARANCE', JSON.stringify(clearance));

  await page.screenshot({ path: 'e2e/__screenshots__/probe-phone-bottom-390.png', fullPage: false });

  // ── Accounts and Portfolio, across the full range ───────────────────────────
  // Horizontal overflow is the failure that a full-page capture hides, so it is
  // measured rather than eyeballed at every width.
  const overflow: Record<string, unknown>[] = [];
  for (const route of ['/accounts', '/portfolio']) {
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [740, 360], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(route);
      await page.waitForTimeout(500);
      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      overflow.push({ route, w, h, ...result, overflows: result.scrollWidth > result.clientWidth + 1 });
    }
  }
  // eslint-disable-next-line no-console
  console.log('OVERFLOW', JSON.stringify(overflow.filter(r => r.overflows)));
  // eslint-disable-next-line no-console
  console.log('OVERFLOW_CHECKED', overflow.length);
  expect(overflow.filter(r => r.overflows)).toEqual([]);

  // The last card must finish above the floating controls, not behind them.
  expect(clearance.gapAboveTabs === null || clearance.gapAboveTabs >= 0).toBeTruthy();
});
