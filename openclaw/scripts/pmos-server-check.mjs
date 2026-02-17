#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const sshHost = (process.env.PMOS_SSH_HOST || "deploy@46.225.102.175").trim();
const sshKey = (process.env.PMOS_SSH_KEY || "").trim();
const containerHint = (process.env.PMOS_CONTAINER_HINT || "pmos").trim().toLowerCase();
const tailLinesRaw = Number(process.env.PMOS_LOG_TAIL || "300");
const tailLines = Number.isFinite(tailLinesRaw) ? Math.max(50, Math.floor(tailLinesRaw)) : 300;

if (!sshKey) {
  console.error("Missing PMOS_SSH_KEY. Example:");
  console.error("  PMOS_SSH_KEY=C:\\Users\\rjnd\\.ssh\\bcgpt_hetzner node openclaw/scripts/pmos-server-check.mjs");
  process.exit(1);
}

function runSsh(remoteCommand) {
  const args = [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    sshHost,
    remoteCommand,
  ];
  const result = spawnSync("ssh", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`ssh command failed (${result.status ?? "?"}): ${err}`);
  }
  return (result.stdout || "").trim();
}

function pickContainer(lines) {
  const rows = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", status = ""] = line.split("\t");
      return { name, status };
    })
    .filter((row) => row.name.toLowerCase().includes(containerHint));

  if (rows.length === 0) {
    return null;
  }

  const preferred = rows.find((row) => row.name.startsWith("pmos-"));
  return preferred ?? rows[0];
}

function report(status, label, value) {
  console.log(`${status} ${label}: ${value}`);
}

try {
  const psOut = runSsh(`docker ps --format '{{.Names}}\\t{{.Status}}'`);
  const containers = psOut.split(/\r?\n/);
  const selected = pickContainer(containers);

  if (!selected) {
    report("FAIL", "container", `no running container matched hint "${containerHint}"`);
    process.exit(2);
  }

  report("OK", "container", `${selected.name} (${selected.status})`);

  const logs = runSsh(`docker logs ${selected.name} --tail ${tailLines} 2>&1`);
  const hasEmbeddedMarker = logs.includes("[n8n] embedded n8n started");
  const hasDeprecatedPlugin = logs.includes("[pmos-activepieces] registering tools");
  const hasConnectorStatus = logs.includes("pmos.connectors.status");

  report(hasEmbeddedMarker ? "OK" : "WARN", "embedded-n8n-marker", hasEmbeddedMarker ? "present" : "missing");
  report(
    hasDeprecatedPlugin ? "WARN" : "OK",
    "deprecated-plugin-marker",
    hasDeprecatedPlugin ? "pmos-activepieces detected" : "not detected",
  );
  report(hasConnectorStatus ? "OK" : "WARN", "connector-status-traffic", hasConnectorStatus ? "present" : "missing");

  if (!hasEmbeddedMarker || hasDeprecatedPlugin) {
    console.log(
      "RESULT: FAIL - runtime does not match target state. Redeploy latest main via Coolify and re-check.",
    );
    process.exit(3);
  }

  console.log("RESULT: PASS - embedded n8n marker found and deprecated plugin marker absent.");
} catch (err) {
  report("FAIL", "ssh-check", err instanceof Error ? err.message : String(err));
  process.exit(2);
}
