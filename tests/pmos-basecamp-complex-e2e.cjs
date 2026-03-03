/**
 * pmos-basecamp-complex-e2e.cjs
 *
 * Tests the full Basecamp workflow creation flow:
 * - Creates a complex 10+ node Basecamp workflow with branching via the AI Workflow Assistant
 * - Verifies ALL Basecamp nodes use `n8n-nodes-basecamp.basecamp` (custom BCgpt node)
 * - Verifies per-node streaming (node_added progress events)
 * - Verifies credential auto-injection
 * - Executes the workflow and captures results
 *
 * Usage:
 *   PMOS_EMAIL=... PMOS_PASSWORD=... node tests/pmos-basecamp-complex-e2e.cjs
 */

"use strict";
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
const WF_NAME = `BC_COMPLEX_${runTs}`;

const results = {
  runTs,
  baseUrl: BASE_URL,
  wfName: WF_NAME,
  login: { ok: false },
  workflowCreation: {
    attempted: false,
    promptSent: null,
    wsAssistSeen: false,
    workflowCreated: false,
    workflowId: null,
    nodeAddedEvents: [],          // per-node streaming events
    nodeAddedCount: 0,
    allBasecampNodesCorrect: false,
    wrongBasecampNodes: [],
    totalNodes: 0,
    retrievedOk: false,
    retrievedNodeTypes: [],
    retrievedConnections: null,
    credentialAutoInjected: false, // basecampApi auto-set on nodes
    recvTail: [],
    wsError: null,
  },
  workflowExecution: {
    attempted: false,
    executionId: null,
    executionOk: false,
    executionError: null,
  },
  errors: [],
};

const wsFrames = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(s) {
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

async function isVisible(loc, timeout = 1500) {
  try {
    return await loc.isVisible({ timeout });
  } catch {
    return false;
  }
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const exact = nav.getByText(label, { exact: true }).first();
  if (await isVisible(exact, 1000)) { await exact.click(); return; }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function waitForText(scope, text, timeoutMs = 90000) {
  try {
    await scope.locator(".chat-group.assistant", { hasText: text }).first()
      .waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the complex Basecamp workflow prompt.
 * Designed to produce a 10+ node workflow with branching.
 */
function buildPrompt(wfName) {
  return `Create an n8n workflow with the EXACT name "${wfName}".

This workflow should be a Basecamp Project Health Dashboard with the following structure (10+ nodes, branching):

1. Schedule Trigger — runs daily at 9 AM
2. Basecamp node — projects:getAll — get all Basecamp projects
3. Split into TWO parallel branches using a Switch or IF node:

   BRANCH A — Todo Intelligence:
   4a. Basecamp node — todolist:getAll — get all todo lists for each project (use findByName to get projectId from project name)
   4b. Basecamp node — todo:getAll — get all todos in each list
   4c. Basecamp node — todo:get — fetch details for overdue items (where dueOn < today)

   BRANCH B — Message Activity:
   4d. Basecamp node — message:getAll — get all messages from each project
   4e. Basecamp node — message:get — get full content of recent messages (last 7 days)

5. Merge node — rejoin both branches
6. Basecamp node — message:create — post a summary message to the project message board with stats: total todos, overdue count, recent message count

Use projectId from step 2 throughout. Chain nodes with proper data flow.
For each Basecamp node, use basecampApi credential.
The workflow name must be EXACTLY "${wfName}".`;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture WebSocket frames
  page.on("websocket", (ws) => {
    ws.on("framesent", (e) => {
      wsFrames.push({ dir: "sent", ts: Date.now(), payload: e.payload });
      if (wsFrames.length > 1000) wsFrames.shift();
    });
    ws.on("framereceived", (e) => {
      wsFrames.push({ dir: "recv", ts: Date.now(), payload: e.payload });
      if (wsFrames.length > 1000) wsFrames.shift();
    });
  });

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

    const alreadyLoggedIn = await isVisible(page.getByRole("button", { name: /sign out/i }).first(), 2500);
    if (!alreadyLoggedIn) {
      await page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first().fill(EMAIL);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.getByRole("button", { name: /^sign in$/i }).first().click();
    }
    await page.getByRole("button", { name: /sign out/i }).first().waitFor({ state: "visible", timeout: 60000 });
    results.login.ok = true;
    console.log("✅ Login OK");
    await page.screenshot({ path: "pw-bc-complex-login.png", fullPage: true });

    // ── NAVIGATE TO WORKFLOWS ──────────────────────────────────────────────
    await clickNav(page, "Workflows");
    await sleep(1800);

    // Ensure AI assistant panel is visible
    const aiHeader = page.getByText("AI Workflow Assistant", { exact: false }).first();
    if (!(await isVisible(aiHeader, 2000))) {
      const assistBtn = page.getByRole("button", { name: /AI Assistant/i }).first();
      if (await isVisible(assistBtn, 1500)) await assistBtn.click();
      await aiHeader.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    }

    const chatCards = page.locator("section.card.chat:visible");
    const cardCount = await chatCards.count();
    const chatCard = chatCards.nth(Math.max(cardCount - 1, 0));
    const textarea = chatCard.locator("textarea").first();

    // ── SEND COMPLEX WORKFLOW CREATION PROMPT ─────────────────────────────
    const prompt = buildPrompt(WF_NAME);
    results.workflowCreation.attempted = true;
    results.workflowCreation.promptSent = prompt.slice(0, 500) + "...";

    const frameStart = wsFrames.length;
    await textarea.fill(prompt);
    const sendButton = chatCard.getByRole("button", { name: /^Send/i }).first();
    await sendButton.click();
    console.log(`📤 Prompt sent: creating "${WF_NAME}"...`);

    // Wait for mention of the workflow name in AI response (up to 3 min for complex workflow)
    const mentioned = await waitForText(chatCard, WF_NAME, 180000);
    console.log(`📥 AI response mention of workflow name: ${mentioned}`);
    await sleep(3000);

    // ── ANALYZE WS FRAMES ─────────────────────────────────────────────────
    const frames = wsFrames.slice(frameStart);
    const recvTail = [];

    for (const frame of frames) {
      if (typeof frame.payload !== "string") continue;

      if (frame.payload.includes('"method":"pmos.workflow.assist"')) {
        results.workflowCreation.wsAssistSeen = true;
      }

      if (frame.dir !== "recv") continue;

      const clipped = frame.payload.length > 1000
        ? frame.payload.slice(0, 1000) + "..."
        : frame.payload;
      recvTail.push(clipped);
      if (recvTail.length > 20) recvTail.shift();

      const parsed = safeJson(frame.payload);
      if (!parsed || typeof parsed !== "object") continue;

      if (parsed.ok === false && parsed.error) {
        results.workflowCreation.wsError = String(parsed.error);
      }

      // ── workflow_ready event → workflow was created ──────────────────────
      if (parsed.type === "event" && parsed.event === "pmos.workflow.assist.progress") {
        const evp = parsed.payload;
        if (evp && typeof evp === "object") {
          // node_added streaming event
          if (evp.type === "node_added" && evp.nodeName) {
            results.workflowCreation.nodeAddedEvents.push({
              nodeName: evp.nodeName,
              nodeType: evp.nodeType ?? null,
            });
          }
          // workflow ready
          if (evp.type === "workflow_ready" && evp.workflowId) {
            results.workflowCreation.workflowCreated = true;
            results.workflowCreation.workflowId = String(evp.workflowId);
          }
        }
      }

      // Final response payload
      const payload = parsed.payload;
      if (payload && typeof payload === "object") {
        if (payload.workflowCreated === true && payload.workflowId) {
          results.workflowCreation.workflowCreated = true;
          results.workflowCreation.workflowId = String(payload.workflowId);
        }
      }
    }

    results.workflowCreation.nodeAddedCount = results.workflowCreation.nodeAddedEvents.length;
    results.workflowCreation.recvTail = recvTail;
    console.log(`🔧 node_added streaming events: ${results.workflowCreation.nodeAddedCount}`);
    console.log(`🆔 Workflow ID: ${results.workflowCreation.workflowId}`);

    // ── RETRIEVE AND AUDIT WORKFLOW ────────────────────────────────────────
    if (results.workflowCreation.workflowId) {
      const fetched = await page.evaluate(async ({ workflowId }) => {
        try {
          const r = await fetch("/tools/invoke", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tool: "ops_workflow_get",
              args: { workflowId },
              sessionKey: "main",
            }),
          });
          return { status: r.status, json: await r.json().catch(() => null) };
        } catch (err) {
          return { status: 0, json: { ok: false, error: String(err) } };
        }
      }, { workflowId: results.workflowCreation.workflowId });

      if (fetched?.json?.ok) {
        results.workflowCreation.retrievedOk = true;
        const root = fetched.json;
        const wfData = root.result?.details ?? root.result ?? root.payload?.details ?? root.payload ?? null;
        const nodes = Array.isArray(wfData?.nodes) ? wfData.nodes
          : Array.isArray(wfData?.data?.nodes) ? wfData.data.nodes : [];

        results.workflowCreation.totalNodes = nodes.length;
        results.workflowCreation.retrievedNodeTypes = nodes
          .map((n) => (n && typeof n.type === "string" ? n.type : null))
          .filter(Boolean);

        // Verify all Basecamp nodes use our custom node
        const basecampNodes = nodes.filter((n) =>
          String(n?.type ?? "").toLowerCase().includes("basecamp")
        );
        const wrongNodes = basecampNodes.filter((n) => n.type !== "n8n-nodes-basecamp.basecamp");
        results.workflowCreation.wrongBasecampNodes = wrongNodes.map((n) => ({ name: n.name, type: n.type }));
        results.workflowCreation.allBasecampNodesCorrect = wrongNodes.length === 0 && basecampNodes.length > 0;

        // Check credential auto-injection
        const basecampNodesWithCred = basecampNodes.filter((n) => n?.credentials?.basecampApi);
        results.workflowCreation.credentialAutoInjected = basecampNodesWithCred.length === basecampNodes.length
          && basecampNodes.length > 0;

        // Store connections summary
        const connKeys = wfData?.connections ? Object.keys(wfData.connections) : [];
        results.workflowCreation.retrievedConnections = connKeys.length > 0
          ? `${connKeys.length} connection entries`
          : "none";

        console.log(`📊 Total nodes: ${nodes.length}`);
        console.log(`✅ All Basecamp nodes correct: ${results.workflowCreation.allBasecampNodesCorrect}`);
        console.log(`🔑 Credential auto-injected: ${results.workflowCreation.credentialAutoInjected}`);
        if (wrongNodes.length > 0) {
          console.log(`❌ Wrong Basecamp nodes:`, wrongNodes.map((n) => `${n.name}=${n.type}`).join(", "));
        }
      } else {
        console.log(`⚠️  Could not retrieve workflow: ${fetched?.json?.error}`);
      }

      // ── EXECUTE WORKFLOW ─────────────────────────────────────────────────
      console.log("▶️  Executing workflow...");
      results.workflowExecution.attempted = true;
      const execResult = await page.evaluate(async ({ workflowId }) => {
        try {
          const r = await fetch("/tools/invoke", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tool: "ops_workflow_execute",
              args: { workflowId },
              sessionKey: "main",
            }),
          });
          return { status: r.status, json: await r.json().catch(() => null) };
        } catch (err) {
          return { status: 0, json: { ok: false, error: String(err) } };
        }
      }, { workflowId: results.workflowCreation.workflowId });

      results.workflowExecution.executionOk = Boolean(execResult?.json?.ok);
      const execPayload = execResult?.json?.result ?? execResult?.json?.payload ?? execResult?.json ?? null;
      results.workflowExecution.executionId = execPayload?.executionId ?? execPayload?.id ?? null;
      if (!results.workflowExecution.executionOk) {
        results.workflowExecution.executionError = execResult?.json?.error ?? "unknown error";
      }
      console.log(`▶️  Execution OK: ${results.workflowExecution.executionOk}, ID: ${results.workflowExecution.executionId}`);
    }

    await page.screenshot({ path: "pw-bc-complex-final.png", fullPage: true });

  } catch (err) {
    results.errors.push(String(err));
    console.error("Test error:", err);
    await page.screenshot({ path: "pw-bc-complex-error.png", fullPage: true }).catch(() => {});
  } finally {
    const outFile = `playwright-basecamp-complex-${runTs}.json`;
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`\n📋 Results written to ${outFile}`);
    printSummary(results);
    await context.close();
    await browser.close();
  }
}

function printSummary(r) {
  const wc = r.workflowCreation;
  console.log("\n═══════════════════════════════════════════");
  console.log("  Basecamp Complex Workflow E2E Summary");
  console.log("═══════════════════════════════════════════");
  console.log(`  Login:                   ${r.login.ok ? "✅" : "❌"}`);
  console.log(`  Workflow created:        ${wc.workflowCreated ? "✅ " + wc.workflowId : "❌"}`);
  console.log(`  Total nodes:             ${wc.totalNodes}`);
  console.log(`  node_added events:       ${wc.nodeAddedCount} (streaming)`);
  console.log(`  All Basecamp nodes OK:   ${wc.allBasecampNodesCorrect ? "✅" : "❌"}`);
  if (wc.wrongBasecampNodes.length > 0) {
    console.log(`  ⚠️  Wrong nodes:`, wc.wrongBasecampNodes.map((n) => `${n.name}=${n.type}`).join(", "));
  }
  console.log(`  Cred auto-injected:      ${wc.credentialAutoInjected ? "✅" : "❌"}`);
  console.log(`  Connections:             ${wc.retrievedConnections ?? "n/a"}`);
  console.log(`  Execution attempted:     ${r.workflowExecution.attempted ? "✅" : "❌"}`);
  console.log(`  Execution OK:            ${r.workflowExecution.executionOk ? "✅ " + r.workflowExecution.executionId : "❌ " + (r.workflowExecution.executionError ?? "")}`);
  if (r.errors.length > 0) {
    console.log(`  Errors: ${r.errors.join("; ")}`);
  }
  console.log("═══════════════════════════════════════════\n");
}

run().catch((err) => {
  results.errors.push(String(err));
  try {
    fs.writeFileSync(`playwright-basecamp-complex-err-${runTs}.json`, JSON.stringify(results, null, 2));
  } catch {}
  console.error(err);
  process.exit(1);
});
