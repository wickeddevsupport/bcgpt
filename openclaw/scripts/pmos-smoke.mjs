#!/usr/bin/env node

const baseUrl = (process.env.PMOS_URL || "https://os.wickedlab.io").replace(/\/+$/, "");
const wsUrl = baseUrl.replace(/^http/i, (match) => (match.toLowerCase() === "https" ? "wss" : "ws"));
const token = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.PMOS_GATEWAY_TOKEN || "").trim();
const projectId = (process.env.ACTIVEPIECES_PROJECT_ID || "").trim();
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
  for (const path of ["/command-center", "/admin", "/automations", "/runs", "/integrations", "/chat"]) {
    await assertGetOk(path);
  }

  // UI markers live in the JS bundle (SPA).
  const assetPath = extractAssetPath(rootHtml);
  const bundle = await assertGetOk(assetPath);
  assertContains(bundle, "Command Center", "phase6");
  assertContains(bundle, "Workspace Identity", "phase4");
  assertContains(bundle, "AI Flow Builder", "phase5");
  assertContains(bundle, "Execution Trace", "phase3");

  // Activepieces tools + mutation smoke
  if (projectId) {
    await assertTool("flow_flows_list", { projectId, limit: 5 });
    await assertTool("flow_flow_runs_list", { projectId, limit: 5 });

    const created = await assertTool("flow_flow_create", {
      projectId,
      displayName: `PMOS Smoke ${Date.now()}`,
    });
    const flowId = created?.result?.details?.id;
    if (!flowId || typeof flowId !== "string") {
      throw new Error("flow_flow_create succeeded but did not return flow id.");
    }
    await assertTool("flow_flow_get", { flowId });
    await assertTool("flow_flow_delete", { flowId });
  } else {
    console.warn("ACTIVEPIECES_PROJECT_ID not provided; skipping flow tool smoke.");
  }

  // Gateway chat path (model auth + chat.send + history)
  await assertGatewayChat();

  console.log("PMOS smoke checks passed.");
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
