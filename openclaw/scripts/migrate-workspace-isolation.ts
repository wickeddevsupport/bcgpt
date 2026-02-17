#!/usr/bin/env npx tsx
/**
 * Migration script for PMOS workspace isolation
 *
 * Assigns workspaceId to existing agents (in main config) and cron jobs
 * that were created before workspace isolation was implemented.
 *
 * Usage:
 *   npx tsx scripts/migrate-workspace-isolation.ts [--dry-run] [--workspace-id=ID]
 *
 * Options:
 *   --dry-run           Preview changes without writing
 *   --workspace-id=ID   Assign all entities to a specific workspace ID
 *                       (default: auto-detect from first super_admin in pmos-auth.json)
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, writeConfigFile } from "../src/config/config.js";
import { resolveStateDir } from "../src/config/paths.js";
import { listAgentEntries, applyAgentConfig } from "../src/commands/agents.config.js";
import { normalizeAgentId } from "../src/routing/session-key.js";
import { loadCronStore, saveCronStore, DEFAULT_CRON_STORE_PATH } from "../src/cron/store.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const workspaceIdArg = args.find((a) => a.startsWith("--workspace-id="))?.split("=")[1];

interface MigrationResult {
  agentsUpdated: number;
  cronJobsUpdated: number;
  errors: string[];
}

/**
 * Read pmos-auth.json and find the first super_admin's workspaceId.
 */
function findSuperAdminWorkspaceId(): string | undefined {
  const authPath = path.join(resolveStateDir(), "pmos-auth.json");
  try {
    const raw = fs.readFileSync(authPath, "utf-8");
    const store = JSON.parse(raw) as {
      users?: Array<{ role?: string; workspaceId?: string }>;
    };
    const superAdmin = store.users?.find((u) => u.role === "super_admin");
    return superAdmin?.workspaceId;
  } catch {
    return undefined;
  }
}

async function migrate(): Promise<MigrationResult> {
  const result: MigrationResult = {
    agentsUpdated: 0,
    cronJobsUpdated: 0,
    errors: [],
  };

  // Determine the target workspace ID
  let targetWorkspaceId = workspaceIdArg;

  if (!targetWorkspaceId) {
    targetWorkspaceId = findSuperAdminWorkspaceId();
    if (targetWorkspaceId) {
      console.log(`Auto-detected super_admin workspace: ${targetWorkspaceId}`);
    } else {
      console.error(
        "ERROR: Could not find super_admin workspace. " +
          "Use --workspace-id=<ID> or ensure pmos-auth.json exists with a super_admin user.",
      );
      process.exit(1);
    }
  }

  console.log(`\n=== Workspace Isolation Migration ===`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE (will write changes)"}`);
  console.log(`Target workspace: ${targetWorkspaceId}`);
  console.log(`State directory: ${resolveStateDir()}\n`);

  // --- Migrate agents in main config ---
  console.log(`--- Migrating Agents (config file) ---`);
  let cfg = loadConfig();
  const agents = listAgentEntries(cfg);
  let configChanged = false;

  for (const agent of agents) {
    const agentId = normalizeAgentId(agent.id);

    if (!agent.workspaceId) {
      console.log(`  Agent "${agentId}": Adding workspaceId="${targetWorkspaceId}"`);
      if (!dryRun) {
        cfg = applyAgentConfig(cfg, { agentId, workspaceId: targetWorkspaceId });
        configChanged = true;
      }
      result.agentsUpdated++;
    } else {
      console.log(`  Agent "${agentId}": Already has workspaceId="${agent.workspaceId}"`);
    }
  }

  if (!dryRun && configChanged) {
    try {
      await writeConfigFile(cfg);
      console.log(`  Config file written successfully.`);
    } catch (err) {
      const msg = `Failed to write config: ${err}`;
      console.error(`  ERROR: ${msg}`);
      result.errors.push(msg);
    }
  }

  // --- Migrate cron jobs ---
  console.log(`\n--- Migrating Cron Jobs ---`);
  try {
    const cronStore = await loadCronStore(DEFAULT_CRON_STORE_PATH);
    let cronUpdated = false;

    for (const job of cronStore.jobs) {
      if (!(job as { workspaceId?: string }).workspaceId) {
        console.log(
          `  Cron job "${job.id}" (${job.name || "unnamed"}): Adding workspaceId="${targetWorkspaceId}"`,
        );
        if (!dryRun) {
          (job as { workspaceId?: string }).workspaceId = targetWorkspaceId;
          cronUpdated = true;
        }
        result.cronJobsUpdated++;
      } else {
        console.log(
          `  Cron job "${job.id}" (${job.name || "unnamed"}): Already has workspaceId="${(job as { workspaceId?: string }).workspaceId}"`,
        );
      }
    }

    if (!dryRun && cronUpdated) {
      await saveCronStore(DEFAULT_CRON_STORE_PATH, cronStore);
      console.log(`  Cron store written successfully.`);
    }
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      console.log(`  No cron store found (no cron jobs to migrate).`);
    } else {
      const msg = `Failed to migrate cron jobs: ${err}`;
      console.error(`  ERROR: ${msg}`);
      result.errors.push(msg);
    }
  }

  return result;
}

migrate()
  .then((result) => {
    console.log(`\n=== Migration Summary ===`);
    console.log(`Agents updated: ${result.agentsUpdated}`);
    console.log(`Cron jobs updated: ${result.cronJobsUpdated}`);

    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      for (const e of result.errors) {
        console.log(`  - ${e}`);
      }
      process.exit(1);
    }

    if (dryRun) {
      console.log(`\nThis was a dry run. Run without --dry-run to apply changes.`);
    } else {
      console.log(`\nMigration complete!`);
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error(`Migration failed:`, err);
    process.exit(1);
  });
