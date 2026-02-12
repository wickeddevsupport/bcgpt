const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1797, height: 768 } });
  const ts = Date.now();
  const email = `qa_${ts}@example.com`;
  const password = 'TestPassword123!';

  await page.goto('https://flow.wickedlab.io/sign-up', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[name="firstName"]', 'QA');
  await page.fill('input[name="lastName"]', 'User');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);

  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = checkboxes.nth(i);
    if (!(await cb.isChecked())) {
      await cb.check().catch(() => {});
    }
  }

  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});

  const finalUrl = page.url();
  const sidebarFooter = await page.locator('[data-sidebar="footer"]').count();
  const hasExplore = await page.getByText('Explore', { exact: true }).count();
  const hasProjects = await page.getByText('Projects', { exact: true }).count();
  const hasUserText = await page.getByText('QA User', { exact: false }).count();

  await page.screenshot({ path: `C:/Users/rjnd/Documents/GitHub/bcgpt/local/smoke-dashboard-${ts}.png`, fullPage: true });

  console.log(JSON.stringify({ email, finalUrl, sidebarFooter, hasExplore, hasProjects, hasUserText }, null, 2));
  await browser.close();
})();
