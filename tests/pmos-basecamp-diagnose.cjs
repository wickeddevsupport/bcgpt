const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.PMOS_BASE_URL || "https://os.wickedlab.io";
const EMAIL = process.env.PMOS_EMAIL;
const PASSWORD = process.env.PMOS_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Missing PMOS_EMAIL or PMOS_PASSWORD env vars.");
  process.exit(1);
}

const result = {
  runTs: Date.now(),
  baseUrl: BASE_URL,
  loginOk: false,
  nodeTypesFetch: {
    ok: false,
    status: null,
    total: 0,
    basecampMatches: [],
    sampleCustomNodes: [],
    error: null,
  },
  networkNodeTypes: {
    seen: false,
    count: 0,
    basecampMatches: [],
  },
  nodePickerUi: {
    opened: false,
    basecampVisible: false,
    error: null,
  },
  errors: [],
};

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function isVisible(locator, timeout = 1500) {
  try {
    return await locator.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const exact = nav.getByText(label, { exact: true }).first();
  if (await isVisible(exact, 1000)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  const page = await context.newPage();

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/rest/node-types")) return;
    result.networkNodeTypes.seen = true;
    const json = await response.json().catch(() => null);
    const rawRows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    const names = rawRows
      .map((row) => (row && typeof row.name === "string" ? row.name : null))
      .filter(Boolean);
    result.networkNodeTypes.count = Math.max(result.networkNodeTypes.count, names.length);
    const matches = names.filter((name) => String(name).toLowerCase().includes("basecamp"));
    for (const match of matches) {
      if (!result.networkNodeTypes.basecampMatches.includes(match)) {
        result.networkNodeTypes.basecampMatches.push(match);
      }
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    const signedIn = await isVisible(page.getByRole("button", { name: /^Sign out$/i }).first(), 2500);
    if (!signedIn) {
      await page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first().fill(EMAIL);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/i }).first().click();
    }

    await page.getByRole("button", { name: /^Sign out$/i }).first().waitFor({ state: "visible", timeout: 120000 });
    result.loginOk = true;

    await clickNav(page, "Workflows");
    await page.waitForTimeout(2500);

    // Direct node-types fetch through the same browser session/cookies.
    const fetched = await page.evaluate(async () => {
      try {
        const targets = ["/ops-ui/rest/node-types", "/rest/node-types"];
        for (const target of targets) {
          const res = await fetch(target, { credentials: "include" });
          const text = await res.text();
          const json = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })();
          const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
          if (res.ok && rows.length > 0) {
            return { ok: true, status: res.status, target, rows };
          }
        }
        return { ok: false, status: null, target: null, rows: [], error: "No node-types endpoint returned rows" };
      } catch (error) {
        return { ok: false, status: null, target: null, rows: [], error: String(error) };
      }
    });

    result.nodeTypesFetch.ok = Boolean(fetched?.ok);
    result.nodeTypesFetch.status = fetched?.status ?? null;
    if (fetched?.ok) {
      const rows = Array.isArray(fetched.rows) ? fetched.rows : [];
      const names = rows
        .map((row) => (row && typeof row.name === "string" ? row.name : null))
        .filter(Boolean);
      result.nodeTypesFetch.total = names.length;
      result.nodeTypesFetch.basecampMatches = names.filter((name) =>
        String(name).toLowerCase().includes("basecamp"),
      );
      result.nodeTypesFetch.sampleCustomNodes = names.filter((name) => !String(name).startsWith("n8n-nodes-base.")).slice(0, 30);
    } else {
      result.nodeTypesFetch.error = fetched?.error ?? "node-types fetch failed";
    }

    // Try opening node picker and searching for basecamp in UI.
    try {
      const iframe = page.locator('iframe[title="n8n Workflow Canvas"]').first();
      await iframe.waitFor({ state: "visible", timeout: 30000 });
      const frame = await iframe.contentFrame();
      if (frame) {
        const plusSelectors = [
          'button[aria-label*="Add"]',
          'button[aria-label*="Create node"]',
          'button:has-text("+")',
          '[data-test-id*="canvas-add"]',
          '[data-test-id*="add-node"]',
        ];
        for (const selector of plusSelectors) {
          const loc = frame.locator(selector).first();
          if (await isVisible(loc, 800)) {
            await loc.click().catch(() => {});
            result.nodePickerUi.opened = true;
            break;
          }
        }

        if (!result.nodePickerUi.opened) {
          // fallback: keyboard shortcut that opens node creator in n8n editor
          await frame.keyboard.press("Tab").catch(() => {});
          await frame.keyboard.press("a").catch(() => {});
          await frame.waitForTimeout(600);
        }

        const searchCandidates = [
          'input[placeholder*="Search"]',
          'input[aria-label*="Search"]',
          '[data-test-id*="node-creator-search"] input',
        ];
        for (const selector of searchCandidates) {
          const input = frame.locator(selector).first();
          if (await isVisible(input, 1200)) {
            await input.fill("basecamp").catch(() => {});
            result.nodePickerUi.opened = true;
            await frame.waitForTimeout(800);
            const text = await frame.locator("body").innerText().catch(() => "");
            result.nodePickerUi.basecampVisible = /basecamp/i.test(text);
            break;
          }
        }
      }
    } catch (error) {
      result.nodePickerUi.error = String(error);
    }

    await page.screenshot({ path: "playwright-basecamp-diagnose.png", fullPage: true });
  } catch (error) {
    result.errors.push(String(error));
    await page.screenshot({ path: "playwright-basecamp-diagnose-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-basecamp-diagnose.json", JSON.stringify(result, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  result.errors.push(String(error));
  fs.writeFileSync("playwright-basecamp-diagnose.json", JSON.stringify(result, null, 2));
  console.error(error);
  process.exit(1);
});
