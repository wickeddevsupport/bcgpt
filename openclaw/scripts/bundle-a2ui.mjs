#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const shellScript = path.join(__dirname, "bundle-a2ui.sh");
const outputBundle = path.join(rootDir, "src", "canvas-host", "a2ui", "a2ui.bundle.js");

const bashCommand = process.platform === "win32" ? "bash.exe" : "bash";
const probe = spawnSync(bashCommand, ["--version"], {
  cwd: rootDir,
  stdio: "ignore",
});

if (probe.status === 0) {
  const run = spawnSync(bashCommand, [shellScript], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(run.status ?? 1);
}

if (fs.existsSync(outputBundle)) {
  console.warn("[canvas:a2ui:bundle] bash unavailable; using existing prebuilt bundle.");
  process.exit(0);
}

console.error(
  `[canvas:a2ui:bundle] bash is required to build A2UI bundle, and no prebuilt bundle was found at ${outputBundle}.`,
);
process.exit(1);
