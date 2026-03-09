#!/usr/bin/env node
/**
 * PMOS reset and seed script.
 * Keeps only the approved accounts and rebuilds their workspace configs.
 * Run inside the PMOS container: node /tmp/reset-and-seed.js
 */
const fs = require("fs");
const path = require("path");

const BASE = "/app/.openclaw";
const AUTH_FILE = `${BASE}/pmos-auth.json`;
const GLOBAL_FILE = `${BASE}/openclaw.json`;
const WS_BASE = `${BASE}/workspaces`;
const MCPORTER_HOME = process.env.MCPORTER_HOME || "/app/.mcporter";
const MCPORTER_CONFIG_FILE =
  process.env.MCPORTER_CONFIG_PATH || path.join(MCPORTER_HOME, "mcporter.json");

const PRIMARY_MODEL = "kilo/auto-free";
const NVIDIA_API_KEY =
  process.env.NVIDIA_API_KEY ||
  "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";
const KILO_API_KEY =
  process.env.KILO_API_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb1VzZXJJZCI6IjdjOTY1OGI0LWJjYmQtNGNkMC05MjE4LTU1MzJjMzFiMTY0ZiIsImFwaVRva2VuUGVwcGVyIjpudWxsLCJ2ZXJzaW9uIjozLCJpYXQiOjE3NzEyMzIzMTIsImV4cCI6MTkyODkxMjMxMn0.SbCF4tLykUwOpChzl7KazebP8GZnahl_qaN2Vo5Inv4";

const KEEP_EMAILS = {
  "rajan@wickedwebsites.us": "acb7d6a65d6c3d12c383526040e060119fa6e7687c244268",
  "eddie@wickedlab.io": "7bd9f32092ff46af5b76f4308d6a1e56fca091df41d95587",
  "testws@wickedlab.io": "acb7d6a65d6c3d12c383526040e060119fa6e7687c244268",
};

function wsConfigFor(wsId) {
  return {
    meta: {
      lastTouchedVersion: "bcgpt-primer-2026-03-08",
      lastTouchedAt: new Date().toISOString(),
    },
    models: {
      providers: {
        kilo: {
          baseUrl: "https://api.kilo.ai/api/gateway",
          apiKey: KILO_API_KEY,
          api: "openai-completions",
          models: [
            {
              id: "auto-free",
              name: "Giga Potato (Kilo Auto Free)",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 64000,
            },
            {
              id: "minimax/minimax-m2.5:free",
              name: "MiniMax M2.5 (Free via Kilo)",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000000,
              maxTokens: 64000,
            },
          ],
        },
        nvidia: {
          baseUrl: "https://integrate.api.nvidia.com/v1",
          apiKey: NVIDIA_API_KEY,
          api: "openai-completions",
          models: [
            {
              id: "moonshotai/kimi-k2.5",
              name: "Kimi K2.5",
              reasoning: true,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 256000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    session: {
      store: `~/.openclaw/workspaces/${wsId}/agents/{agentId}/sessions/sessions.json`,
    },
    agents: {
      defaults: {
        workspace: `~/.openclaw/workspaces/${wsId}/assistant`,
        thinkingDefault: "low",
        model: {
          primary: PRIMARY_MODEL,
          fallbacks: ["local-ollama/qwen3:1.7b"],
        },
        models: {
          [PRIMARY_MODEL]: { alias: "Giga Potato (Kilo Auto Free)" },
        },
        subagents: {
          model: PRIMARY_MODEL,
          thinking: "low",
          maxConcurrent: 4,
          archiveAfterMinutes: 30,
        },
        memorySearch: {
          enabled: true,
          experimental: {
            sessionMemory: true,
          },
          sources: ["memory", "sessions"],
          sync: {
            onSessionStart: true,
            onSearch: true,
            watch: true,
          },
          store: {
            path: `~/.openclaw/workspaces/${wsId}/agents/{agentId}/memory/memory.db`,
          },
        },
      },
      list: [
        {
          id: "assistant",
          name: "Workspace Assistant",
          default: true,
          workspaceId: wsId,
          workspace: `~/.openclaw/workspaces/${wsId}/assistant`,
          identity: {
            name: "Workspace Assistant",
            emoji: "🤖",
            theme: "Workspace Assistant",
          },
          tools: { profile: "full" },
          model: PRIMARY_MODEL,
        },
      ],
    },
  };
}

function connectorsFor(bcgptApiKey) {
  return {
    bcgpt: {
      url: "https://bcgpt.wickedlab.io",
      apiKey: bcgptApiKey,
    },
  };
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  wrote ${filePath}`);
}

function rmrf(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  fs.rmSync(dirPath, { recursive: true, force: true });
  console.log(`  deleted ${dirPath}`);
}

console.log("\n=== Step 1: Cleaning user accounts ===");
const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
const before = auth.users.length;
auth.users = auth.users.filter((user) => KEEP_EMAILS[user.email]);
auth.sessions = Array.isArray(auth.sessions) ? auth.sessions : [];
const keepIds = new Set(auth.users.map((user) => user.id));
auth.sessions = auth.sessions.filter((session) => keepIds.has(session.userId));
writeJson(AUTH_FILE, auth);
console.log(
  `  Users: ${before} -> ${auth.users.length} (kept: ${auth.users.map((user) => user.email).join(", ")})`,
);

console.log("\n=== Step 2: Removing orphaned workspace directories ===");
const keepWorkspaces = new Set(auth.users.map((user) => user.workspaceId));
console.log(`  Keeping workspaces: ${[...keepWorkspaces].join(", ")}`);
const allWsDirs = fs.existsSync(WS_BASE) ? fs.readdirSync(WS_BASE) : [];
for (const wsDir of allWsDirs) {
  if (!keepWorkspaces.has(wsDir)) {
    rmrf(path.join(WS_BASE, wsDir));
  }
}

console.log("\n=== Step 3: Seeding clean workspace configs ===");
for (const user of auth.users) {
  const wsId = user.workspaceId;
  const bcgptKey = KEEP_EMAILS[user.email];
  console.log(`\n  ${user.email} -> workspace ${wsId}`);

  writeJson(path.join(WS_BASE, wsId, "config.json"), wsConfigFor(wsId));
  writeJson(path.join(WS_BASE, wsId, "connectors.json"), connectorsFor(bcgptKey));

  const sessionsDir = path.join(WS_BASE, wsId, "agents", "assistant", "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

console.log("\n=== Step 4: Cleaning global openclaw.json ===");
const global = JSON.parse(fs.readFileSync(GLOBAL_FILE, "utf8"));

const agentsBefore = Array.isArray(global.agents?.list) ? global.agents.list.length : 0;
if (Array.isArray(global.agents?.list)) {
  global.agents.list = global.agents.list.filter(
    (agent) => !String(agent?.id || "").startsWith("pw_ws_debug_"),
  );
}
const agentsAfter = Array.isArray(global.agents?.list) ? global.agents.list.length : 0;
console.log(`  Global agents: ${agentsBefore} -> ${agentsAfter}`);

global.agents = global.agents || {};
global.agents.defaults = global.agents.defaults || {};
global.agents.defaults.model = global.agents.defaults.model || {};
global.agents.defaults.model.primary = PRIMARY_MODEL;
global.agents.defaults.model.fallbacks = ["local-ollama/qwen3:1.7b"];
global.agents.defaults.thinkingDefault = global.agents.defaults.thinkingDefault || "low";
global.agents.defaults.compaction = global.agents.defaults.compaction || {};
global.agents.defaults.compaction.mode = global.agents.defaults.compaction.mode || "safeguard";
global.agents.defaults.subagents = global.agents.defaults.subagents || {};
if (
  !global.agents.defaults.subagents.model ||
  global.agents.defaults.subagents.model === "kilo/minimax/minimax-m2.5:free" ||
  global.agents.defaults.subagents.model === "kilo/auto-free" ||
  global.agents.defaults.subagents.model === "nvidia/moonshotai/kimi-k2.5" ||
  global.agents.defaults.subagents.model === "moonshot/moonshotai/kimi-k2.5"
) {
  global.agents.defaults.subagents.model = PRIMARY_MODEL;
}
global.agents.defaults.subagents.model =
  global.agents.defaults.subagents.model || PRIMARY_MODEL;
global.agents.defaults.subagents.thinking =
  global.agents.defaults.subagents.thinking || "low";
if (typeof global.agents.defaults.subagents.maxConcurrent !== "number") {
  global.agents.defaults.subagents.maxConcurrent = 4;
}
if (typeof global.agents.defaults.subagents.archiveAfterMinutes !== "number") {
  global.agents.defaults.subagents.archiveAfterMinutes = 30;
}
global.agents.defaults.memorySearch = global.agents.defaults.memorySearch || {};
if (typeof global.agents.defaults.memorySearch.enabled !== "boolean") {
  global.agents.defaults.memorySearch.enabled = true;
}
global.agents.defaults.memorySearch.experimental =
  global.agents.defaults.memorySearch.experimental || {};
if (typeof global.agents.defaults.memorySearch.experimental.sessionMemory !== "boolean") {
  global.agents.defaults.memorySearch.experimental.sessionMemory = true;
}
if (
  !Array.isArray(global.agents.defaults.memorySearch.sources) ||
  global.agents.defaults.memorySearch.sources.length === 0
) {
  global.agents.defaults.memorySearch.sources = ["memory", "sessions"];
}
global.agents.defaults.memorySearch.sync = global.agents.defaults.memorySearch.sync || {};
if (typeof global.agents.defaults.memorySearch.sync.onSessionStart !== "boolean") {
  global.agents.defaults.memorySearch.sync.onSessionStart = true;
}
if (typeof global.agents.defaults.memorySearch.sync.onSearch !== "boolean") {
  global.agents.defaults.memorySearch.sync.onSearch = true;
}
if (typeof global.agents.defaults.memorySearch.sync.watch !== "boolean") {
  global.agents.defaults.memorySearch.sync.watch = true;
}

const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";
global.gateway = global.gateway || {};
if (gatewayToken) {
  global.gateway.auth = global.gateway.auth || {};
  global.gateway.auth.token = gatewayToken;
}
delete global.gateway.token;

delete global.pmos;
if (global.gateway.controlUi) {
  delete global.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback;
}
delete global.gateway.trustedProxies;

global.browser = global.browser || {};
if (typeof global.browser.enabled !== "boolean") {
  global.browser.enabled = true;
}
if (typeof global.browser.headless !== "boolean") {
  global.browser.headless = true;
}
if (typeof global.browser.noSandbox !== "boolean") {
  global.browser.noSandbox = true;
}

global.skills = global.skills || {};
global.skills.load = global.skills.load || {};
if (typeof global.skills.load.watch !== "boolean") {
  global.skills.load.watch = true;
}
if (typeof global.skills.load.watchDebounceMs !== "number") {
  global.skills.load.watchDebounceMs = 250;
}
global.skills.install = global.skills.install || {};
global.skills.install.nodeManager = global.skills.install.nodeManager || "npm";

global.meta = {
  ...global.meta,
  lastTouchedVersion: "bcgpt-primer-2026-03-08",
  lastTouchedAt: new Date().toISOString(),
};

writeJson(GLOBAL_FILE, global);
writeJson(MCPORTER_CONFIG_FILE, {
  mcpServers: {
    figma: {
      baseUrl: "https://mcp.figma.com/mcp",
    },
  },
  imports: [],
});

console.log("\n=== Done! Summary ===");
for (const user of auth.users) {
  console.log(`  OK ${user.email} | ${user.role} | ws=${user.workspaceId}`);
}
console.log("\nAll workspaces seeded with:");
console.log(`  - Model: ${PRIMARY_MODEL}`);
console.log("  - Agent: assistant (Workspace Assistant)");
console.log("  - Memory search: enabled with session indexing defaults");
console.log("  - Subagents: enabled with shared defaults");
console.log("  - bcgpt connector: configured per-workspace");
console.log("\nRestart the pmos container to reload config.\n");
