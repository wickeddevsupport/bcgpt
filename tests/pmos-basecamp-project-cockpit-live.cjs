const fs = require("fs");
const { chromium } = require("playwright");

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

const BASE_URL = process.env.PMOS_BASE_URL || argValue("--base-url") || "https://os.wickedlab.io";
const EMAIL = process.env.PMOS_EMAIL || argValue("--email");
const PASSWORD =
  process.env.PMOS_PASSWORD ||
  (process.env.PMOS_PASSWORD_B64 ? Buffer.from(process.env.PMOS_PASSWORD_B64, "base64").toString("utf8") : null) ||
  (argValue("--password-b64") ? Buffer.from(String(argValue("--password-b64")), "base64").toString("utf8") : null);
const PROJECT_NAME = process.env.PMOS_PROJECT_NAME || argValue("--project") || "BCGPT TEST PROJECT";

if (!EMAIL || !PASSWORD) {
  console.error("Missing PMOS_EMAIL or PMOS_PASSWORD");
  process.exit(1);
}

const runTs = Date.now();
const TODO_TITLE = `PW Cockpit Todo ${runTs}`;
const COMMENT_TEXT = `Playwright verification comment ${runTs}`;

const report = {
  runTs,
  baseUrl: BASE_URL,
  projectName: PROJECT_NAME,
  todoTitle: TODO_TITLE,
  loginOk: false,
  commandCenterOk: false,
  projectOpenOk: false,
  createTodoOk: false,
  detailOpenOk: false,
  completeOk: false,
  reopenOk: false,
  commentOk: false,
  errors: [],
  consoleErrors: [],
  uiSummary: null,
  ws: {
    urls: [],
    closes: [],
    sentMethods: [],
    snapshotResult: null,
    snapshotError: null,
    detailError: null,
    tail: [],
  },
  failedRequests: [],
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
  if (await isVisible(exact, 800)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function waitForText(page, text, timeout = 30000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

async function openProjectsWorkspace(page) {
  const navProjects = page.locator("aside").getByText(/^Projects$/i).first();
  if (await isVisible(navProjects, 1500)) {
    await navProjects.click();
    return;
  }

  const dashboardProjects = page.getByRole("button", { name: /^Open Projects$/i }).first();
  if (await isVisible(dashboardProjects, 1500)) {
    await dashboardProjects.click();
    return;
  }

  const genericProjects = page.getByText(/Projects/i, { exact: false }).first();
  await genericProjects.click();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 980 } });
  const page = await context.newPage();
  const wsFrames = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      report.consoleErrors.push(msg.text());
    }
  });

  page.on("response", async (response) => {
    try {
      if (response.status() >= 400) {
        report.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        if (report.failedRequests.length > 20) report.failedRequests.shift();
      }
    } catch {}
  });

  page.on("websocket", (ws) => {
    report.ws.urls.push(ws.url());
    ws.on("framesent", (event) => {
      wsFrames.push({ dir: "sent", payload: event.payload });
      if (wsFrames.length > 400) wsFrames.shift();
    });
    ws.on("framereceived", (event) => {
      wsFrames.push({ dir: "recv", payload: event.payload });
      if (wsFrames.length > 400) wsFrames.shift();
    });
    ws.on("close", () => {
      report.ws.closes.push(`closed ${ws.url()}`);
      if (report.ws.closes.length > 12) report.ws.closes.shift();
    });
  });

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

    await openProjectsWorkspace(page);
    await waitForText(page, "Basecamp Command Center", 60000);
    report.commandCenterOk = true;
    const refreshButton = page.getByRole("button", { name: /^Refresh$/i }).first();
    if (await isVisible(refreshButton, 2000)) {
      await refreshButton.click();
      await page.waitForTimeout(5000);
    }
    report.uiSummary = await page.evaluate(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
      return {
        title: text(".card-title"),
        syncedProjects: text(".stat-value"),
        bodyText: document.body.innerText.slice(0, 3000),
      };
    });

    const sentMethods = [];
    for (const frame of wsFrames) {
      if (frame.dir !== "sent" || typeof frame.payload !== "string") continue;
      try {
        const parsed = JSON.parse(frame.payload);
        if (parsed && typeof parsed.method === "string" && !sentMethods.includes(parsed.method)) {
          sentMethods.push(parsed.method);
        }
      } catch {}
    }
    report.ws.sentMethods = sentMethods;

    for (const frame of wsFrames) {
      if (frame.dir !== "recv" || typeof frame.payload !== "string") continue;
      report.ws.tail.push(String(frame.payload).slice(0, 600));
      if (report.ws.tail.length > 12) report.ws.tail.shift();
      try {
        const parsed = JSON.parse(frame.payload);
        const payloadText = JSON.stringify(parsed);
        if (!report.ws.snapshotResult && payloadText.includes("pmos.projects.snapshot")) {
          report.ws.snapshotResult = parsed;
        }
        if (!report.ws.snapshotError && /pmos\.projects\.snapshot/i.test(payloadText) && /error/i.test(payloadText)) {
          report.ws.snapshotError = parsed;
        }
        if (!report.ws.detailError && /pmos\.entity\.detail|pmos_entity_detail/i.test(payloadText) && /error|Unauthorized/i.test(payloadText)) {
          report.ws.detailError = parsed;
        }
      } catch {}
    }

    const search = page.locator('input[placeholder="Search projects..."]').first();
    await search.fill(PROJECT_NAME);
    await page.waitForTimeout(1800);

    const openButton = page.getByRole("button", { name: /Open cockpit|Explore/i }).first();
    await openButton.click();
    await waitForText(page, PROJECT_NAME, 30000);
    report.projectOpenOk = true;

    await page.locator('input[placeholder="What needs to happen?"]').first().fill(TODO_TITLE);
    await page.getByRole("button", { name: /^Create todo$/i }).first().click();
    await page.waitForTimeout(2500);
    if (await isVisible(page.getByText(TODO_TITLE, { exact: false }).first(), 15000)) {
      report.createTodoOk = true;
    }

    const todoRow = page.locator(".project-section-item", { hasText: TODO_TITLE }).first();
    await todoRow.waitFor({ state: "visible", timeout: 20000 });
    await todoRow.getByRole("button", { name: /^Details$/i }).click();
    await waitForText(page, "Item Detail", 15000);
    report.detailOpenOk = true;

    const completeButton = page.getByRole("button", { name: /^Complete todo$|^Complete$/i }).first();
    await completeButton.click();
    await page.waitForTimeout(2500);
    if (await isVisible(page.getByRole("button", { name: /^Reopen todo$|^Reopen$/i }).first(), 15000)) {
      report.completeOk = true;
    }

    const commentBox = page.locator('textarea[placeholder="Write an update, note, or reply"]').first();
    if (await isVisible(commentBox, 3000)) {
      await commentBox.fill(COMMENT_TEXT);
      await page.getByRole("button", { name: /^Post comment$/i }).first().click();
      await page.waitForTimeout(2500);
      report.commentOk = await isVisible(page.getByText(COMMENT_TEXT, { exact: false }).first(), 10000);
    }

    const reopenButton = page.getByRole("button", { name: /^Reopen todo$|^Reopen$/i }).first();
    await reopenButton.click();
    await page.waitForTimeout(2500);
    if (await isVisible(page.getByRole("button", { name: /^Complete todo$|^Complete$/i }).first(), 15000)) {
      report.reopenOk = true;
    }

    await page.screenshot({ path: "pmos-project-cockpit-live.png", fullPage: true });
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: "pmos-project-cockpit-live-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("pmos-project-cockpit-live.json", JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  fs.writeFileSync("pmos-project-cockpit-live.json", JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});
