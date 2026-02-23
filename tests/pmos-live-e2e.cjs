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
const results = {
  runTs,
  baseUrl: BASE_URL,
  login: { ok: false },
  dashboardChat: { pass: false, token: `DASH_OK_${runTs}` },
  chatTab: { pass: false, token: `CHAT_OK_${runTs}` },
  workflowPanel: {
    chatPass: false,
    chatToken: `WF_CHAT_OK_${runTs}`,
    wsSentMethods: [],
    createViaSend: {
      attempted: false,
      wfName: `PW_E2E_${runTs}`,
      hookPath: `pw-e2e-${runTs}`,
      wsAssistSeen: false,
      assistReturnedWorkflow: false,
      assistMessage: null,
      wsConfirmSeen: false,
      wsConfirmSuccess: false,
      wsConfirmWorkflowId: null,
      retrievedOk: false,
      retrievedWorkflowName: null,
      retrievedHasWebhookNode: false,
      retrievedHasWebhookPath: false,
      retrievedHasRespondNode: false,
      retrievedNodeTypes: [],
      wsError: null,
      sentMethods: [],
      recvTail: [],
      nameVisibleInList: false,
      assistantMentionedName: false,
    },
    autoCreate: {
      attempted: false,
      buttonEnabled: false,
      requestTool: null,
      responseOk: false,
      workflowId: null,
      workflowName: null,
      hasWebhookNode: false,
      hasWebhookPath: false,
      hasRespondNode: false,
    },
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

async function getVisibleFlowNames(page) {
  const labels = await page.locator(".list-item .list-title:visible").allTextContents();
  return labels.map((value) => value.trim()).filter(Boolean);
}

async function clickNav(page, label) {
  const nav = page.locator("aside");
  const exact = nav.getByText(label, { exact: true }).first();
  if (await isVisible(exact, 1000)) {
    await exact.click();
    return;
  }
  const fallback = nav.getByText(new RegExp(label, "i")).first();
  await fallback.click();
}

async function waitForAssistantToken(scope, token, timeoutMs = 70000) {
  const target = scope.locator(".chat-group.assistant", { hasText: token }).first();
  try {
    await target.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function pickWorkflowPayload(toolResponse) {
  if (!toolResponse || typeof toolResponse !== "object") return null;
  const root = toolResponse;
  const candidate =
    root.result?.details ??
    root.result ??
    root.payload?.details ??
    root.payload ??
    null;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate;
}

function analyzeWorkflowPayload(payload, hookPath) {
  const info = {
    workflowId: null,
    workflowName: null,
    hasWebhookNode: false,
    hasWebhookPath: false,
    hasRespondNode: false,
  };

  if (!payload || typeof payload !== "object") {
    return info;
  }

  const workflowId = payload.id ?? payload.workflowId ?? payload.data?.id ?? null;
  const workflowName = payload.name ?? payload.data?.name ?? null;
  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes
    : Array.isArray(payload.data?.nodes)
      ? payload.data.nodes
      : [];

  info.workflowId = workflowId ? String(workflowId) : null;
  info.workflowName = workflowName ? String(workflowName) : null;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const nodeType = typeof node.type === "string" ? node.type.toLowerCase() : "";
    const nodeJson = JSON.stringify(node).toLowerCase();
    if (nodeType.includes("webhook")) {
      info.hasWebhookNode = true;
    }
    if (nodeType.includes("respondtowebhook") || nodeType.includes("respond")) {
      info.hasRespondNode = true;
    }
    if (hookPath && nodeJson.includes(String(hookPath).toLowerCase())) {
      info.hasWebhookPath = true;
    }
  }

  return info;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("websocket", (ws) => {
    ws.on("framesent", (event) => {
      wsFrames.push({ dir: "sent", ts: Date.now(), payload: event.payload });
      if (wsFrames.length > 600) wsFrames.shift();
    });
    ws.on("framereceived", (event) => {
      wsFrames.push({ dir: "recv", ts: Date.now(), payload: event.payload });
      if (wsFrames.length > 600) wsFrames.shift();
    });
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});

    const signOutButton = page.getByRole("button", { name: /^Sign out$/i }).first();
    const signedOut = await isVisible(signOutButton, 2500);
    if (!signedOut) {
      const emailInput = page.locator('input[autocomplete="email"], input[placeholder="you@company.com"]').first();
      const passwordInput = page.locator('input[type="password"][autocomplete="current-password"], input[type="password"]').first();
      await emailInput.fill(EMAIL);
      await passwordInput.fill(PASSWORD);
      const signInButton = page.getByRole("button", { name: /^Sign in$/i }).first();
      await signInButton.click();
    }

    await page.getByRole("button", { name: /^Sign out$/i }).first().waitFor({ state: "visible", timeout: 120000 });
    results.login.ok = true;
    await page.screenshot({ path: "playwright-after-login.png", fullPage: true });

    // Dashboard chat panel
    await clickNav(page, "Dashboard");
    await sleep(1200);
    const dashboardChatCard = page.locator("section.card", { hasText: "Chat with AI" }).first();
    await dashboardChatCard.scrollIntoViewIfNeeded();
    const dashboardTextarea = dashboardChatCard.locator("textarea").first();
    await dashboardTextarea.fill(`Reply with EXACT token: ${results.dashboardChat.token}`);
    await dashboardTextarea.press("Enter");
    results.dashboardChat.pass = await waitForAssistantToken(
      dashboardChatCard,
      results.dashboardChat.token,
      90000,
    );
    await page.screenshot({ path: "pw-summary-dashboard.png", fullPage: true });

    // Chat tab
    await clickNav(page, "Chat");
    await sleep(1200);
    const chatCard = page.locator("section.card.chat").first();
    await chatCard.locator("textarea").first().fill(`Reply with EXACT token: ${results.chatTab.token}`);
    await chatCard.locator("textarea").first().press("Enter");
    results.chatTab.pass = await waitForAssistantToken(chatCard, results.chatTab.token, 90000);
    await page.screenshot({ path: "pw-summary-chat-tab.png", fullPage: true });

    // Workflows AI panel
    await clickNav(page, "Workflows");
    await sleep(1600);

    const aiHeader = page.getByText("AI Workflow Assistant", { exact: false }).first();
    if (!(await isVisible(aiHeader, 2000))) {
      await page.getByRole("button", { name: /AI Assistant/i }).first().click();
      await aiHeader.waitFor({ state: "visible", timeout: 30000 });
    }

    const chatCards = page.locator("section.card.chat:visible");
    const cardCount = await chatCards.count();
    const workflowChatCard = chatCards.nth(Math.max(cardCount - 1, 0));
    const workflowTextarea = workflowChatCard.locator("textarea").first();

    const wfFrameStart = wsFrames.length;
    await workflowTextarea.fill(`Reply with EXACT token: ${results.workflowPanel.chatToken}`);
    await workflowTextarea.press("Enter");
    results.workflowPanel.chatPass = await waitForAssistantToken(
      workflowChatCard,
      results.workflowPanel.chatToken,
      90000,
    );
    const wfFrames = wsFrames.slice(wfFrameStart);
    results.workflowPanel.wsSentMethods = uniqueMethods(wfFrames);

    // Workflow creation via the workflow panel Send path
    const wfName = results.workflowPanel.createViaSend.wfName;
    const hookPath = results.workflowPanel.createViaSend.hookPath;
    const createPrompt = [
      `Create an n8n workflow with EXACT name ${wfName}.`,
      `Use webhook trigger path ${hookPath}.`,
      "Connect trigger to a response node.",
      'Return JSON {"ok":true,"source":"playwright"}.',
    ].join("\n");

    const wfCreateStart = wsFrames.length;
    results.workflowPanel.createViaSend.attempted = true;

    const automateButton = workflowChatCard.getByRole("button", { name: /Automate|Creating/i }).first();
    const sendButton = workflowChatCard.getByRole("button", { name: /^Send/i }).first();

    await workflowTextarea.fill(createPrompt);
    await sendButton.click();
    await sleep(2500);
    results.workflowPanel.createViaSend.assistantMentionedName = await waitForAssistantToken(
      workflowChatCard,
      wfName,
      90000,
    );

    const wfCreateFrames = wsFrames.slice(wfCreateStart);
    results.workflowPanel.createViaSend.sentMethods = uniqueMethods(wfCreateFrames);
    const recvTail = [];
    for (const frame of wfCreateFrames) {
      if (typeof frame.payload !== "string") continue;
      if (frame.payload.includes('"method":"pmos.workflow.assist"')) {
        results.workflowPanel.createViaSend.wsAssistSeen = true;
      }
      if (frame.payload.includes('"method":"pmos.workflow.confirm"')) {
        results.workflowPanel.createViaSend.wsConfirmSeen = true;
      }
      if (frame.dir !== "recv") continue;
      recvTail.push(frame.payload.length > 900 ? `${frame.payload.slice(0, 900)}...` : frame.payload);
      if (recvTail.length > 6) recvTail.shift();

      const parsed = safeJsonParse(frame.payload);
      if (!parsed || typeof parsed !== "object") continue;

      if (parsed.ok === false && parsed.error) {
        results.workflowPanel.createViaSend.wsError = String(parsed.error);
      }

      const payload = parsed.payload;
      if (!payload || typeof payload !== "object") continue;

      if (payload.success === true) {
        const possibleId = payload.workflowId ?? payload.id ?? null;
        if (possibleId) {
          results.workflowPanel.createViaSend.wsConfirmSuccess = true;
          results.workflowPanel.createViaSend.wsConfirmWorkflowId = String(possibleId);
        }
      }

      if ("workflow" in payload) {
        results.workflowPanel.createViaSend.assistReturnedWorkflow = Boolean(payload.workflow);
      }

      if (
        results.workflowPanel.createViaSend.assistMessage == null &&
        typeof payload.message === "string" &&
        payload.message.trim()
      ) {
        results.workflowPanel.createViaSend.assistMessage = payload.message;
      }

      if (
        !results.workflowPanel.createViaSend.wsError &&
        typeof payload.message === "string" &&
        payload.message.toLowerCase().includes("error")
      ) {
        results.workflowPanel.createViaSend.wsError = payload.message;
      }
    }
    results.workflowPanel.createViaSend.recvTail = recvTail;

    if (results.workflowPanel.createViaSend.wsConfirmWorkflowId) {
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
        { workflowId: results.workflowPanel.createViaSend.wsConfirmWorkflowId },
      );

      if (fetched?.json?.ok) {
        const payload = pickWorkflowPayload(fetched.json);
        const analyzed = analyzeWorkflowPayload(payload, hookPath);
        results.workflowPanel.createViaSend.retrievedOk = true;
        results.workflowPanel.createViaSend.retrievedWorkflowName = analyzed.workflowName;
        results.workflowPanel.createViaSend.retrievedHasWebhookNode = analyzed.hasWebhookNode;
        results.workflowPanel.createViaSend.retrievedHasWebhookPath = analyzed.hasWebhookPath;
        results.workflowPanel.createViaSend.retrievedHasRespondNode = analyzed.hasRespondNode;

        const nodes = Array.isArray(payload?.nodes)
          ? payload.nodes
          : Array.isArray(payload?.data?.nodes)
            ? payload.data.nodes
            : [];
        results.workflowPanel.createViaSend.retrievedNodeTypes = nodes
          .map((node) => (node && typeof node === "object" && typeof node.type === "string" ? node.type : null))
          .filter(Boolean);
      }
    }

    await sleep(2500);
    const flowNamesAfter = await getVisibleFlowNames(page);
    results.workflowPanel.createViaSend.nameVisibleInList = flowNamesAfter.some((name) =>
      name.toLowerCase().includes(wfName.toLowerCase()),
    );

    // Optional: if Automate exists/enabled, capture what it creates as a separate path.
    await workflowTextarea.fill(createPrompt);
    results.workflowPanel.autoCreate.buttonEnabled = await automateButton.isEnabled().catch(() => false);
    results.workflowPanel.autoCreate.attempted = true;

    if (results.workflowPanel.autoCreate.buttonEnabled) {
      const invokePromise = page.waitForResponse(
        async (response) => {
          if (!response.url().includes("/tools/invoke")) return false;
          if (response.request().method() !== "POST") return false;
          const post = response.request().postData() || "";
          return post.includes('"tool":"ops_workflow_generate"');
        },
        { timeout: 120000 },
      ).catch(() => null);

      await automateButton.click();
      const invokeResponse = await invokePromise;
      if (invokeResponse) {
        const requestBody = safeJsonParse(invokeResponse.request().postData() || "{}");
        const responseBody = await invokeResponse.json().catch(() => null);
        results.workflowPanel.autoCreate.requestTool = requestBody?.tool ?? null;
        results.workflowPanel.autoCreate.responseOk = Boolean(responseBody?.ok);

        const payload = pickWorkflowPayload(responseBody);
        const analyzed = analyzeWorkflowPayload(payload, hookPath);
        results.workflowPanel.autoCreate.workflowId = analyzed.workflowId;
        results.workflowPanel.autoCreate.workflowName = analyzed.workflowName;
        results.workflowPanel.autoCreate.hasWebhookNode = analyzed.hasWebhookNode;
        results.workflowPanel.autoCreate.hasWebhookPath = analyzed.hasWebhookPath;
        results.workflowPanel.autoCreate.hasRespondNode = analyzed.hasRespondNode;
      }
    }

    await sleep(2000);
    await page.screenshot({ path: "pw-summary-workflows.png", fullPage: true });
  } catch (err) {
    results.errors.push(String(err));
    await page.screenshot({ path: "playwright-live-e2e-error.png", fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync("playwright-pmos-summary.json", JSON.stringify(results, null, 2));
    await context.close();
    await browser.close();
  }
}

run().catch((err) => {
  results.errors.push(String(err));
  try {
    fs.writeFileSync("playwright-pmos-summary.json", JSON.stringify(results, null, 2));
  } catch {}
  console.error(err);
  process.exit(1);
});