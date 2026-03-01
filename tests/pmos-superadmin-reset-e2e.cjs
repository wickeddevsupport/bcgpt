/**
 * Super-admin reset-all-workspaces + Kilo Free E2E test.
 *
 * Verifies:
 *  1. Deploy has happened (Reset All Workspaces button visible in admin panel)
 *  2. Super admin login works
 *  3. WS Admin account created if not exists
 *  4. Reset All Workspaces runs successfully
 *  5. After reset: WS admin has exactly 1 agent "Workspace Assistant" with kilo model
 *
 * Run:
 *   $env:PMOS_SUPER_EMAIL="rajan@wickedwebsites.us"; $env:PMOS_SUPER_PASS="WickedOS!Temp2026#1"; node tests/pmos-superadmin-reset-e2e.cjs
 */

"use strict";
const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL = process.env.PMOS_BASE_URL || "https://os.wickedlab.io";
const SUPER_EMAIL = process.env.PMOS_SUPER_EMAIL || "rajan@wickedwebsites.us";
const SUPER_PASS = process.env.PMOS_SUPER_PASS || "WickedOS!Temp2026#1";
const WS_EMAIL = process.env.PMOS_WS_EMAIL || "testws@wickedlab.io";
const WS_PASS = process.env.PMOS_WS_PASS || "TestWS!2026#pw";
const REPORT_FILE = `playwright-superadmin-reset-${Date.now()}.json`;

const runTs = Date.now();
const report = {
  runTs,
  baseUrl: BASE_URL,
  deployVerify: { siteUp: false, pollAttempts: 0, waitedMs: 0 },
  superAdminLogin: { ok: false, email: SUPER_EMAIL },
  adminPanel: { navigated: false, resetButtonVisible: false },
  wsAccount: { email: WS_EMAIL, created: false, alreadyExists: false },
  resetRun: { clicked: false, ok: false, resultText: null },
  wsVerify: { loginOk: false, agentsCount: null, agentIds: [], agentName: null, modelRef: null, kiloModel: false, singleAgent: false },
  errors: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isVisible(locator, timeout = 2000) {
  try { return await locator.isVisible({ timeout }); } catch { return false; }
}

async function getVisibleBodyText(page) {
  try { return await page.locator("body").innerText(); } catch { return ""; }
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const titled = nav.locator(`a.nav-item[title="${label}"]`).first();
  if (await isVisible(titled, 800)) { await titled.click(); return; }
  const exact = nav.getByText(label, { exact: true });
  for (let i = 0; i < await exact.count(); i++) {
    if (await isVisible(exact.nth(i), 500)) { await exact.nth(i).click(); return; }
  }
  const fuzzy = nav.getByText(new RegExp(label, "i"));
  for (let i = 0; i < await fuzzy.count(); i++) {
    if (await isVisible(fuzzy.nth(i), 500)) { await fuzzy.nth(i).click(); return; }
  }
  throw new Error(`Nav item not found: ${label}`);
}

async function clickVisibleBtn(page, nameRe, timeout = 1500) {
  const btns = page.getByRole("button", { name: nameRe });
  for (let i = 0; i < await btns.count(); i++) {
    if (await isVisible(btns.nth(i), timeout)) { await btns.nth(i).click(); return true; }
  }
  return false;
}

async function loginAs(page, email, pass, nameForSignup = "Test User") {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Sign out if wrong user
  const soBtn = page.getByRole("button", { name: /^Sign out$/i });
  if (await isVisible(soBtn.first(), 1500)) {
    const body = (await getVisibleBodyText(page)).toLowerCase();
    if (!body.includes(email.toLowerCase())) { await soBtn.first().click(); await sleep(1200); }
  }

  const emailIn = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
  const passIn = page.locator('input[type="password"][autocomplete="current-password"], input[type="password"]').first();

  if (!(await isVisible(emailIn, 5000))) {
    const body = (await getVisibleBodyText(page)).toLowerCase();
    if (body.includes(email.toLowerCase())) return true;
    throw new Error("Login form not found");
  }

  await emailIn.fill(email);
  await passIn.fill(pass);
  if (!(await clickVisibleBtn(page, /^Sign in$/i, 1200))) throw new Error("Sign in button not found");

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await isVisible(page.getByRole("button", { name: /^Sign out$/i }).first(), 500)) return true;

    const pill = page.locator(".pill.danger:visible").first();
    if (await isVisible(pill, 200)) {
      const txt = (await pill.innerText().catch(() => "")).trim();
      if (/invalid email or password/i.test(txt)) {
        if (!(await clickVisibleBtn(page, /^Create account$/i, 800))) throw new Error(`Login failed, no signup: ${txt}`);
        await sleep(400);
        const nameIn = page.locator('input[autocomplete="name"], input[placeholder="Your name"]').first();
        const signupEmail = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
        const signupPass = page.locator('input[type="password"][autocomplete="new-password"], input[type="password"]').first();
        if (await isVisible(nameIn, 1000)) await nameIn.fill(nameForSignup);
        if (await isVisible(signupEmail, 1000)) await signupEmail.fill(email);
        if (await isVisible(signupPass, 1000)) await signupPass.fill(pass);
        if (!(await clickVisibleBtn(page, /^Create account$/i, 1200))) throw new Error("Create account submit not found");
        await sleep(700);
        continue;
      }
      if (/already|exists|in use/i.test(txt)) throw new Error(`Signup conflict: ${txt}`);
      throw new Error(`Auth error: ${txt}`);
    }

    const emailBack = page.locator('input[autocomplete="email"]').first();
    const restoring = page.getByText(/Restoring your session/i).first();
    if (await isVisible(emailBack, 200) && !(await isVisible(restoring, 200))) {
      throw new Error("Login did not complete  returned to sign-in");
    }

    await sleep(400);
  }
  throw new Error(`Login timed out for ${email}`);
}

async function readWorkspaceStateViaRPC(page) {
  return page.evaluate(async () => {
    const anyApp = document.querySelector("openclaw-app");
    if (!anyApp?.client?.request) return { error: "no client.request" };
    try {
      const [wsCfg, agentsRes] = await Promise.all([
        anyApp.client.request("pmos.config.workspace.get", {}),
        anyApp.client.request("agents.list", {}),
      ]);
      const wsCfgObj = wsCfg?.workspaceConfig || {};
      const effCfgObj = wsCfg?.effectiveConfig || {};
      const agents = Array.isArray(agentsRes?.agents) ? agentsRes.agents : [];
      return {
        workspaceId: wsCfg?.workspaceId || null,
        agents: agents.map((a) => ({ id: a?.id, name: a?.name, model: a?.model, workspaceId: a?.workspaceId })),
        wsDefaultModel: wsCfgObj?.agents?.defaults?.model || null,
        effDefaultModel: effCfgObj?.agents?.defaults?.model || null,
      };
    } catch (e) { return { error: String(e) }; }
  });
}

async function waitForSiteUp() {
  const start = Date.now();
  for (let i = 1; i <= 72; i++) {
    report.deployVerify.pollAttempts = i;
    try {
      const r = await fetch(BASE_URL + "/", { signal: AbortSignal.timeout(10000) });
      if (r.ok && (await r.text()).includes("openclaw-app")) {
        report.deployVerify.siteUp = true;
        report.deployVerify.waitedMs = Date.now() - start;
        console.log(` Site up (attempt ${i}, ${Math.round(report.deployVerify.waitedMs / 1000)}s)`);
        return true;
      }
    } catch (_) {}
    process.stdout.write(`\r   Polling deploy attempt ${i}/72`);
    await sleep(10000);
  }
  report.deployVerify.waitedMs = Date.now() - start;
  return false;
}

async function run() {
  if (!(await waitForSiteUp())) {
    report.errors.push("Site not up after 12 min");
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(`page: ${e.message}`));

  try {
    // 1. Create WS admin account (before super-admin session)
    console.log(`\n Ensuring WS admin: ${WS_EMAIL}`);
    try {
      await loginAs(page, WS_EMAIL, WS_PASS, "Test WS Admin");
      report.wsAccount.created = true;
      console.log(" WS admin account OK");
    } catch (e) {
      report.errors.push(`WS setup: ${e.message}`);
      console.log(`  WS setup: ${e.message}`);
    }

    // 2. Login as super admin
    console.log(`\n Super admin login: ${SUPER_EMAIL}`);
    await loginAs(page, SUPER_EMAIL, SUPER_PASS, "Super Admin");
    report.superAdminLogin.ok = true;
    console.log(" Super admin OK");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-1-super-login.png" });

    // 3. Navigate to Admin (it's a header button for super_admin, not sidebar nav)
    console.log("\n🛠  Navigating to Admin…");
    try {
      // "Admin Panel" button in the header (super_admin only)
      const adminHeaderBtn = page.getByRole("button", { name: /Admin Panel/i }).first();
      if (await isVisible(adminHeaderBtn, 4000)) {
        await adminHeaderBtn.click();
        report.adminPanel.navigated = true;
        await page.waitForTimeout(2000);
        console.log("✅ Admin Panel header button clicked");
      } else {
        // Fallback: try sidebar
        await clickNav(page, "Admin");
        report.adminPanel.navigated = true;
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      report.errors.push(`Admin nav: ${e.message}`);
      console.log(`⚠️  Admin nav failed: ${e.message}`);
    }
    await page.screenshot({ path: "test-2-admin.png" });

    // 4. Verify Reset All Workspaces button
    console.log("\n Checking Reset All Workspaces");
    const resetBtn = page.getByRole("button", { name: /Reset All Workspaces/i });
    const visible = await isVisible(resetBtn.first(), 5000);
    report.adminPanel.resetButtonVisible = visible;

    if (!visible) {
      const bodyTxt = (await getVisibleBodyText(page)).substring(0, 600);
      console.log("  Button NOT found. Body text:");
      console.log(bodyTxt);
      report.errors.push("Reset All Workspaces button not visible  new deployment may not be complete yet");
    } else {
      console.log(" Reset All Workspaces button visible  NEW CODE IS DEPLOYED ");
    }

    // 5. Click Reset All Workspaces
    if (visible) {
      console.log("\n Running Reset All Workspaces");
      await resetBtn.first().click();
      report.resetRun.clicked = true;

      // Wait for Resetting to appear then go away
      const resettingTxt = page.getByText("Resetting");
      await isVisible(resettingTxt.first(), 3000);
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (!(await isVisible(resettingTxt.first(), 800))) break;
        await sleep(1000);
      }
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "test-3-after-reset.png" });

      const errPill = page.locator(".pill.danger:visible").first();
      report.resetRun.ok = !(await isVisible(errPill, 1500));
      console.log(` Reset complete. Error: ${!report.resetRun.ok}`);
    }

    // 6. Verify WS admin after reset
    if (report.wsAccount.created) {
      console.log(`\n Verifying WS admin post-reset (${WS_EMAIL})`);

      await clickVisibleBtn(page, /^Sign out$/i, 2000);
      await sleep(1500);

      try {
        await loginAs(page, WS_EMAIL, WS_PASS);
        report.wsVerify.loginOk = true;
        console.log(" WS admin re-login OK");
      } catch (e) {
        report.errors.push(`WS verify login: ${e.message}`);
      }

      if (report.wsVerify.loginOk) {
        await page.waitForTimeout(3500);
        const state = await readWorkspaceStateViaRPC(page);
        console.log("   RPC state:", JSON.stringify(state, null, 2));

        if (state.error) {
          report.errors.push(`RPC: ${state.error}`);
        } else {
          report.wsVerify.agentsCount = state.agents.length;
          report.wsVerify.agentIds = state.agents.map((a) => a.id);
          report.wsVerify.singleAgent = state.agents.length === 1;
          if (state.agents.length > 0) {
            report.wsVerify.agentName = state.agents[0].name;
            report.wsVerify.modelRef = state.agents[0].model || state.effDefaultModel || state.wsDefaultModel;
          } else {
            report.wsVerify.modelRef = state.effDefaultModel || state.wsDefaultModel;
          }
                    const modelVal = report.wsVerify.modelRef;
          const modelStr = typeof modelVal === "string" ? modelVal.toLowerCase()
            : (typeof modelVal === "object" && modelVal !== null)
              ? JSON.stringify(modelVal).toLowerCase()
              : "";
          report.wsVerify.kiloModel = modelStr.includes("kilo");
        }
        await page.screenshot({ path: "test-4-ws-state.png" });
      }
    }

  } catch (err) {
    report.errors.push(`Fatal: ${err.message}`);
    console.error(" Fatal:", err);
    await page.screenshot({ path: "test-fatal.png" }).catch(() => {});
  } finally {
    await browser.close();
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  }

  // Print summary
  console.log("\n");
  console.log(" RESULTS");
  console.log("");
  console.log(`  Site up:                  ${report.deployVerify.siteUp        ? "" : ""}`);
  console.log(`  Super admin login:        ${report.superAdminLogin.ok          ? "" : ""}`);
  console.log(`  Admin panel:              ${report.adminPanel.navigated         ? "" : ""}`);
  console.log(`  Reset button (NEW CODE):  ${report.adminPanel.resetButtonVisible ? "" : ""}   confirms new deploy`);
  console.log(`  WS account:               ${report.wsAccount.created            ? "" : ""}`);
  console.log(`  Reset clicked:            ${report.resetRun.clicked             ? "" : ""}`);
  console.log(`  Reset OK:                 ${report.resetRun.ok                  ? "" : ""}`);
  console.log(`  WS login post-reset:      ${report.wsVerify.loginOk             ? "" : ""}`);
  console.log(`  Single starter agent:     ${report.wsVerify.singleAgent ? "" : ` (${report.wsVerify.agentsCount})`}`);
  console.log(`  Agent name:               ${report.wsVerify.agentName ? `"${report.wsVerify.agentName}"` : ""}`);
  console.log(`  Kilo free model:          ${report.wsVerify.kiloModel ? "" : ""}  (${report.wsVerify.modelRef || "none"})`);
  if (report.errors.length > 0) {
    console.log(`\n    Errors:`);
    report.errors.forEach((e) => console.log(`      ${e}`));
  }
  console.log("");
  console.log(` ${REPORT_FILE}`);
}

run().catch((e) => { console.error(e); process.exit(1); });

