#!/usr/bin/env npx tsx
/**
 * Migration script for PMOS workspace isolation (M1.5)
 * 
 * This script assigns workspaceId to existing agents and cron jobs
 * that were created before workspace isolation was implemented.
 * 
 * Usage:
 *   npx tsx scripts/migrate-workspace-isolation.ts [--dry-run] [--workspace-id=WORKSPACE_ID]
 * 
 * Options:
 *   --dry-run           Preview changes without writing
 *   --workspace-id=ID   Assign all entities to a specific workspace ID
 *                       (default: uses the first super_admin's workspace)
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, resolveStateDir } from "../src/config/config.js";
import { resolveAgentWorkspaceDir } from "../src/agents/agent-scope.js";
import { loadCronStore, saveCronStore, DEFAULT_CRON_STORE_PATH } from "../src/cron/store.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const workspaceIdArg = args.find((a) => a.startsWith("--workspace-id="))?.split("=")[1];

interface MigrationResult {
  agentsUpdated: number;
  cronJobsUpdated: number;
  errors: string[];
}

async function migrate(): Promise<MigrationResult> {
  const result: MigrationResult = {
    agentsUpdated: 0,
    cronJobsUpdated: 0,
    errors: [],
  };

  const cfg = loadConfig();
  const stateDir = resolveStateDir();

  // Determine the default workspace ID
  let defaultWorkspaceId: string | undefined = workspaceIdArg;

  if (!defaultWorkspaceId) {
    // Try to find the first super_admin's workspace from config
    // In PMOS, this would typically be set up during initial deployment
    // For now, we'll use a placeholder that should be replaced
    defaultWorkspaceId = process.env.PMOS_DEFAULT_WORKSPACE_ID || "default-workspace";
    console.log(`No workspace ID specified, using: ${defaultWorkspaceId}`);
    console.log(`Set PMOS_DEFAULT_WORKSPACE_ID env var or use --workspace-id to override`);
  }

  console.log(`\n=== Workspace Isolation Migration ===`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE (will write changes)"}`);
  console.log(`Target workspace: ${defaultWorkspaceId}`);
  console.log(`State directory: ${stateDir}\n`);

  // Migrate agents
  console.log(`--- Migrating Agents ---`);
  const agents = cfg.agents?.list ?? [];
  
  for (const agentEntry of agents) {
    if (!agentEntry?.id) continue;
    
    const agentId = agentEntry.id;
    const agentDir = resolveAgentWorkspaceDir(cfg, agentId);
    const agentConfigPath = path.join(agentDir, "agent.json");
    
    try {
      if (fs.existsSync(agentConfigPath)) {
        const agentConfig = JSON.parse(fs.readFileSync(agentConfigPath, "utf-8"));
        
        if (!agentConfig.workspaceId) {
          console.log(`  Agent "${agentId}": Adding workspaceId="${defaultWorkspaceId}"`);
          
          if (!dryRun) {
            agentConfig.workspaceId = defaultWorkspaceId;
            fs.writeFileSync(agentConfigPath, JSON.stringify(agentConfig, null, 2));
          }
          result.agentsUpdated++;
        } else {
          console.log(`  Agent "${agentId}": Already has workspaceId="${agentConfig.workspaceId}"`);
        }
      } else {
        console.log(`  Agent "${agentId}": No config file at ${agentConfigPath}`);
      }
    } catch (err) {
      const msg = `Failed to migrate agent "${agentId}": ${err}`;
      console.error(`  ERROR: ${msg}`);
      result.errors.push(msg);
    }
  }

  // Migrate cron jobs
  console.log(`\n--- Migrating Cron Jobs ---`);
  const cronStorePath = DEFAULT_CRON_STORE_PATH;
  
  try {
    const cronStore = await loadCronStore(cronStorePath);
    let cronUpdated = false;
    
    for (const job of cronStore.jobs) {
      if (!job.workspaceId) {
        console.log(`  Cron job "${job.id}" (${job.name || "unnamed"}): Adding workspaceId="${defaultWorkspaceId}"`);
        
        if (!dryRun) {
          job.workspaceId = defaultWorkspaceId;
          cronUpdated = true;
        }
        result.cronJobsUpdated++;
      } else {
        console.log(`  Cron job "${job.id}" (${job.name || "unnamed"}): Already has workspaceId="${job.workspaceId}"`);
      }
    }
    
    if (!dryRun && cronUpdated) {
      await saveCronStore(cronStorePath, cronStore);
    }
  } catch (err) {
    const msg = `Failed to migrate cron jobs: ${err}`;
    console.error(`  ERROR: ${msg}`);
    result.errors.push(msg);
  }

  return result;
}

// Run migration
migrate()
  .then((result) => {
    console.log(`\n=== Migration Summary ===`);
    console.log(`Agents updated: ${result.agentsUpdated}`);
    console.log(`Cron jobs updated: ${result.cronJobsUpdated}`);
    
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      result.errors.forEach((e) => console.log(`  - ${e}`));
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