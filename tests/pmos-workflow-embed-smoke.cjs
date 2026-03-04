const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.PMOS_BASE_URL || "https://os.wickedlab.io";
const EMAIL = process.env.PMOS_EMAIL || process.env.PMOS_SUPER_EMAIL || "rajan@wickedwebsites.us";
const PASSWORD = process.env.PMOS_PASSWORD || process.env.PMOS_SUPER_PASS || "";

if (!PASSWORD) {
  console.error("Missing PMOS_PASSWORD or PMOS_SUPER_PASS env vars.");
  process.exit(1);
}

const report = {
  runTs: Date.now(),
  baseUrl: BASE_URL,
  email: EMAIL,
  loginOk: false,
  workflowsNavOk: false,
  iframeVisible: false,
  iframeSrc: null,
  frameUrl: null,
  frameTitle: null,
  frameBodyPreview: null,
  frameBodyChars: 0,
  redirectedToSignIn: false,
  apiUsersMeStatuses: [],
  apiFailures: [],
  errors: [],
};

function pushBounded(arr, value, max = 25) {
  arr.push(value);
  while (arr.length > max) arr.shift();
}

async function isVisible(locator, timeout = 1600) {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const exact = nav.getByText(label, { exact: true }).first();
  if (await isVisible(exact, 900)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function ensureSignedIn(page) {
  const signOut = page.getByRole("button", { name: /^Sign out$/i }).first();
  if (await isVisible(signOut, 2200)) {
    report.loginOk = true;
    return;
  }

  const emailInput = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
  const passInput = page.locator('input[type="password"]').first();
  if (!(await isVisible(emailInput, 5000))) {
    throw new Error("Sign-in form not visible.");
  }
  await emailInput.fill(EMAIL);
  await passInput.fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/i }).first().click();

  await signOut.waitFor({ state: "visible", timeout: 120000 });
  report.loginOk = true;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
  const page = await context.newPage();

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      if (url.includes("/api/v1/users/me")) {
        pushBounded(report.apiUsersMeStatuses, { url, status });
      }
      if (url.includes("/api/v1/") && status >= 400) {
        const text = await response.text().catch(() => "");
        pushBounded(report.apiFailures, {
          url,
          status,
          body: (text || "").slice(0, 240),
        });
      }
    } catch {
      // ignore diagnostics failures
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    await ensureSignedIn(page);

    await clickNav(page, "Workflows");
    report.workflowsNavOk = true;
    await page.waitForTimeout(2200);

    const iframe = page.locator('iframe[title="Workflow Canvas"]').first();
    await iframe.waitFor({ state: "visible", timeout: 60000 });
    report.iframeVisible = true;
    report.iframeSrc = await iframe.getAttribute("src");

    const iframeHandle = await iframe.elementHandle();
    const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
    if (!frame) {
      throw new Error("Workflow iframe contentFrame is null.");
    }

    await frame.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000);

    report.frameUrl = frame.url();
    report.redirectedToSignIn = /\/sign-?in\b/i.test(report.frameUrl || "");
    report.frameTitle = await frame.title().catch(() => null);

    const bodyText = await frame.locator("body").innerText().catch(() => "");
    report.frameBodyChars = bodyText.length;
    report.frameBodyPreview = bodyText.slice(0, 600);

    await page.screenshot({ path: "playwright-workflow-embed-smoke.png", fullPage: true });
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: "playwright-workflow-embed-smoke-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-workflow-embed-smoke.json", JSON.stringify(report, null, 2), "utf8");
    await context.close();
    await browser.close();
  }

  if (!report.loginOk || !report.iframeVisible || report.redirectedToSignIn || report.frameBodyChars < 100) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  fs.writeFileSync("playwright-workflow-embed-smoke.json", JSON.stringify(report, null, 2), "utf8");
  console.error(error);
  process.exit(1);
});
