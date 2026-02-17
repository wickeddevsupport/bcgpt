#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openclawDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(openclawDir, "..");
const vendorDir = path.join(openclawDir, "vendor");
const n8nDir = path.join(vendorDir, "n8n");
const markerPath = path.join(vendorDir, "n8n.vendor.json");

const args = process.argv.slice(2);
const versionArg = args.find((arg) => arg.startsWith("--version="));
const force = args.includes("--force");
const skipBuild = args.includes("--skip-build");
const version = versionArg ? versionArg.slice("--version=".length).trim() : "n8n@1.76.1";

function run(command, commandArgs, cwd, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeMarker() {
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        version,
        installedAt: new Date().toISOString(),
        script: "openclaw/scripts/vendor-n8n.mjs",
      },
      null,
      2,
    ).concat("\n"),
    "utf-8",
  );
}

console.log("=== OpenClaw vendored n8n setup ===");
console.log(`Version: ${version}`);
console.log(`Target:  ${n8nDir}`);

if (fs.existsSync(path.join(n8nDir, "packages", "cli"))) {
  if (!force) {
    console.log("n8n vendor already exists. Use --force to re-install.");
    process.exit(0);
  }
  console.log("Removing existing vendored n8n (--force).");
  fs.rmSync(n8nDir, { recursive: true, force: true });
}

fs.mkdirSync(vendorDir, { recursive: true });
run("git", ["clone", "--depth", "1", "--branch", version, "https://github.com/n8n-io/n8n.git", n8nDir], openclawDir);

if (!skipBuild) {
  // Use corepack directly (without global shim install) to keep this portable on Windows.
  run("corepack", ["pnpm", "install", "--frozen-lockfile"], n8nDir, { CI: "1" });
  run("corepack", ["pnpm", "build"], n8nDir, { CI: "1" });
}

const basecampNodeDir = path.join(repoRoot, "n8n-nodes-basecamp");
if (fs.existsSync(basecampNodeDir)) {
  console.log("Installing Basecamp node into vendored n8n.");
  run("npm", ["run", "build"], basecampNodeDir);
  const targets = [
    path.join(n8nDir, "packages", "cli", "node_modules", "n8n-nodes-basecamp"),
    path.join(n8nDir, "custom", "nodes", "n8n-nodes-basecamp"),
  ];
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of ["dist", "package.json"]) {
      const source = path.join(basecampNodeDir, entry);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(target, entry);
      if (fs.existsSync(destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      fs.cpSync(source, destination, { recursive: true });
    }
  }
}

writeMarker();
console.log("Vendored n8n is ready.");
