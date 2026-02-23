const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.PMOS_BASE_URL || "https://os.wickedlab.io";
const EMAIL = process.env.PMOS_EMAIL;
const PASSWORD = process.env.PMOS_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Missing PMOS_EMAIL or PMOS_PASSWORD");
  process.exit(1);
}

const report = {
  runTs: Date.now(),
  loginOk: false,
  network: {
    nodeCatalogHits: 0,
    nodeTypeCount: 0,
    basecampMatches: [],
    urls: [],
  },
  iframe: {
    src: null,
    frameUrl: null,
    bodyChars: 0,
    bodyPreview: null,
  },
  nodeSearch: {
    openedCreator: false,
    searched: false,
    foundBasecamp: false,
    foundWords: [],
    error: null,
  },
  errors: [],
};

async function isVisible(locator, timeout = 1200) {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const exact = nav.getByText(label, { exact: true }).first();
  if (await isVisible(exact, 800)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
  const page = await context.newPage();
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!/\/types\/nodes\.json|\/rest\/node-types/i.test(url)) {
        return;
      }
      report.network.nodeCatalogHits += 1;
      if (report.network.urls.length < 12) {
        report.network.urls.push(url);
      }
      const text = await response.text().catch(() => "");
      if (!text) return;
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }
      const rows = [];
      if (Array.isArray(payload)) {
        rows.push(...payload);
      } else if (Array.isArray(payload?.data)) {
        rows.push(...payload.data);
      } else if (payload && typeof payload === "object") {
        for (const [name, value] of Object.entries(payload)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          rows.push({ name, ...value });
        }
      }
      const names = rows
        .map((row) => (typeof row?.name === "string" ? row.name : ""))
        .filter(Boolean);
      report.network.nodeTypeCount = Math.max(report.network.nodeTypeCount, names.length);
      const matches = names.filter((name) => String(name).toLowerCase().includes("basecamp"));
      for (const match of matches) {
        if (!report.network.basecampMatches.includes(match)) {
          report.network.basecampMatches.push(match);
        }
      }
    } catch {
      // Ignore diagnostics errors.
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    if (!(await isVisible(page.getByRole("button", { name: /^Sign out$/i }).first(), 2500))) {
      await page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first().fill(EMAIL);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/i }).first().click();
    }
    await page.getByRole("button", { name: /^Sign out$/i }).first().waitFor({ state: "visible", timeout: 120000 });
    report.loginOk = true;

    await clickNav(page, "Workflows");
    await page.waitForTimeout(1800);

    // Select first workflow card so n8n editor usually opens a flow view.
    const flowItem = page.locator(".list .list-item").first();
    if (await isVisible(flowItem, 1200)) {
      await flowItem.click();
      await page.waitForTimeout(1500);
    }

    const iframe = page.locator('iframe[title="n8n Workflow Canvas"]').first();
    await iframe.waitFor({ state: "visible", timeout: 60000 });
    report.iframe.src = await iframe.getAttribute("src");

    const iframeHandle = await iframe.elementHandle();
    const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
    if (!frame) {
      throw new Error("iframe contentFrame is null");
    }

    await frame.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
    await frame.waitForTimeout(4000);

    report.iframe.frameUrl = frame.url();
    const bodyText = await frame.locator("body").innerText().catch(() => "");
    report.iframe.bodyChars = bodyText.length;
    report.iframe.bodyPreview = bodyText.slice(0, 600);

    const searchSelectors = [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      '[data-test-id*="node-creator-search"] input',
    ];

    async function openCreator() {
      const openSelectors = [
        'button[aria-label*="Create node"]',
        'button[aria-label*="Add node"]',
        '[data-test-id*="node-creator-plus-button"]',
        '[data-test-id*="canvas-add-button"]',
        'button:has-text("+")',
      ];
      for (const selector of openSelectors) {
        const btn = frame.locator(selector).first();
        if (await isVisible(btn, 1000)) {
          await btn.click().catch(() => {});
          await frame.waitForTimeout(800);
          report.nodeSearch.openedCreator = true;
          return true;
        }
      }
      return false;
    }

    async function searchAndCapture(term) {
      for (const selector of searchSelectors) {
        const input = frame.locator(selector).first();
        if (!(await isVisible(input, 1000))) continue;
        await input.fill(term).catch(() => {});
        await frame.waitForTimeout(900);
        report.nodeSearch.searched = true;
        const text = await frame.locator("body").innerText().catch(() => "");
        const lower = text.toLowerCase();
        if (term.toLowerCase() === "basecamp") {
          report.nodeSearch.foundBasecamp = lower.includes("basecamp");
          report.nodeSearch.foundWords = ["basecamp", "todo", "project", "custom node"].filter((word) =>
            lower.includes(word),
          );
        }
        return lower;
      }
      return "";
    }

    // Attempt 1: direct search (works when editor is in generic add-node mode).
    await openCreator();
    let lowerText = await searchAndCapture("basecamp");

    // Attempt 2: if this is trigger-only mode, create a trigger first, then re-open add-node.
    if (!report.nodeSearch.foundBasecamp && lowerText.includes("what triggers this workflow")) {
      await searchAndCapture("manual");
      const manualOption = frame.getByText(/manual trigger|when clicking/i).first();
      if (await isVisible(manualOption, 1500)) {
        await manualOption.click().catch(() => {});
        await frame.waitForTimeout(1600);
      }
      await openCreator();
      await searchAndCapture("basecamp");
    }

    await page.screenshot({ path: "playwright-basecamp-ui-check.png", fullPage: true });
  } catch (error) {
    report.errors.push(String(error));
    report.nodeSearch.error = String(error);
    await page.screenshot({ path: "playwright-basecamp-ui-check-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-basecamp-ui-check.json", JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  fs.writeFileSync("playwright-basecamp-ui-check.json", JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});