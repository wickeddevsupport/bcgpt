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
const token = `PW_ROHIT_${runTs}`;
const report = {
  runTs,
  baseUrl: BASE_URL,
  email: EMAIL,
  auth: {
    signInPageSeen: false,
    signOutSeen: false,
    signOutBeforeLogin: false,
    verifiedUserEmail: null,
    verifiedRoleText: null,
    ok: false,
  },
  models: {
    navOk: false,
    saveClicked: false,
    savedChipVisible: false,
    modelErrorText: null,
    refVisible: false,
    disabledReason: null,
  },
  agents: {
    navOk: false,
    createOpened: false,
    createSubmitted: false,
    createOk: false,
    createErrorText: null,
    saveClicked: false,
    saveErrorText: null,
    filesTabOk: false,
  },
  workflows: {
    navOk: false,
    panelOpened: false,
    createAttempted: false,
    createButtonEnabled: false,
    createOk: false,
    createErrorText: null,
    nameVisibleInList: false,
    selectedFlowIdSeen: false,
  },
  network: {
    toolsInvoke: [],
    wsSentMethods: [],
    wsErrors: [],
    wsRpcTail: [],
  },
  errors: [],
};

const wsFrames = [];
const toolRequests = [];
const toolResponses = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(input) {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

async function isVisible(locator, timeout = 1200) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

function pushBounded(arr, value, max = 40) {
  arr.push(value);
  while (arr.length > max) arr.shift();
}

function captureWsFrame(frame, dir) {
  const payload = typeof frame?.payload === "string" ? frame.payload : null;
  if (!payload) return;
  const parsed = safeJsonParse(payload);
  const row = {
    ts: Date.now(),
    dir,
    payload,
    method: parsed && typeof parsed.method === "string" ? parsed.method : null,
    id: parsed && Object.prototype.hasOwnProperty.call(parsed, "id") ? parsed.id : null,
    ok: parsed && typeof parsed.ok === "boolean" ? parsed.ok : null,
    error:
      parsed && parsed.ok === false
        ? (typeof parsed.error === "string"
          ? parsed.error
          : parsed.error && typeof parsed.error.message === "string"
            ? parsed.error.message
            : JSON.stringify(parsed.error ?? null))
        : null,
  };
  pushBounded(wsFrames, row, 500);
  if (row.dir === "sent" && row.method) {
    if (!report.network.wsSentMethods.includes(row.method)) {
      report.network.wsSentMethods.push(row.method);
    }
  }
  if (row.error) {
    pushBounded(report.network.wsErrors, row, 20);
  }
  if (
    row.method ||
    row.error ||
    payload.includes("pmos.") ||
    payload.includes("agents.") ||
    payload.includes("config.")
  ) {
    pushBounded(report.network.wsRpcTail, row, 20);
  }
}

async function clickVisibleButtonByName(page, nameRe, timeout = 2000) {
  const buttons = page.getByRole("button", { name: nameRe });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    if (await isVisible(btn, 400)) {
      await btn.click();
      return true;
    }
  }
  if (timeout > 0) {
    await sleep(timeout);
    return clickVisibleButtonByName(page, nameRe, 0);
  }
  return false;
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const titledAnchor = nav.locator(`a.nav-item[title="${label}"]`).first();
  if (await isVisible(titledAnchor, 800)) {
    await titledAnchor.click();
    return;
  }
  const exact = nav.getByText(label, { exact: true });
  const exactCount = await exact.count();
  for (let i = 0; i < exactCount; i += 1) {
    const item = exact.nth(i);
    if (await isVisible(item, 500)) {
      await item.click();
      return;
    }
  }
  const fallback = nav.getByText(new RegExp(`^${label}$|${label}`, "i"));
  const fallbackCount = await fallback.count();
  for (let i = 0; i < fallbackCount; i += 1) {
    const item = fallback.nth(i);
    if (await isVisible(item, 500)) {
      await item.click();
      return;
    }
  }
  throw new Error(`Navigation item not found: ${label}`);
}

async function getVisibleBodyText(page) {
  try {
    return await page.locator("body").innerText();
  } catch {
    return "";
  }
}

async function ensureLoggedInAsRohit(page) {
  const signOutButtons = page.getByRole("button", { name: /^Sign out$/i });
  const signOutCount = await signOutButtons.count();
  let signOutVisible = false;
  for (let i = 0; i < signOutCount; i += 1) {
    if (await isVisible(signOutButtons.nth(i), 600)) {
      signOutVisible = true;
      break;
    }
  }
  report.auth.signOutSeen = signOutVisible;

  const bodyTextBefore = (await getVisibleBodyText(page)).toLowerCase();
  const alreadyRohit = bodyTextBefore.includes(EMAIL.toLowerCase());

  if (signOutVisible && !alreadyRohit) {
    report.auth.signOutBeforeLogin = true;
    await clickVisibleButtonByName(page, /^Sign out$/i);
    await page.waitForTimeout(1200);
  }

  const emailInput = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
  const passwordInput = page
    .locator('input[type="password"][autocomplete="current-password"], input[type="password"]')
    .first();

  if (await isVisible(emailInput, 3500)) {
    report.auth.signInPageSeen = true;
    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    const clicked = await clickVisibleButtonByName(page, /^Sign in$/i, 1200);
    if (!clicked) {
      throw new Error("Could not find visible Sign in button.");
    }
  }

  // After submit, the UI often shows a transient "Restoring your session..." screen.
  // Wait for either the signed-in shell (Sign out), a returned auth form, or an error pill.
  const authDeadline = Date.now() + 120000;
  let signOutNowVisible = false;
  while (Date.now() < authDeadline) {
    const signOut = page.getByRole("button", { name: /^Sign out$/i });
    if (await isVisible(signOut.first(), 500)) {
      signOutNowVisible = true;
      break;
    }

    const errorPill = page.locator(".pill.danger:visible").first();
    if (await isVisible(errorPill, 200)) {
      const txt = (await errorPill.innerText().catch(() => "")).trim();
      const msg = txt || "unknown auth error";
      if (/invalid email or password/i.test(msg)) {
        const switched = await clickVisibleButtonByName(page, /^Create account$/i, 800);
        if (!switched) {
          throw new Error(`Sign in failed and signup fallback unavailable: ${msg}`);
        }
        await page.waitForTimeout(500);
        const nameInput = page.locator('input[autocomplete="name"], input[placeholder="Your name"]').first();
        const signupEmail = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
        const signupPassword = page
          .locator('input[type="password"][autocomplete="new-password"], input[type="password"]')
          .first();
        await nameInput.fill("Rohit");
        await signupEmail.fill(EMAIL);
        await signupPassword.fill(PASSWORD);
        const createClicked = await clickVisibleButtonByName(page, /^Create account$/i, 1200);
        if (!createClicked) {
          throw new Error(`Signup fallback could not submit: ${msg}`);
        }
        // continue outer wait loop; we may now authenticate or get a duplicate-user error
        await page.waitForTimeout(700);
        continue;
      }
      if (/already|exists|in use/i.test(msg)) {
        throw new Error(`Signup/login auth conflict: ${msg}`);
      }
      throw new Error(`Sign in failed: ${msg}`);
    }

    // If the sign-in form returns and loading message is gone, auth likely failed silently.
    const emailBack = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
    const restoring = page.getByText(/Restoring your session/i).first();
    if ((await isVisible(emailBack, 200)) && !(await isVisible(restoring, 200))) {
      const body = await getVisibleBodyText(page);
      const line =
        body.match(/(Sign in failed[^\n]*|Invalid[^\n]*|Unauthorized[^\n]*)/i)?.[0] ??
        "returned to sign-in screen";
      throw new Error(`Sign in did not complete: ${line}`);
    }

    await page.waitForTimeout(400);
  }
  if (!signOutNowVisible) {
    throw new Error("Sign out button never became visible after login (timeout).");
  }

  const bodyText = await getVisibleBodyText(page);
  const lower = bodyText.toLowerCase();
  const rohitSeen = lower.includes(EMAIL.toLowerCase());
  const wsAdminMatch = bodyText.match(/Workspace Admin\s+([^\s]+@[^\s]+)/i);
  report.auth.verifiedUserEmail = rohitSeen
    ? EMAIL
    : (wsAdminMatch ? wsAdminMatch[1] : null);
  report.auth.verifiedRoleText = wsAdminMatch ? "Workspace Admin" : (bodyText.includes("Super Admin") ? "Super Admin" : null);

  if (!rohitSeen) {
    throw new Error(
      `Logged in session is not ${EMAIL}. Top bar/body appears to show ${report.auth.verifiedUserEmail || "unknown user"}.`,
    );
  }
  report.auth.ok = true;
}

async function testModels(page) {
  await clickNav(page, "Models");
  report.models.navOk = true;
  await page.waitForTimeout(1500);

  const bodyTextNow = await getVisibleBodyText(page);
  if (/Disconnected from gateway\./i.test(bodyTextNow)) {
    report.models.modelErrorText = "Disconnected from gateway.";
    throw new Error("Gateway disconnected in PMOS UI; feature flows unavailable.");
  }

  let modelsCard = page.locator(".card", { hasText: "Add Or Update Model" }).first();
  if (!(await isVisible(modelsCard, 3000))) {
    // Production may be on an older models UI. Capture the page text and bail cleanly.
    report.models.modelErrorText = "Expected model manager card not rendered (production UI mismatch or regression).";
    throw new Error("Models tab did not render expected 'Add Or Update Model' UI.");
  }

  const disabledReason = await page.getByText(/Sign in to your workspace to configure models\./i).first().isVisible().catch(() => false);
  if (disabledReason) {
    report.models.disabledReason = "Sign in to your workspace to configure models.";
  }

  const providerInput = modelsCard.locator('label.field:has-text("Provider") input').first();
  const modelIdInput = modelsCard.locator('label.field:has-text("Model ID") input').first();
  const aliasInput = modelsCard.locator('label.field:has-text("Alias") input').first();

  await providerInput.fill("local-ollama");
  await modelIdInput.fill("qwen3:1.7b");
  await aliasInput.fill(`Rohit Probe ${runTs}`);

  const saveModelButton = modelsCard.getByRole("button", { name: /^Save Model$/i }).first();
  report.models.saveClicked = false;
  const enabled = await saveModelButton.isEnabled().catch(() => false);
  if (!enabled) {
    const body = await getVisibleBodyText(page);
    report.models.modelErrorText =
      body.match(/No configured models found\.[\s\S]{0,120}/i)?.[0] ??
      body.match(/super-admin[\s\S]{0,160}/i)?.[0] ??
      "Save Model button disabled";
    return;
  }

  await saveModelButton.click();
  report.models.saveClicked = true;
  await page.waitForTimeout(2500);

  const savedChip = page.locator(".chip.chip-ok", { hasText: /^Saved$/i }).first();
  report.models.savedChipVisible = await isVisible(savedChip, 8000);

  const dangerCallout = page.locator(".callout.danger:visible").first();
  if (await isVisible(dangerCallout, 1000)) {
    report.models.modelErrorText = (await dangerCallout.innerText()).trim();
  }

  const refText = page.getByText(/local-ollama\/qwen3:1\.7b/i).first();
  report.models.refVisible = await isVisible(refText, 8000);
}

async function testAgents(page) {
  const agentName = `PW_ROHIT_AGENT_${runTs}`;
  await clickNav(page, "Agents");
  report.agents.navOk = true;
  await page.waitForTimeout(1500);

  let openCreate = page.getByRole("button", { name: /^\+?\s*New$/i });
  let clickedCreate = false;
  for (let i = 0; i < await openCreate.count(); i += 1) {
    const btn = openCreate.nth(i);
    if (await isVisible(btn, 700)) {
      await btn.click();
      clickedCreate = true;
      break;
    }
  }
  if (!clickedCreate) {
    const manageAgents = page.getByRole("button", { name: /^Manage Agents$/i }).first();
    if (await isVisible(manageAgents, 1200)) {
      await manageAgents.click();
      await page.waitForTimeout(1600);
    }
    openCreate = page.getByRole("button", { name: /^\+?\s*New$/i });
    for (let i = 0; i < await openCreate.count(); i += 1) {
      const btn = openCreate.nth(i);
      if (await isVisible(btn, 700)) {
        await btn.click();
        clickedCreate = true;
        break;
      }
    }
  }
  if (!clickedCreate) {
    throw new Error("Could not open Agents create modal.");
  }

  const modal = page.locator('[role="dialog"]', { hasText: /Create Agent/i }).first();
  await modal.waitFor({ state: "visible", timeout: 20000 });
  report.agents.createOpened = true;

  const nameInput = modal.locator('input[placeholder="e.g. Sales Agent"]').first();
  await nameInput.fill(agentName);
  await modal.getByRole("button", { name: /^Next$/i }).click();
  await page.waitForTimeout(300);
  if (await isVisible(modal.getByRole("button", { name: /^Next$/i }).first(), 1000)) {
    await modal.getByRole("button", { name: /^Next$/i }).click();
    await page.waitForTimeout(300);
  }
  const createButton = modal.getByRole("button", { name: /^Create Agent$/i }).first();
  await createButton.click();
  report.agents.createSubmitted = true;

  try {
    await modal.waitFor({ state: "hidden", timeout: 120000 });
  } catch {
    const modalText = (await modal.innerText().catch(() => "")).trim();
    report.agents.createErrorText = modalText || "Create modal did not close";
    return;
  }

  await page.waitForTimeout(1800);
  const createdCard = page.getByText(new RegExp(agentName, "i")).first();
  report.agents.createOk = await isVisible(createdCard, 20000);
  if (!report.agents.createOk) {
    const body = await getVisibleBodyText(page);
    report.agents.createErrorText =
      body.match(/super-admin[\s\S]{0,180}/i)?.[0] ??
      body.match(/error[\s\S]{0,180}/i)?.[0] ??
      "Created agent not visible";
    return;
  }

  await createdCard.click().catch(() => {});
  const fallbackInput = page.locator('input[placeholder="provider/model, provider/model"]').first();
  if (await isVisible(fallbackInput, 20000)) {
    await fallbackInput.fill("local-ollama/qwen3:1.7b");
    const saveButtons = page.getByRole("button", { name: /^Save$/i });
    for (let i = 0; i < await saveButtons.count(); i += 1) {
      const btn = saveButtons.nth(i);
      if (await isVisible(btn, 600)) {
        await btn.click();
        report.agents.saveClicked = true;
        break;
      }
    }
    await page.waitForTimeout(2500);
    const body = await getVisibleBodyText(page);
    if (/super-admin|forbidden|workspace/i.test(body)) {
      const match = body.match(/(super-admin[\s\S]{0,180}|forbidden[\s\S]{0,180}|workspace[^.\n]*error[\s\S]{0,120})/i);
      if (match) report.agents.saveErrorText = match[1];
    }
  }

  const filesTab = page.getByRole("button", { name: /^Files$/i }).first();
  if (await isVisible(filesTab, 2000)) {
    await filesTab.click();
    await page.waitForTimeout(1200);
    const filesMarker = page.getByText(/Core Files|Workspace Files|Bootstrap Files|AGENTS\.md/i).first();
    report.agents.filesTabOk = await isVisible(filesMarker, 7000);
  }
}

async function testWorkflows(page) {
  await clickNav(page, "Workflows");
  report.workflows.navOk = true;
  await page.waitForTimeout(2000);

  const showPanel = page.getByRole("button", { name: /Show Panel|Hide Panel/i });
  for (let i = 0; i < await showPanel.count(); i += 1) {
    const btn = showPanel.nth(i);
    if (!(await isVisible(btn, 600))) continue;
    const text = ((await btn.innerText().catch(() => "")) || "").toLowerCase();
    if (text.includes("show")) {
      await btn.click();
      await page.waitForTimeout(800);
    }
    report.workflows.panelOpened = true;
    break;
  }

  const workflowsTabBtn = page.getByRole("button", { name: /^Workflows$/i });
  for (let i = 0; i < await workflowsTabBtn.count(); i += 1) {
    const btn = workflowsTabBtn.nth(i);
    if (await isVisible(btn, 600)) {
      await btn.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(900);

  const panel = page.locator(".automations-left-panel").first();
  if (!(await isVisible(panel, 6000))) {
    throw new Error("Workflows left panel not visible.");
  }

  const createBlock = panel.locator(':scope', { hasText: "Create workflow" }).first();
  const createInput = panel.locator('input[placeholder="Flow name..."]').first();
  const createButton = panel.getByRole("button", { name: /^Create$/i }).first();
  await createBlock.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

  report.workflows.createButtonEnabled = await createButton.isEnabled().catch(() => false);
  const wfName = `PW_ROHIT_FLOW_${runTs}`;
  report.workflows.createAttempted = true;

  if (!report.workflows.createButtonEnabled) {
    const body = await getVisibleBodyText(page);
    report.workflows.createErrorText =
      body.match(/Set a project in Integrations[\s\S]{0,120}/i)?.[0] ??
      body.match(/Sign in to your workspace to manage workflows[\s\S]{0,120}/i)?.[0] ??
      "Create workflow button disabled";
    return;
  }

  await createInput.fill(wfName);
  await createButton.click();
  await page.waitForTimeout(3000);

  const createError = panel.locator('[style*="color:var(--color-danger)"]:visible').first();
  if (await isVisible(createError, 1000)) {
    report.workflows.createErrorText = (await createError.innerText()).trim();
  }

  const listName = panel.getByText(new RegExp(wfName, "i")).first();
  report.workflows.nameVisibleInList = await isVisible(listName, 12000);
  if (report.workflows.nameVisibleInList) {
    await listName.click().catch(() => {});
    report.workflows.createOk = true;
  }

  const body = await getVisibleBodyText(page);
  const selectedMatch = body.match(/Editing:\s*([^\n]+)/i);
  if (selectedMatch) report.workflows.selectedFlowIdSeen = true;
}

function summarizeToolTraffic() {
  const merged = [];
  for (const req of toolRequests) {
    const res = toolResponses.find((r) => r.requestId === req.requestId);
    merged.push({
      requestId: req.requestId,
      tool: req.tool,
      args: req.args,
      status: res ? res.status : null,
      ok: res ? res.ok : null,
      error: res ? res.error : null,
    });
  }
  report.network.toolsInvoke = merged.slice(-25);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1560, height: 940 } });
  const page = await context.newPage();

  page.on("websocket", (ws) => {
    ws.on("framesent", (event) => captureWsFrame(event, "sent"));
    ws.on("framereceived", (event) => captureWsFrame(event, "recv"));
  });

  let reqCounter = 0;
  page.on("request", (request) => {
    try {
      const url = request.url();
      if (!/\/tools\/invoke(?:\?|$)/.test(url) || request.method() !== "POST") return;
      const body = request.postData() || "";
      const parsed = safeJsonParse(body);
      const id = ++reqCounter;
      request.__pwToolReqId = id; // eslint-disable-line no-underscore-dangle
      toolRequests.push({
        requestId: id,
        url,
        tool: parsed && typeof parsed.tool === "string" ? parsed.tool : null,
        args: parsed && parsed.args && typeof parsed.args === "object" ? parsed.args : null,
      });
      if (toolRequests.length > 60) toolRequests.shift();
    } catch {
      // ignore instrumentation errors
    }
  });
  page.on("response", async (response) => {
    try {
      const req = response.request();
      const url = response.url();
      if (!/\/tools\/invoke(?:\?|$)/.test(url) || req.method() !== "POST") return;
      const requestId = req.__pwToolReqId || null; // eslint-disable-line no-underscore-dangle
      const status = response.status();
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      toolResponses.push({
        requestId,
        status,
        ok: parsed && typeof parsed.ok === "boolean" ? parsed.ok : null,
        error:
          parsed && parsed.ok === false
            ? (parsed.error?.message || parsed.error?.type || JSON.stringify(parsed.error || null))
            : null,
      });
      if (toolResponses.length > 60) toolResponses.shift();
    } catch {
      // ignore
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    await ensureLoggedInAsRohit(page);
    await page.screenshot({ path: `playwright-rohit-after-login-${runTs}.png`, fullPage: true });

    await testModels(page);
    await page.screenshot({ path: `playwright-rohit-models-${runTs}.png`, fullPage: true }).catch(() => {});

    await testAgents(page);
    await page.screenshot({ path: `playwright-rohit-agents-${runTs}.png`, fullPage: true }).catch(() => {});

    await testWorkflows(page);
    await page.screenshot({ path: `playwright-rohit-workflows-${runTs}.png`, fullPage: true }).catch(() => {});
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: `playwright-rohit-probe-error-${runTs}.png`, fullPage: true }).catch(() => {});
  } finally {
    summarizeToolTraffic();
    fs.writeFileSync(
      `playwright-rohit-regression-probe-${runTs}.json`,
      JSON.stringify(report, null, 2),
      "utf8",
    );
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  summarizeToolTraffic();
  fs.writeFileSync(
    `playwright-rohit-regression-probe-${runTs}.json`,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.error(error);
  process.exit(1);
});
