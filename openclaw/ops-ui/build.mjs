#!/usr/bin/env node
/**
 * Build the n8n editor-ui from a local n8n monorepo checkout.
 *
 * Usage:
 *   node build.mjs
 *
 * Configuration (env vars):
 *   N8N_REPO_PATH   Path to the local n8n monorepo (default: ../../n8n relative to bcgpt root,
 *                   i.e. sibling of the bcgpt repo at ~/Documents/GitHub/n8n)
 *   N8N_PUBLIC_PATH Public path the editor is served from (default: /ops-ui/)
 *
 * What this does:
 *   1. Resolves the n8n editor-ui source at N8N_REPO_PATH/packages/frontend/editor-ui
 *   2. Installs monorepo dependencies via pnpm if node_modules is missing
 *   3. Builds the editor-ui with VUE_APP_PUBLIC_PATH=/ops-ui/
 *   4. Copies the built dist/ into this directory (openclaw/ops-ui/dist/)
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Resolve paths ────────────────────────────────────────────────────────────

const bcgptRoot = path.resolve(__dirname, "..");
// Prefer explicit env, then vendored copy (openclaw/vendor/n8n), then sibling ../n8n
const vendorCandidate = path.join(bcgptRoot, "openclaw", "vendor", "n8n");
const siblingCandidate = path.resolve(bcgptRoot, "..", "n8n");
const defaultN8nRepo = process.env.N8N_REPO_PATH ?? (fs.existsSync(vendorCandidate) ? vendorCandidate : siblingCandidate);
const n8nRepoPath = process.env.N8N_REPO_PATH ?? defaultN8nRepo;
const publicPath = process.env.N8N_PUBLIC_PATH ?? "/ops-ui/";
const outputDir = path.join(__dirname, "dist");

const editorUiDir = path.join(n8nRepoPath, "packages", "frontend", "editor-ui");

// ── Sanity checks ─────────────────────────────────────────────────────────────

if (!fs.existsSync(n8nRepoPath)) {
  console.error(`[ops-ui] n8n repo not found at: ${n8nRepoPath}`);
  console.error(`[ops-ui] Clone it with:`);
  console.error(
    `[ops-ui]   git clone --depth=1 --filter=blob:none --sparse https://github.com/n8n-io/n8n.git ${n8nRepoPath}`,
  );
  console.error(
    `[ops-ui]   cd ${n8nRepoPath} && git sparse-checkout set packages/frontend packages/@n8n`,
  );
  console.error(`[ops-ui] Or set N8N_REPO_PATH env var to point to your n8n checkout.`);
  process.exit(1);
}

if (!fs.existsSync(editorUiDir)) {
  console.error(`[ops-ui] editor-ui not found at: ${editorUiDir}`);
  console.error(
    `[ops-ui] Run: cd ${n8nRepoPath} && git sparse-checkout set packages/frontend packages/@n8n && git checkout`,
  );
  process.exit(1);
}

console.log(`[ops-ui] Building n8n editor-ui from: ${editorUiDir}`);
console.log(`[ops-ui] Public path: ${publicPath}`);

// ── Install dependencies if needed ────────────────────────────────────────────

const nodeModulesRoot = path.join(n8nRepoPath, "node_modules");
if (!fs.existsSync(nodeModulesRoot)) {
  console.log(`[ops-ui] Installing n8n monorepo dependencies (this may take a while)...`);
  const result = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: n8nRepoPath,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error("[ops-ui] pnpm install failed");
    process.exit(result.status ?? 1);
  }
} else {
  console.log(`[ops-ui] node_modules found, skipping install.`);
}

// ── Build editor-ui ────────────────────────────────────────────────────────────

console.log(`[ops-ui] Building editor-ui...`);
const buildResult = spawnSync(
  "pnpm",
  ["--filter", "n8n-editor-ui", "build"],
  {
    cwd: n8nRepoPath,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      VUE_APP_PUBLIC_PATH: publicPath,
      // Point the editor's REST base to our PMOS server (same origin)
      // This is used in dev mode; in production the config injection handles it.
      VUE_APP_URL_BASE_API: "/",
      NODE_OPTIONS: "--max-old-space-size=8192",
    },
  },
);

if (buildResult.status !== 0) {
  console.error("[ops-ui] editor-ui build failed");
  process.exit(buildResult.status ?? 1);
}

// ── Copy dist into ops-ui/dist ────────────────────────────────────────────────

const n8nDist = path.join(editorUiDir, "dist");
if (!fs.existsSync(n8nDist)) {
  console.error(`[ops-ui] Build output not found at: ${n8nDist}`);
  process.exit(1);
}

if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true });
}
fs.cpSync(n8nDist, outputDir, { recursive: true });

console.log(`[ops-ui] Done. Built files in: ${outputDir}`);
console.log(`[ops-ui] Start n8n with: N8N_PATH=ops-ui n8n start`);
console.log(`[ops-ui] Then set N8N_LOCAL_URL=http://localhost:5678 in your openclaw config.`);
