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
const report = {
  runTs,
  baseUrl: BASE_URL,
  loginOk: false,
  workflow: {
    wfName: `PW_BC_E2E_${runTs}`,
    hookPath: `pw-bc-e2e-${runTs}`,
    wsAssistSeen: false,
    wsConfirmSeen: false,
    wsConfirmSuccess: false,
    wsConfirmWorkflowId: null,
    wsError: null,
    sentMethods: [],
    assistantMentionedName: false,
    retrievedOk: false,
    retrievedWorkflowName: null,
    retrievedNodeTypes: [],
    retrievedHasWebhookNode: false,
    retrievedHasWebhookPath: false,
    retrievedHasRespondNode: false,
    retrievedHasBasecampNode: false,
    retrievedHasIfNode: false,
    retrievedBasecampCredentialsAttached: false,
    retrievedBasecampCredentialKeys: [],
  },
  errors: [],
};

const wsFrames = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
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
  if (await isVisible(exact, 800)) {
    await exact.click();
    return;
  }
  await nav.getByText(new RegExp(label, "i")).first().click();
}

async function waitForAssistantToken(scope, token, timeoutMs = 90000) {
  const target = scope.locator(".chat-group.assistant", { hasText: token }).first();
  try {
    await target.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function uniqueMethods(frames) {
  const methods = new Set();
  for (const frame of frames) {
    if (frame.dir !== "sent") continue;
    const parsed = safeJsonParse(frame.payload);
    if (parsed && typeof parsed === "object" && typeof parsed.method === "string") {
      methods.add(parsed.method);
    }
  }
  return Array.from(methods);
}

function pickWorkflowPayload(toolResponse) {
  if (!toolResponse || typeof toolResponse !== "object") return null;
  const root = toolResponse;
  return root.result?.details ?? root.result ?? root.payload?.details ?? root.payload ?? null;
}

function analyzeWorkflow(payload, hookPath) {
  const result = {
    workflowName: null,
    nodeTypes: [],
    hasWebhookNode: false,
    hasWebhookPath: false,
    hasRespondNode: false,
    hasBasecampNode: false,
    hasIfNode: false,
    basecampCredentialsAttached: false,
    basecampCredentialKeys: [],
  };

  if (!payload || typeof payload !== "object") return result;

  result.workflowName = typeof payload.name === "string"
    ? payload.name
    : typeof payload?.data?.name === "string"
      ? payload.data.name
      : null;

  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes
    : Array.isArray(payload?.data?.nodes)
      ? payload.data.nodes
      : [];

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const type = typeof node.type === "string" ? node.type : "";
    const lowerType = type.toLowerCase();
    const lowerJson = JSON.stringify(node).toLowerCase();

    if (type) result.nodeTypes.push(type);
    if (lowerType.includes("webhook")) result.hasWebhookNode = true;
    if (hookPath && lowerJson.includes(String(hookPath).toLowerCase())) result.hasWebhookPath = true;
    if (lowerType.includes("respondtowebhook") || lowerType.includes("respond")) result.hasRespondNode = true;
    if (lowerType.includes("basecamp")) result.hasBasecampNode = true;
    if (lowerType.endsWith(".if") || lowerType.includes("nodes-base.if")) result.hasIfNode = true;
    if (lowerType.includes("basecamp") && node.credentials && typeof node.credentials === "object") {
      const credentialKeys = Object.keys(node.credentials).filter(Boolean);
      if (credentialKeys.length > 0) {
        result.basecampCredentialsAttached = true;
        for (const key of credentialKeys) {
          if (!result.basecampCredentialKeys.includes(key)) {
            result.basecampCredentialKeys.push(key);
          }
        }
      }
    }
  }

  return result;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();

  page.on("websocket", (ws) => {
    ws.on("framesent", (event) => {
      wsFrames.push({ dir: "sent", ts: Date.now(), payload: event.payload });
      if (wsFrames.length > 1000) wsFrames.shift();
    });
    ws.on("framereceived", (event) => {
      wsFrames.push({ dir: "recv", ts: Date.now(), payload: event.payload });
      if (wsFrames.length > 1000) wsFrames.shift();
    });
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
    await page.waitForTimeout(1600);

    const aiHeader = page.getByText("AI Workflow Assistant", { exact: false }).first();
    if (!(await isVisible(aiHeader, 1800))) {
      await page.getByRole("button", { name: /AI Assistant/i }).first().click();
      await aiHeader.waitFor({ state: "visible", timeout: 30000 });
    }

    const chatCards = page.locator("section.card.chat:visible");
    const chatCount = await chatCards.count();
    const workflowChatCard = chatCards.nth(Math.max(chatCount - 1, 0));
    const workflowTextarea = workflowChatCard.locator("textarea").first();
    const sendButton = workflowChatCard.getByRole("button", { name: /^Send/i }).first();

    const prompt = [
      `Create an n8n workflow with EXACT name ${report.workflow.wfName}.`,
      `Use webhook trigger path ${report.workflow.hookPath}.`,
      "Use a Basecamp node in the main flow.",
      "Add an IF node to branch the flow.",
      "Return via Respond to Webhook node with JSON {\"ok\":true,\"source\":\"basecamp-e2e\"}.",
      "Use available saved credentials when needed.",
    ].join("\n");

    const start = wsFrames.length;
    await workflowTextarea.fill(prompt);
    await sendButton.click();

    report.workflow.assistantMentionedName = await waitForAssistantToken(
      workflowChatCard,
      report.workflow.wfName,
      90000,
    );

    const deadline = Date.now() + 120000;
    let scanIndex = start;
    while (Date.now() < deadline && !report.workflow.wsConfirmSuccess && !report.workflow.wsError) {
      const frames = wsFrames.slice(scanIndex);
      scanIndex = wsFrames.length;
      for (const frame of frames) {
        if (typeof frame.payload !== "string") continue;
        if (frame.payload.includes('"method":"pmos.workflow.assist"')) {
          report.workflow.wsAssistSeen = true;
        }
        if (frame.payload.includes('"method":"pmos.workflow.confirm"')) {
          report.workflow.wsConfirmSeen = true;
        }
        if (frame.dir !== "recv") continue;

        const parsed = safeJsonParse(frame.payload);
        if (!parsed || typeof parsed !== "object") continue;

        if (parsed.ok === false && parsed.error && !report.workflow.wsError) {
          report.workflow.wsError = String(parsed.error);
        }

        const payload = parsed.payload;
        if (!payload || typeof payload !== "object") continue;

        if (payload.success === true) {
          const workflowId = payload.workflowId ?? payload.id ?? null;
          if (workflowId) {
            report.workflow.wsConfirmSuccess = true;
            report.workflow.wsConfirmWorkflowId = String(workflowId);
            break;
          }
        }

        if (!report.workflow.wsError && typeof payload.message === "string" && /error/i.test(payload.message)) {
          report.workflow.wsError = payload.message;
        }
      }
      await sleep(600);
    }

    const captured = wsFrames.slice(start);
    report.workflow.sentMethods = uniqueMethods(captured);

    if (report.workflow.wsConfirmWorkflowId) {
      const fetched = await page.evaluate(
        async ({ workflowId }) => {
          try {
            const response = await fetch("/tools/invoke", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                tool: "ops_workflow_get",
                args: { workflowId },
                sessionKey: "main",
              }),
            });
            const json = await response.json().catch(() => null);
            return { status: response.status, json };
          } catch (error) {
            return { status: 0, json: { ok: false, error: String(error) } };
          }
        },
        { workflowId: report.workflow.wsConfirmWorkflowId },
      );

      if (fetched?.json?.ok) {
        const payload = pickWorkflowPayload(fetched.json);
        const analyzed = analyzeWorkflow(payload, report.workflow.hookPath);
        report.workflow.retrievedOk = true;
        report.workflow.retrievedWorkflowName = analyzed.workflowName;
        report.workflow.retrievedNodeTypes = analyzed.nodeTypes;
        report.workflow.retrievedHasWebhookNode = analyzed.hasWebhookNode;
        report.workflow.retrievedHasWebhookPath = analyzed.hasWebhookPath;
        report.workflow.retrievedHasRespondNode = analyzed.hasRespondNode;
        report.workflow.retrievedHasBasecampNode = analyzed.hasBasecampNode;
        report.workflow.retrievedHasIfNode = analyzed.hasIfNode;
        report.workflow.retrievedBasecampCredentialsAttached = analyzed.basecampCredentialsAttached;
        report.workflow.retrievedBasecampCredentialKeys = analyzed.basecampCredentialKeys;
      }
    }

    await page.screenshot({ path: "playwright-workflow-basecamp-e2e.png", fullPage: true });
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: "playwright-workflow-basecamp-e2e-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-workflow-basecamp-e2e.json", JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  report.errors.push(String(error));
  try {
    fs.writeFileSync("playwright-workflow-basecamp-e2e.json", JSON.stringify(report, null, 2));
  } catch {}
  console.error(error);
  process.exit(1);
});
