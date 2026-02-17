import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnWithFallback } from "../process/spawn-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type EmbeddedN8nHandle = {
  child: any;
  url: string;
};

function resolveRepoCandidates(): string[] {
  // Candidate locations (env override > repo-root/n8n > openclaw/vendor/n8n)
  const envPath = process.env.N8N_EMBED_PATH?.trim();
  const bcgptRoot = path.resolve(__dirname, "..", "..", "..");
  const candidates = [] as string[];
  if (envPath) candidates.push(envPath);
  candidates.push(path.join(bcgptRoot, "n8n"));
  candidates.push(path.join(bcgptRoot, "openclaw", "vendor", "n8n"));
  return candidates;
}

export function findVendoredN8nRepo(): string | null {
  const candidates = resolveRepoCandidates();
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Resolve the Basecamp custom node directory, if installed.
 * Checks: vendored n8n node_modules → repo-root/n8n-nodes-basecamp
 */
function resolveBasecampNodeDir(n8nRepoDir: string): string | null {
  const candidates = [
    path.join(n8nRepoDir, "packages", "cli", "node_modules", "n8n-nodes-basecamp"),
    path.join(n8nRepoDir, "custom", "nodes", "n8n-nodes-basecamp"),
    path.join(n8nRepoDir, "..", "..", "n8n-nodes-basecamp"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "package.json"))) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Spawn a vendored n8n as a child process (best-effort).
 * - Sets process.env.N8N_LOCAL_URL when successful.
 * - Returns the spawned child process handle or null if not started.
 */
export async function spawnEmbeddedN8nIfVendored(opts?: { port?: number; host?: string }) {
  const repo = findVendoredN8nRepo();
  if (!repo) return null;

  const port = opts?.port ?? Number(process.env.N8N_EMBED_PORT ?? process.env.N8N_PORT ?? 5678);
  const host = opts?.host ?? process.env.N8N_EMBED_HOST ?? "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  const env = { ...process.env } as Record<string, string | undefined>;
  env.N8N_PATH = env.N8N_PATH ?? "/ops-ui/";
  env.N8N_PROTOCOL = env.N8N_PROTOCOL ?? "http";
  env.N8N_HOST = host;
  env.N8N_PORT = String(port);
  env.N8N_LOCAL_URL = baseUrl;
  // Provide owner creds if present in env to skip interactive setup
  env.N8N_OWNER_EMAIL = env.N8N_OWNER_EMAIL ?? process.env.N8N_OWNER_EMAIL ?? "admin@local";
  env.N8N_OWNER_PASSWORD = env.N8N_OWNER_PASSWORD ?? process.env.N8N_OWNER_PASSWORD ?? "changeme";

  // Custom Basecamp node: tell n8n where to find community nodes
  const basecampNodeDir = resolveBasecampNodeDir(repo);
  if (basecampNodeDir) {
    // N8N_CUSTOM_EXTENSIONS is the env var n8n uses for additional node packages
    const existing = env.N8N_CUSTOM_EXTENSIONS?.trim();
    env.N8N_CUSTOM_EXTENSIONS = existing
      ? `${existing}${path.delimiter}${basecampNodeDir}`
      : basecampNodeDir;
  }

  // Branding / UI customization
  env.N8N_TEMPLATES_ENABLED = env.N8N_TEMPLATES_ENABLED ?? "false";
  env.N8N_HIRING_BANNER_ENABLED = env.N8N_HIRING_BANNER_ENABLED ?? "false";
  env.N8N_PERSONALIZATION_ENABLED = env.N8N_PERSONALIZATION_ENABLED ?? "false";
  env.N8N_DIAGNOSTICS_ENABLED = env.N8N_DIAGNOSTICS_ENABLED ?? "false";
  env.N8N_VERSION_NOTIFICATIONS_ENABLED = env.N8N_VERSION_NOTIFICATIONS_ENABLED ?? "false";

  // Primary attempt: use the monorepo CLI binary
  const argv = [process.execPath, path.join("packages", "cli", "bin", "n8n"), "start"];

  try {
    const { child } = await spawnWithFallback({
      argv,
      options: { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
      fallbacks: [],
    });

    // Forward n8n stdout/stderr to OpenClaw process.stderr/stdout for visibility
    try {
      child.stdout?.on("data", (b: Buffer) => process.stdout.write(`[n8n] ${b.toString()}`));
      child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[n8n] ${b.toString()}`));
    } catch {
      // ignore
    }

    // Ensure the env var is set for other codepaths that check it
    process.env.N8N_LOCAL_URL = baseUrl;

    child.once("exit", (code) => {
      console.warn(`[n8n] embedded n8n exited (code=${code})`);
      // Do not clear N8N_LOCAL_URL here; restart logic (if any) should handle it.
    });

    return { child, url: baseUrl } as EmbeddedN8nHandle;
  } catch (err) {
    console.warn(`[n8n] failed to spawn embedded n8n from ${repo}: ${String(err)}`);
    return null;
  }
}
