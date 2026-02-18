#!/usr/bin/env node

const baseUrl = (process.env.PMOS_URL || "https://os.wickedlab.io").replace(/\/+$/, "");
const wsUrl = baseUrl.replace(/^http/i, (match) => (match.toLowerCase() === "https" ? "wss" : "ws"));
const token = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.PMOS_GATEWAY_TOKEN || "").trim();
const sessionKey = "smoke-main";

if (!token) {
  console.error("Missing OPENCLAW_GATEWAY_TOKEN (or PMOS_GATEWAY_TOKEN).");
  process.exit(1);
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => "");
  return { res, text };
}

async function assertGetOk(path) {
  const url = `${baseUrl}${path}`;
  const { res, text } = await fetchText(url);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return text;
}

async function assertGetAuthOk(path) {
  const url = `${baseUrl}${path}`;
  const { res, text } = await fetchText(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} (auth) failed: ${res.status} ${res.statusText} ${text}`);
  }
  return text;
}

async function assertTool(tool, args = {}) {
  const url = `${baseUrl}/tools/invoke`;
  const { res, text } = await fetchText(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool,
      args,
      sessionKey,
    }),
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // no-op
  }
  if (!res.ok || !json?.ok) {
    throw new Error(`Tool ${tool} failed: ${res.status} ${text}`);
  }
  return json;
}

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`Missing marker (${label}): ${needle}`);
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function findFlowId(value) {
  const obj = asObject(value);
  if (!obj) return null;

  const direct = obj.id ?? obj.workflowId;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nestedData = findFlowId(obj.data);
  if (nestedData) return nestedData;

  const nestedDetails = findFlowId(obj.details);
  if (nestedDetails) return nestedDetails;

  const nestedResult = findFlowId(obj.result);
  if (nestedResult) return nestedResult;

  return null;
}

function extractAssetPath(rootHtml) {
  const match = rootHtml.match(/assets\/index-[^"]+\.js/);
  if (!match?.[0]) {
    throw new Error("Could not find bundled UI asset path in root HTML.");
  }
  return `/${match[0].replace(/^\/+/, "")}`;
}

function toMessageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const parts = blocks
    .map((block) => (block && typeof block === "object" ? block.text : ""))
    .filter((text) => typeof text === "string" && text.trim())
    .map((text) => text.trim());
  return parts.join("\n");
}

function createGatewayClient() {
  const ws = new WebSocket(wsUrl, { headers: { origin: baseUrl } });
  let seq = 0;
  const pending = new Map();

  const request = (method, params = {}, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = `req-${++seq}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method,
          params,
        }),
      );
    });

  ws.onmessage = (event) => {
    let frame = null;
    try {
      frame = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    } catch {
      return;
    }
    if (frame?.type !== "res") {
      return;
    }
    const waiter = pending.get(frame.id);
    if (!waiter) {
      return;
    }
    pending.delete(frame.id);
    clearTimeout(waiter.timeout);
    if (frame.ok) {
      waiter.resolve(frame.payload);
      return;
    }
    waiter.reject(new Error(JSON.stringify(frame.error)));
  };

  const waitOpen = () =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("websocket open timeout")), 12_000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
    });

  const close = () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
    }
    pending.clear();
    try {
      ws.close();
    } catch {
      // no-op
    }
  };

  return { waitOpen, request, close };
}

async function assertGatewayChat() {
  const gateway = createGatewayClient();
  await gateway.waitOpen();

  try {
    await gateway.request(
      "connect",
      {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-ios",
          displayName: "pmos smoke",
          version: "dev-smoke",
          platform: "node",
          mode: "ui",
          instanceId: "openclaw-dev-smoke",
        },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.admin"],
        caps: [],
        auth: { token },
        userAgent: "gateway-smoke",
        locale: "en-US",
      },
      12_000,
    );

    const modelsPayload = await gateway.request("models.list", {}, 12_000);
    const models = Array.isArray(modelsPayload?.models) ? modelsPayload.models : [];
    if (models.length === 0) {
      throw new Error("models.list returned no models.");
    }

    const before = await gateway.request("chat.history", { sessionKey, limit: 20 }, 15_000);
    const beforeMessages = Array.isArray(before?.messages) ? before.messages : [];
    const beforeLastTs = beforeMessages.length
      ? Number(beforeMessages[beforeMessages.length - 1]?.timestamp || 0)
      : 0;

    const expectedText = "PMOS chat smoke ok";
    await gateway.request(
      "chat.send",
      {
        sessionKey,
        message: `Reply with exactly: ${expectedText}`,
        deliver: false,
        idempotencyKey: `smoke-${Date.now()}`,
      },
      20_000,
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 25_000);
    });

    const after = await gateway.request("chat.history", { sessionKey, limit: 20 }, 15_000);
    const afterMessages = Array.isArray(after?.messages) ? after.messages : [];
    const newAssistant = afterMessages
      .slice()
      .reverse()
      .find((msg) => msg?.role === "assistant" && Number(msg?.timestamp || 0) >= beforeLastTs);

    if (!newAssistant) {
      throw new Error("chat.send accepted, but no new assistant message was observed in chat.history.");
    }

    const text = toMessageText(newAssistant);
    if (!text) {
      throw new Error("Assistant response was empty.");
    }

    console.log(`Chat smoke ok: "${text.slice(0, 120)}${text.length > 120 ? "..." : ""}"`);
  } finally {
    gateway.close();
  }
}

async function main() {
  console.log(`PMOS smoke target: ${baseUrl}`);

  // Base routes
  const rootHtml = await assertGetOk("/");
  await assertGetOk("/health");
  await assertGetOk("/ops-ui/");
  for (const path of ["/command-center", "/admin", "/automations", "/runs", "/integrations", "/chat"]) {
    await assertGetOk(path);
  }
  await assertGetAuthOk("/api/ops/workflows");

  // UI markers live in the JS bundle (SPA).
  const assetPath = extractAssetPath(rootHtml);
  const bundle = await assertGetOk(assetPath);
  assertContains(bundle, "Command Center", "ui-command-center");
  assertContains(bundle, "Workspace Identity", "ui-workspace-identity");
  // Phase 3 UX: "native" workflows means n8n is embedded in-dashboard, not opened in a new tab.
  assertContains(bundle, "n8n workflow canvas", "ui-ops-embed");
  assertContains(bundle, "Execution Trace", "ui-execution-trace");

  // n8n ops tools + mutation smoke
  await assertTool("ops_workflows_list", {});
  await assertTool("ops_executions_list", { limit: 5 });

  const created = await assertTool("ops_workflow_create", {
    name: `PMOS Smoke ${Date.now()}`,
  });
  const flowId = findFlowId(created);
  if (!flowId) {
    throw new Error("ops_workflow_create succeeded but did not return workflow id.");
  }
  await assertTool("ops_workflow_get", { workflowId: flowId });
  await assertTool("ops_workflow_delete", { workflowId: flowId });

  // Gateway chat path (model auth + chat.send + history)
  await assertGatewayChat();

  console.log("PMOS smoke checks passed.");
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
