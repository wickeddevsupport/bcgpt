#!/usr/bin/env node
/**
 * PMOS Reset & Seed Script
 * Keeps only 3 accounts, gives each a clean isolated workspace config.
 * Run inside the pmos container: node /tmp/reset-and-seed.js
 */
const fs = require('fs');
const path = require('path');

const BASE = '/app/.openclaw';
const AUTH_FILE = `${BASE}/pmos-auth.json`;
const GLOBAL_FILE = `${BASE}/openclaw.json`;
const WS_BASE = `${BASE}/workspaces`;

const KILO_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIiwia2lsb1VzZXJJZCI6IjdjOTY1OGI0LWJjYmQtNGNkMC05MjE4LTU1MzJjMzFiMTY0ZiIsImFwaVRva2VuUGVwcGVyIjpudWxsLCJ2ZXJzaW9uIjozLCJpYXQiOjE3NzEyMzIzMTIsImV4cCI6MTkyODkxMjMxMn0.SbCF4tLykUwOpChzl7KazebP8GZnahl_qaN2Vo5Inv4';

// The 3 accounts we keep (email → bcgpt API key)
const KEEP_EMAILS = {
  'rajan@wickedwebsites.us':  'acb7d6a65d6c3d12c383526040e060119fa6e7687c244268',
  'eddie@wickedlab.io':        '7bd9f32092ff46af5b76f4308d6a1e56fca091df41d95587',
  'testws@wickedlab.io':       'acb7d6a65d6c3d12c383526040e060119fa6e7687c244268',
};

function wsConfigFor(wsId) {
  return {
    meta: {
      lastTouchedVersion: '2026.2.9',
      lastTouchedAt: new Date().toISOString(),
    },
    models: {
      providers: {
        kilo: {
          baseUrl: 'https://api.kilo.ai/api/gateway',
          apiKey: KILO_API_KEY,
          api: 'openai-completions',
          models: [
            {
              id: 'auto-free',
              name: 'Kilo Auto (Free)',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 64000,
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
        thinkingDefault: 'low',
        model: {
          primary: 'kilo/auto-free',
        },
        models: {
          'kilo/auto-free': { alias: 'Kilo (Auto Free)' },
        },
      },
      list: [
        {
          id: 'assistant',
          name: 'Workspace Assistant',
          default: true,
          workspaceId: wsId,
          workspace: `~/.openclaw/workspaces/${wsId}/assistant`,
          identity: {
            name: 'Workspace Assistant',
            emoji: '🤖',
            theme: 'Workspace Assistant',
          },
          tools: { profile: 'messaging' },
          model: 'kilo/auto-free',
        },
      ],
    },
  };
}

function connectorsFor(bcgptApiKey) {
  return {
    bcgpt: {
      url: 'https://bcgpt.wickedlab.io',
      apiKey: bcgptApiKey,
    },
  };
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ✓ wrote ${filePath}`);
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  🗑  deleted ${dir}`);
}

// ── 1. Update pmos-auth.json ──────────────────────────────────────────────
console.log('\n=== Step 1: Cleaning user accounts ===');
const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
const before = auth.users.length;
auth.users = auth.users.filter(u => KEEP_EMAILS[u.email]);
auth.sessions = auth.sessions || [];
// Prune sessions for removed users
const keepIds = new Set(auth.users.map(u => u.id));
auth.sessions = auth.sessions.filter(s => keepIds.has(s.userId));
writeJson(AUTH_FILE, auth);
console.log(`  Users: ${before} → ${auth.users.length} (kept: ${auth.users.map(u => u.email).join(', ')})`);

// ── 2. Delete orphaned workspace dirs ────────────────────────────────────
console.log('\n=== Step 2: Removing orphaned workspace directories ===');
const keepWorkspaces = new Set(auth.users.map(u => u.workspaceId));
console.log(`  Keeping workspaces: ${[...keepWorkspaces].join(', ')}`);
const allWsDirs = fs.existsSync(WS_BASE) ? fs.readdirSync(WS_BASE) : [];
for (const wsDir of allWsDirs) {
  if (!keepWorkspaces.has(wsDir)) {
    rmrf(path.join(WS_BASE, wsDir));
  }
}

// ── 3. Write clean workspace configs ─────────────────────────────────────
console.log('\n=== Step 3: Seeding clean workspace configs ===');
for (const user of auth.users) {
  const wsId = user.workspaceId;
  const bcgptKey = KEEP_EMAILS[user.email];
  console.log(`\n  ${user.email} → workspace ${wsId}`);

  // Write config.json
  writeJson(path.join(WS_BASE, wsId, 'config.json'), wsConfigFor(wsId));

  // Write connectors.json
  writeJson(path.join(WS_BASE, wsId, 'connectors.json'), connectorsFor(bcgptKey));

  // Leave sessions dir intact (or recreate empty)
  const sessionsDir = path.join(WS_BASE, wsId, 'agents', 'assistant', 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
}

// ── 4. Clean global openclaw.json ────────────────────────────────────────
console.log('\n=== Step 4: Cleaning global openclaw.json ===');
const global = JSON.parse(fs.readFileSync(GLOBAL_FILE, 'utf8'));

// Remove PW_WS_DEBUG_ agents from global agents.list
const agentsBefore = (global.agents?.list || []).length;
if (global.agents?.list) {
  global.agents.list = global.agents.list.filter(a =>
    !String(a.id || '').startsWith('pw_ws_debug_')
  );
}
const agentsAfter = (global.agents?.list || []).length;
console.log(`  Global agents: ${agentsBefore} → ${agentsAfter}`);

// Fix global default model to kilo/auto-free
if (global.agents?.defaults?.model) {
  global.agents.defaults.model.primary = 'kilo/auto-free';
  global.agents.defaults.model.fallbacks = [];
}

// Update global meta
global.meta = { ...global.meta, lastTouchedAt: new Date().toISOString() };

writeJson(GLOBAL_FILE, global);

// ── 5. Summary ────────────────────────────────────────────────────────────
console.log('\n=== Done! Summary ===');
for (const user of auth.users) {
  console.log(`  ✅ ${user.email} | ${user.role} | ws=${user.workspaceId}`);
}
console.log('\nAll workspaces seeded with:');
console.log('  - Model: kilo/auto-free (Kilo Auto Free tier)');
console.log('  - Agent: assistant (Workspace Assistant)');
console.log('  - bcgpt connector: configured per-workspace');
console.log('\nRestart the pmos container to reload config.\n');
