#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const rawInput = process.argv[2];
if (!rawInput) {
  fail("Usage: node scripts/ci/update-n8n-version.mjs <n8n@X.Y.Z|X.Y.Z>");
}

const normalized = rawInput.trim().replace(/^n8n@/, "");
if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
  fail(`Invalid n8n version: "${rawInput}". Expected "n8n@X.Y.Z" or "X.Y.Z".`);
}

const repoRoot = process.cwd();
const dockerfilePath = path.join(repoRoot, "Dockerfile.openclaw.nx");
const opsComposePath = path.join(repoRoot, "docker-compose.ops.yml");
const targetArg = `ARG N8N_VERSION=n8n@${normalized}`;
const targetOpsImage = `ghcr.io/wickeddevsupport/openclaw-n8n-vendor:n8n-${normalized}`;

if (!fs.existsSync(dockerfilePath)) {
  fail(`Missing file: ${dockerfilePath}`);
}

const before = fs.readFileSync(dockerfilePath, "utf8");
const pattern = /^ARG N8N_VERSION=n8n@\d+\.\d+\.\d+$/m;

if (!pattern.test(before)) {
  fail(`Could not find N8N_VERSION arg in ${dockerfilePath}`);
}

const after = before.replace(pattern, targetArg);
if (after !== before) {
  fs.writeFileSync(dockerfilePath, after, "utf8");
  console.log(`Updated Dockerfile.openclaw.nx -> ${targetArg}`);
} else {
  console.log(`No change needed. Dockerfile already uses ${targetArg}.`);
}

if (!fs.existsSync(opsComposePath)) {
  fail(`Missing file: ${opsComposePath}`);
}

const opsBefore = fs.readFileSync(opsComposePath, "utf8");
const opsPattern =
  /^(\s*image:\s*ghcr\.io\/wickeddevsupport\/openclaw-n8n-vendor:)n8n-\d+\.\d+\.\d+$/m;

if (!opsPattern.test(opsBefore)) {
  fail(`Could not find pinned OPS vendor image in ${opsComposePath}`);
}

const opsAfter = opsBefore.replace(opsPattern, `$1n8n-${normalized}`);
if (opsAfter !== opsBefore) {
  fs.writeFileSync(opsComposePath, opsAfter, "utf8");
  console.log(`Updated docker-compose.ops.yml -> ${targetOpsImage}`);
} else {
  console.log(`No change needed. OPS compose already uses ${targetOpsImage}.`);
}
