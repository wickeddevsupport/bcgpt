const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.PMOS_BASE_URL || "https://os.wickedlab.io";
const EMAIL = process.env.PMOS_EMAIL;
const PASSWORD = process.env.PMOS_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Missing PMOS_EMAIL or PMOS_PASSWORD env vars.");
  process.exit(1);
}

const runTs = Date.now();
const agentName = `PW_WS_AGENT_${runTs}`;

const report = {
  runTs,
  baseUrl: BASE_URL,
  email: EMAIL,
  loginOk: false,
  agentsNavOk: false,
  createModalOpened: false,
  createFlow: {
    submitted: false,
    createdVisible: false,
  },
  editFlow: {
    changedFallback: false,
    saveClicked: false,
    superAdminErrorVisible: false,
    saveErrorText: null,
  },
  filesPanel: {
    opened: false,
    loaded: false,
  },
  errors: [],
};

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
  if (await isVisible(exact, 900)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1580, height: 920 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    const signOut = page.getByRole("button", { name: /^Sign out$/i }).first();
    if (!(await isVisible(signOut, 2500))) {
      await page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first().fill(EMAIL);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/i }).first().click();
    }
    await signOut.waitFor({ state: "visible", timeout: 120000 });
    report.loginOk = true;

    await clickNav(page, "Agents");
    report.agentsNavOk = true;
    await page.waitForTimeout(1500);

    let openCreate = page.getByRole("button", { name: /^\+?\s*New$/i }).first();
    if (!(await isVisible(openCreate, 1500))) {
      const manageAgents = page.getByRole("button", { name: /^Manage Agents$/i }).first();
      if (await isVisible(manageAgents, 1500)) {
        await manageAgents.click();
        await page.waitForTimeout(1600);
      }
    }

    openCreate = page.getByRole("button", { name: /^\+?\s*New$/i }).first();
    if (!(await isVisible(openCreate, 1500))) {
      openCreate = page.getByRole("button", { name: /^Create Agent$/i }).first();
    }
    if (!(await isVisible(openCreate, 1500))) {
      const firstAgent = page.getByRole("button", { name: /Create your first agent/i }).first();
      if (await isVisible(firstAgent, 1500)) {
        await firstAgent.click();
      }
    } else {
      await openCreate.click();
    }

    const modal = page.locator('[role="dialog"]', { hasText: "Create Agent" }).first();
    await modal.waitFor({ state: "visible", timeout: 15000 });
    report.createModalOpened = true;

    await modal.locator('input[placeholder="e.g. Sales Agent"]').fill(agentName);
    await modal.getByRole("button", { name: /^Next$/i }).click();
    await page.waitForTimeout(400);
    await modal.getByRole("button", { name: /^Next$/i }).click();
    await page.waitForTimeout(400);
    await modal.getByRole("button", { name: /^Create Agent$/i }).click();
    report.createFlow.submitted = true;

    await modal.waitFor({ state: "hidden", timeout: 120000 });
    await page.waitForTimeout(1800);

    const createdCard = page.getByText(new RegExp(agentName, "i")).first();
    report.createFlow.createdVisible = await isVisible(createdCard, 20000);
    if (report.createFlow.createdVisible) {
      await createdCard.click().catch(() => {});
    }

    const fallbackInput = page.locator('input[placeholder="provider/model, provider/model"]').first();
    await fallbackInput.waitFor({ state: "visible", timeout: 30000 });
    await fallbackInput.fill("nvidia-nim/moonshotai/kimi-k2.5");
    report.editFlow.changedFallback = true;

    const saveButton = page.getByRole("button", { name: /^Save$/i }).first();
    await saveButton.waitFor({ state: "visible", timeout: 15000 });
    await saveButton.click();
    report.editFlow.saveClicked = true;
    await page.waitForTimeout(2500);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    report.editFlow.superAdminErrorVisible =
      bodyText.includes("super-admin") || bodyText.includes("super_admin role required");
    if (report.editFlow.superAdminErrorVisible) {
      report.editFlow.saveErrorText = "Detected super-admin privilege error after save.";
    }

    const filesTab = page.getByRole("button", { name: /^Files$/i }).first();
    if (await isVisible(filesTab, 3000)) {
      await filesTab.click();
      report.filesPanel.opened = true;
      await page.waitForTimeout(1500);
      const filesMarker = page.getByText(/Workspace Files|Bootstrap Files|Memory/i).first();
      report.filesPanel.loaded = await isVisible(filesMarker, 6000);
    }

    await page.screenshot({ path: "playwright-workspace-admin-agents-e2e.png", fullPage: true });
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: "playwright-workspace-admin-agents-e2e-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-workspace-admin-agents-e2e.json", JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  fs.writeFileSync("playwright-workspace-admin-agents-e2e.json", JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});
