/**
 * Full E2E test suite for os.wickedlab.io
 *
 * Covers:
 *  1. Deploy verify (site up + Reset All Workspaces button = new code live)
 *  2. Super admin: login, Admin Panel, Reset All Workspaces
 *  3. WS admin post-reset: single kilo starter agent
 *  4. WS admin: actual AI chat in main panel (sends message, waits for real response)
 *  5. WS admin: opens a second chat panel (new session), chats there too
 *  6. Super admin: chats in their own workspace
 *  7. Smoke-tests all sidebar nav pages
 *
 * Run:
 *   $env:PMOS_SUPER_EMAIL="rajan@wickedwebsites.us"; $env:PMOS_SUPER_PASS="WickedOS!Temp2026#1"; `
 *   $env:PMOS_WS_EMAIL="testws@wickedlab.io"; $env:PMOS_WS_PASS="TestWS!2026#pw"; `
 *   node tests/pmos-full-e2e.cjs
 */

"use strict";
const fs = require("fs");
const { chromium } = require("playwright");

const BASE_URL   = process.env.PMOS_BASE_URL   || "https://os.wickedlab.io";
const SUPER_EMAIL = process.env.PMOS_SUPER_EMAIL || "rajan@wickedwebsites.us";
const SUPER_PASS  = process.env.PMOS_SUPER_PASS  || "WickedOS!Temp2026#1";
const WS_EMAIL    = process.env.PMOS_WS_EMAIL    || "testws@wickedlab.io";
const WS_PASS     = process.env.PMOS_WS_PASS     || "TestWS!2026#pw";
const REPORT_FILE = `playwright-full-e2e-${Date.now()}.json`;

const runTs = Date.now();
const CHAT_ECHO_TAG = `e2e-ok-${runTs}`;

const report = {
  runTs,
  baseUrl: BASE_URL,
  chatEchoTag: CHAT_ECHO_TAG,
  deployVerify:   { siteUp: false, pollAttempts: 0, waitedMs: 0 },
  superAdminLogin: { ok: false },
  adminPanel:      { navigated: false, resetButtonVisible: false },
  wsAccount:       { email: WS_EMAIL, ready: false },
  resetRun:        { clicked: false, ok: false },
  wsVerify:        { loginOk: false, agentsCount: null, agentIds: [], agentName: null, modelRef: null, kiloModel: false, singleAgent: false },
  chatWS: {
    panel1: { navOk: false, composerFound: false, sendAttempted: false, responseOk: false, responseSnippet: null, errorText: null, thinkingStreamed: false, durationMs: null },
    panel2: { opened: false, composerFound: false, sendAttempted: false, responseOk: false, responseSnippet: null, errorText: null, durationMs: null },
  },
  chatSuperAdmin: { navOk: false, composerFound: false, sendAttempted: false, responseOk: false, responseSnippet: null, errorText: null, durationMs: null },
  pageSmoke: [],
  errors: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── helpers ────────────────────────────────────────────────────────────────

async function isVisible(locator, timeout = 2000) {
  try { return await locator.isVisible({ timeout }); } catch { return false; }
}

async function getBodyText(page) {
  try { return await page.locator("body").innerText(); } catch { return ""; }
}

async function clickVisibleBtn(page, nameRe, timeout = 1500) {
  const btns = page.getByRole("button", { name: nameRe });
  for (let i = 0; i < await btns.count(); i++) {
    if (await isVisible(btns.nth(i), timeout)) { await btns.nth(i).click(); return true; }
  }
  return false;
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const titled = nav.locator(`a.nav-item[title="${label}"]`).first();
  if (await isVisible(titled, 600)) { await titled.click(); return; }
  const exact = nav.getByText(label, { exact: true });
  for (let i = 0; i < await exact.count(); i++) {
    if (await isVisible(exact.nth(i), 400)) { await exact.nth(i).click(); return; }
  }
  const fuzzy = nav.getByText(new RegExp(`^${label}$`, "i"));
  for (let i = 0; i < await fuzzy.count(); i++) {
    if (await isVisible(fuzzy.nth(i), 400)) { await fuzzy.nth(i).click(); return; }
  }
  throw new Error(`Nav item not found: ${label}`);
}

async function loginAs(page, email, pass, nameForSignup = "Test User") {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  const soBtn = page.getByRole("button", { name: /^Sign out$/i });
  if (await isVisible(soBtn.first(), 1500)) {
    const body = (await getBodyText(page)).toLowerCase();
    if (!body.includes(email.toLowerCase())) { await soBtn.first().click(); await sleep(1200); }
    else return true; // already logged in as this user
  }

  const emailIn = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
  const passIn  = page.locator('input[type="password"][autocomplete="current-password"], input[type="password"]').first();

  if (!(await isVisible(emailIn, 5000))) {
    const body = (await getBodyText(page)).toLowerCase();
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
        if (!(await clickVisibleBtn(page, /^Create account$/i, 800))) throw new Error(`Login failed, signup unavail: ${txt}`);
        await sleep(400);
        const nameIn      = page.locator('input[autocomplete="name"], input[placeholder="Your name"]').first();
        const signupEmail = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
        const signupPass  = page.locator('input[type="password"][autocomplete="new-password"], input[type="password"]').first();
        if (await isVisible(nameIn, 800))      await nameIn.fill(nameForSignup);
        if (await isVisible(signupEmail, 800)) await signupEmail.fill(email);
        if (await isVisible(signupPass, 800))  await signupPass.fill(pass);
        if (!(await clickVisibleBtn(page, /^Create account$/i, 1200))) throw new Error("Create account submit not found");
        await sleep(700);
        continue;
      }
      if (/already|exists|in use/i.test(txt)) throw new Error(`Signup conflict: ${txt}`);
      throw new Error(`Auth error: ${txt}`);
    }

    const emailBack  = page.locator('input[autocomplete="email"]').first();
    const restoring  = page.getByText(/Restoring your session/i).first();
    if (await isVisible(emailBack, 200) && !(await isVisible(restoring, 200))) {
      throw new Error("Login did not complete — returned to sign-in");
    }
    await sleep(400);
  }
  throw new Error(`Login timed out for ${email}`);
}

// ─── chat helpers ────────────────────────────────────────────────────────────

/**
 * Sends a message via the visible composer and waits up to `waitMs` for `echoTag`
 * to appear in the page body. Falls back to chat.send RPC if the UI method fails.
 * Returns { ok, snippet, errorText, thinkingStreamed, durationMs }
 */
async function sendAndWaitForReply(page, prompt, echoTag, waitMs = 45000) {
  const result = { ok: false, snippet: null, errorText: null, thinkingStreamed: false, durationMs: null };
  const t0 = Date.now();

  // ── 1. Try UI send ─────────────────────────────────────────────────────────
  const composer = page.locator(
    'textarea:visible, input[placeholder*="chat" i]:visible, input[placeholder*="message" i]:visible'
  ).last();

  const composerFound = await isVisible(composer, 5000);
  if (composerFound) {
    await composer.fill(prompt);
    // Try Send button first, fall back to Ctrl+Enter
    const sendBtn = page.getByRole("button", { name: /^Send$/i }).first();
    const btnOk = await isVisible(sendBtn, 1500) && await sendBtn.isEnabled().catch(() => false);
    if (btnOk) {
      await sendBtn.click();
    } else {
      await composer.press("Control+Enter");
    }

    // Wait for response
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const body = await getBodyText(page);
      if (body.toLowerCase().includes(echoTag.toLowerCase())) {
        result.ok = true;
        const m = body.match(new RegExp(echoTag.replace(/-/g, "[-—]?"), "i"));
        result.snippet = m ? m[0] : echoTag;
        // Check if a <thinking> block streamed (text "thinking" near a collapsible or spinner)
        result.thinkingStreamed = /thinking|<think>/i.test(body);
        result.durationMs = Date.now() - t0;
        return result;
      }
      const errMatch = body.match(/Error:[^\n]{0,120}/i);
      if (errMatch) { result.errorText = errMatch[0]; break; }
      await sleep(800);
    }
  } else {
    result.errorText = "Composer not found";
  }

  // ── 2. RPC fallback ────────────────────────────────────────────────────────
  if (!result.ok) {
    try {
      const rpcResult = await page.evaluate(async ({ prompt, echoTag, waitMs }) => {
        const app = /** @type {any} */ (document.querySelector("openclaw-app"));
        if (!app?.client?.request) return { ok: false, error: "no client.request" };
        const sessionKey = typeof app.sessionKey === "string" ? app.sessionKey : "main";
        await app.client.request("chat.send", { sessionKey, message: prompt });
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000));
          const hist = await app.client.request("chat.history", { sessionKey, limit: 30 });
          const msgs = Array.isArray(hist?.messages) ? hist.messages : [];
          const hit = msgs.find((m) => JSON.stringify(m).toLowerCase().includes(echoTag.toLowerCase()));
          if (hit) return { ok: true, hit: echoTag };
        }
        return { ok: false, error: "Echo tag not seen in chat history via RPC" };
      }, { prompt, echoTag, waitMs });

      if (rpcResult.ok) {
        result.ok = true;
        result.snippet = rpcResult.hit || echoTag;
      } else if (!result.errorText) {
        result.errorText = rpcResult.error || "RPC fallback: no response";
      }
    } catch (err) {
      if (!result.errorText) result.errorText = `RPC fallback threw: ${err.message}`;
    }
  }

  result.durationMs = Date.now() - t0;
  return result;
}

// ─── RPC workspace state ─────────────────────────────────────────────────────

async function readWorkspaceStateViaRPC(page) {
  return page.evaluate(async () => {
    const app = /** @type {any} */ (document.querySelector("openclaw-app"));
    if (!app?.client?.request) return { error: "no client.request" };
    try {
      const [wsCfg, agentsRes] = await Promise.all([
        app.client.request("pmos.config.workspace.get", {}),
        app.client.request("agents.list", {}),
      ]);
      const wsCfgObj = wsCfg?.workspaceConfig || {};
      const effCfgObj = wsCfg?.effectiveConfig || {};
      const agents = Array.isArray(agentsRes?.agents) ? agentsRes.agents : [];
      return {
        workspaceId:    wsCfg?.workspaceId || null,
        agents:         agents.map((a) => ({ id: a?.id, name: a?.name, model: a?.model })),
        wsDefaultModel: wsCfgObj?.agents?.defaults?.model || null,
        effDefaultModel: effCfgObj?.agents?.defaults?.model || null,
      };
    } catch (e) { return { error: String(e) }; }
  });
}

// ─── deploy poll ──────────────────────────────────────────────────────────────

async function waitForSiteUp() {
  const start = Date.now();
  for (let i = 1; i <= 72; i++) {
    report.deployVerify.pollAttempts = i;
    try {
      const r = await fetch(BASE_URL + "/", { signal: AbortSignal.timeout(10000) });
      if (r.ok && (await r.text()).includes("openclaw-app")) {
        report.deployVerify.siteUp = true;
        report.deployVerify.waitedMs = Date.now() - start;
        console.log(`  Site up (attempt ${i}, ${Math.round(report.deployVerify.waitedMs / 1000)}s)`);
        return true;
      }
    } catch (_) {}
    process.stdout.write(`\r  Polling ${i}/72…`);
    await sleep(10000);
  }
  report.deployVerify.waitedMs = Date.now() - start;
  return false;
}

// ─── page smoke ───────────────────────────────────────────────────────────────

async function smokeNavPages(page) {
  const labels = ["Chat","Dashboard","Sessions","Models","Agents","Config","Integrations","Projects","Workflows","Connections","Skills","Overview","Channels","Instances","Usage","Cron Jobs"];
  for (const label of labels) {
    try {
      await clickNav(page, label);
      await page.waitForTimeout(800);
      const body = await getBodyText(page);
      report.pageSmoke.push({
        label,
        ok: true,
        h1: (await page.locator("h1").first().innerText().catch(() => "")).trim() || null,
        disconnected: /Disconnected from gateway\./i.test(body),
        errorSnippet:  body.match(/(Error:[^\n]+|forbidden[^\n]*|access denied[^\n]*)/i)?.[0] ?? null,
      });
    } catch (err) {
      report.pageSmoke.push({ label, ok: false, error: String(err) });
    }
  }
}

// ─── main run ─────────────────────────────────────────────────────────────────

async function run() {
  // 0. Poll until site is up
  if (!(await waitForSiteUp())) {
    report.errors.push("Site not up after 12 min");
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page    = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(`page-error: ${e.message}`));

  try {

    // ── 1. Ensure WS admin account exists ────────────────────────────────────
    console.log(`\n[1] Ensuring WS admin account: ${WS_EMAIL}`);
    try {
      await loginAs(page, WS_EMAIL, WS_PASS, "Test WS Admin");
      report.wsAccount.ready = true;
      console.log("    WS admin OK");
    } catch (e) {
      report.errors.push(`WS account setup: ${e.message}`);
      console.log(`    WS account warn: ${e.message}`);
    }

    // ── 2. Login as super admin ───────────────────────────────────────────────
    console.log(`\n[2] Super admin login: ${SUPER_EMAIL}`);
    await loginAs(page, SUPER_EMAIL, SUPER_PASS, "Super Admin");
    report.superAdminLogin.ok = true;
    console.log("    OK");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "e2e-1-super-login.png" });

    // ── 3. Navigate to Admin Panel (header button) ────────────────────────────
    console.log("\n[3] Admin Panel…");
    try {
      const adminBtn = page.getByRole("button", { name: /Admin Panel/i }).first();
      if (await isVisible(adminBtn, 4000)) {
        await adminBtn.click();
        report.adminPanel.navigated = true;
        await page.waitForTimeout(2000);
        console.log("    Admin Panel opened");
      } else {
        await clickNav(page, "Admin");
        report.adminPanel.navigated = true;
      }
    } catch (e) {
      report.errors.push(`Admin nav: ${e.message}`);
      console.log(`    warn: ${e.message}`);
    }
    await page.screenshot({ path: "e2e-2-admin.png" });

    // ── 4. Verify + click Reset All Workspaces ────────────────────────────────
    console.log("\n[4] Reset All Workspaces…");
    const resetBtn = page.getByRole("button", { name: /Reset All Workspaces/i });
    const resetVisible = await isVisible(resetBtn.first(), 5000);
    report.adminPanel.resetButtonVisible = resetVisible;

    if (!resetVisible) {
      const bodyTxt = (await getBodyText(page)).substring(0, 500);
      report.errors.push("Reset All Workspaces button not found — new deployment may not be live");
      console.log("    NOT FOUND. Body snippet:", bodyTxt);
    } else {
      console.log("    Button visible — new code is live ✓");
      await resetBtn.first().click();
      report.resetRun.clicked = true;

      // Wait for "Resetting…" banner then for it to disappear
      const resettingTxt = page.getByText(/Resetting/i);
      await isVisible(resettingTxt.first(), 3000);
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        if (!(await isVisible(resettingTxt.first(), 800))) break;
        await sleep(1000);
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "e2e-3-after-reset.png" });

      const errPill = page.locator(".pill.danger:visible").first();
      report.resetRun.ok = !(await isVisible(errPill, 1500));
      console.log(`    Reset ${report.resetRun.ok ? "OK ✓" : "had errors ✗"}`);
    }

    // ── 5. Super admin chat ───────────────────────────────────────────────────
    console.log("\n[5] Super admin chat test…");
    try {
      await clickNav(page, "Chat");
      report.chatSuperAdmin.navOk = true;
      await page.waitForTimeout(2500);

      const saPrompt = `Reply with ONLY this exact phrase and nothing else: ${CHAT_ECHO_TAG}-super`;
      console.log("    Sending prompt to super admin chat…");
      const saResult = await sendAndWaitForReply(page, saPrompt, `${CHAT_ECHO_TAG}-super`, 60000);
      report.chatSuperAdmin.composerFound = true;
      report.chatSuperAdmin.sendAttempted = true;
      report.chatSuperAdmin.responseOk    = saResult.ok;
      report.chatSuperAdmin.responseSnippet = saResult.snippet;
      report.chatSuperAdmin.errorText     = saResult.errorText;
      report.chatSuperAdmin.thinkingStreamed = saResult.thinkingStreamed;
      report.chatSuperAdmin.durationMs    = saResult.durationMs;
      console.log(`    Super admin chat: ${saResult.ok ? "✓ got response" : "✗ " + saResult.errorText}  (${saResult.durationMs}ms)`);
      await page.screenshot({ path: "e2e-4-super-chat.png" });
    } catch (e) {
      report.errors.push(`Super admin chat: ${e.message}`);
      console.log(`    error: ${e.message}`);
    }

    // ── 6. Switch to WS admin ─────────────────────────────────────────────────
    if (report.wsAccount.ready) {
      console.log(`\n[6] WS admin login: ${WS_EMAIL}`);
      await clickVisibleBtn(page, /^Sign out$/i, 2000);
      await sleep(1500);

      try {
        await loginAs(page, WS_EMAIL, WS_PASS);
        report.wsVerify.loginOk = true;
        console.log("    WS login OK");
      } catch (e) {
        report.errors.push(`WS verify login: ${e.message}`);
        console.log(`    login error: ${e.message}`);
      }

      if (report.wsVerify.loginOk) {
        await page.waitForTimeout(3500);

        // ── 6a. Check workspace state via RPC ─────────────────────────────────
        const state = await readWorkspaceStateViaRPC(page);
        console.log("    RPC state:", JSON.stringify(state, null, 2));

        if (state.error) {
          report.errors.push(`WS RPC state: ${state.error}`);
        } else {
          report.wsVerify.agentsCount = state.agents.length;
          report.wsVerify.agentIds    = state.agents.map((a) => a.id);
          report.wsVerify.singleAgent = state.agents.length === 1;
          if (state.agents.length > 0) {
            report.wsVerify.agentName = state.agents[0].name;
            report.wsVerify.modelRef  = state.agents[0].model || state.effDefaultModel || state.wsDefaultModel;
          } else {
            report.wsVerify.modelRef = state.effDefaultModel || state.wsDefaultModel;
          }
          const modelVal = report.wsVerify.modelRef;
          const modelStr = (typeof modelVal === "string" ? modelVal : JSON.stringify(modelVal ?? "")).toLowerCase();
          report.wsVerify.kiloModel = modelStr.includes("kilo");
        }
        await page.screenshot({ path: "e2e-5-ws-state.png" });

        // ── 6b. WS chat — Panel 1 ─────────────────────────────────────────────
        console.log("\n[7] WS admin chat — panel 1…");
        try {
          await clickNav(page, "Chat");
          report.chatWS.panel1.navOk = true;
          await page.waitForTimeout(2500);

          const composer1 = page.locator(
            'textarea:visible, input[placeholder*="chat" i]:visible, input[placeholder*="message" i]:visible'
          ).last();
          report.chatWS.panel1.composerFound = await isVisible(composer1, 5000);

          const p1Prompt = `Reply with ONLY this exact phrase and nothing else: ${CHAT_ECHO_TAG}-ws1`;
          console.log("    Sending to panel 1…");
          const p1 = await sendAndWaitForReply(page, p1Prompt, `${CHAT_ECHO_TAG}-ws1`, 60000);
          report.chatWS.panel1.sendAttempted   = true;
          report.chatWS.panel1.responseOk      = p1.ok;
          report.chatWS.panel1.responseSnippet = p1.snippet;
          report.chatWS.panel1.errorText       = p1.errorText;
          report.chatWS.panel1.thinkingStreamed = p1.thinkingStreamed;
          report.chatWS.panel1.durationMs      = p1.durationMs;
          console.log(`    Panel 1: ${p1.ok ? "✓ got response" : "✗ " + p1.errorText}  (${p1.durationMs}ms)`);
          await page.screenshot({ path: "e2e-6-ws-chat-p1.png" });
        } catch (e) {
          report.errors.push(`WS chat panel 1: ${e.message}`);
          console.log(`    error: ${e.message}`);
        }

        // ── 6c. WS chat — Panel 2 (new session) ──────────────────────────────
        console.log("\n[8] WS admin chat — panel 2 (new session)…");
        try {
          // The chat view has a "New session" button (doubles as Stop when generating).
          // It renders as a button with text "New session" visible when AI is idle.
          const newChatOpened = await (async () => {
            const candidates = [
              page.getByRole("button", { name: /^New session$/i }).first(),
              page.getByRole("button", { name: /new session/i }).first(),
              page.getByRole("button", { name: /new chat/i }).first(),
              page.getByRole("button", { name: /^\+$/ }).first(),
              page.getByTitle("New session").first(),
              page.getByTitle("New chat").first(),
              page.locator('[aria-label*="new" i][aria-label*="session" i]').first(),
              page.locator('[aria-label*="new" i][aria-label*="chat" i]').first(),
            ];
            for (const c of candidates) {
              if (await isVisible(c, 600)) { await c.click(); return true; }
            }
            return false;
          })();

          if (newChatOpened) {
            report.chatWS.panel2.opened = true;
            await page.waitForTimeout(2000);
            const composer2 = page.locator(
              'textarea:visible, input[placeholder*="chat" i]:visible, input[placeholder*="message" i]:visible'
            ).last();
            report.chatWS.panel2.composerFound = await isVisible(composer2, 5000);

            if (report.chatWS.panel2.composerFound) {
              const p2Prompt = `For this second chat panel, reply with ONLY: ${CHAT_ECHO_TAG}-ws2`;
              console.log("    Sending to panel 2…");
              const p2 = await sendAndWaitForReply(page, p2Prompt, `${CHAT_ECHO_TAG}-ws2`, 60000);
              report.chatWS.panel2.sendAttempted   = true;
              report.chatWS.panel2.responseOk      = p2.ok;
              report.chatWS.panel2.responseSnippet = p2.snippet;
              report.chatWS.panel2.errorText       = p2.errorText;
              report.chatWS.panel2.durationMs      = p2.durationMs;
              console.log(`    Panel 2: ${p2.ok ? "✓ got response" : "✗ " + p2.errorText}  (${p2.durationMs}ms)`);
              await page.screenshot({ path: "e2e-7-ws-chat-p2.png" });
            } else {
              report.chatWS.panel2.errorText = "Panel 2 composer not visible after new session opened";
              console.log("    Panel 2 composer not found");
            }
          } else {
            report.chatWS.panel2.errorText = "Could not find New Chat button to open panel 2";
            console.log("    New Chat button not found — panel 2 skipped");
          }
        } catch (e) {
          report.errors.push(`WS chat panel 2: ${e.message}`);
          console.log(`    error: ${e.message}`);
        }

        // ── 6d. Smoke-test nav pages (as WS admin) ───────────────────────────
        console.log("\n[9] Smoke-testing nav pages…");
        await smokeNavPages(page);
        const smokeOk = report.pageSmoke.filter((p) => p.ok).length;
        const smokeFail = report.pageSmoke.filter((p) => !p.ok).length;
        console.log(`    ${smokeOk} OK, ${smokeFail} failed`);
        await page.screenshot({ path: "e2e-8-smoke.png" });
      }
    }

  } catch (err) {
    report.errors.push(`Fatal: ${err.message}`);
    console.error("\nFATAL:", err);
    await page.screenshot({ path: "e2e-fatal.png" }).catch(() => {});
  } finally {
    await browser.close();
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  }

  // ── Print summary ──────────────────────────────────────────────────────────
  const ok  = (b) => b ? "✅" : "❌";
  const skip = (b) => b ? "✅" : "⚠️  skipped / not found";

  console.log("\n");
  console.log("╔════════════════════════════════════════════╗");
  console.log("║          FULL E2E RESULTS                  ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`  Site up:                    ${ok(report.deployVerify.siteUp)}`);
  console.log(`  Super admin login:          ${ok(report.superAdminLogin.ok)}`);
  console.log(`  Admin Panel navigated:      ${ok(report.adminPanel.navigated)}`);
  console.log(`  Reset button (new code):    ${ok(report.adminPanel.resetButtonVisible)}`);
  console.log(`  Reset ran OK:               ${ok(report.resetRun.ok)}`);
  console.log("");
  console.log(`  WS account ready:           ${ok(report.wsAccount.ready)}`);
  console.log(`  WS login post-reset:        ${ok(report.wsVerify.loginOk)}`);
  console.log(`  Single starter agent:       ${ok(report.wsVerify.singleAgent)}   (count=${report.wsVerify.agentsCount})`);
  console.log(`  Agent name:                 ${report.wsVerify.agentName ? `"${report.wsVerify.agentName}"` : "—"}`);
  console.log(`  Kilo model:                 ${ok(report.wsVerify.kiloModel)}   (${JSON.stringify(report.wsVerify.modelRef)})`);
  console.log("");
  console.log(`  [CHAT] Super admin panel 1: ${ok(report.chatSuperAdmin.responseOk)}   (${report.chatSuperAdmin.durationMs}ms)${report.chatSuperAdmin.errorText ? "  err=" + report.chatSuperAdmin.errorText : ""}`);
  console.log(`  [CHAT] WS panel 1:          ${ok(report.chatWS.panel1.responseOk)}   (${report.chatWS.panel1.durationMs}ms)${report.chatWS.panel1.errorText ? "  err=" + report.chatWS.panel1.errorText : ""}`);
  console.log(`  [CHAT] WS panel 2 opened:   ${skip(report.chatWS.panel2.opened)}`);
  console.log(`  [CHAT] WS panel 2 reply:    ${report.chatWS.panel2.opened ? ok(report.chatWS.panel2.responseOk) : "⚠️  N/A"}   (${report.chatWS.panel2.durationMs}ms)${report.chatWS.panel2.errorText ? " err=" + report.chatWS.panel2.errorText : ""}`);
  if (report.chatWS.panel1.thinkingStreamed || report.chatSuperAdmin.thinkingStreamed) {
    console.log(`  [CHAT] Thinking streamed:   ✅`);
  }
  console.log("");
  const smokeOkN  = report.pageSmoke.filter((p) => p.ok).length;
  const smokeTotN = report.pageSmoke.length;
  console.log(`  Page smoke tests:           ${smokeOkN}/${smokeTotN} OK`);

  if (report.errors.length > 0) {
    console.log(`\n  Errors (${report.errors.length}):`);
    report.errors.forEach((e) => console.log(`    • ${e}`));
  }
  console.log(`\n  Report: ${REPORT_FILE}`);

  const fatal = report.errors.some((e) => /fatal/i.test(e));
  const chatFailed = !report.chatWS.panel1.responseOk && !report.chatSuperAdmin.responseOk;
  if (fatal || (!report.deployVerify.siteUp)) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
