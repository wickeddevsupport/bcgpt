import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnWithFallback } from "../process/spawn-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type EmbeddedN8nHandle = {
  child: any;
  url: string;
};

function uniqResolved(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function findOpenclawRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(path.join(dir, "openclaw.mjs"))) {
        return dir;
      }
    } catch {
      // ignore
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

function resolveRootCandidates(): string[] {
  const roots: string[] = [];
  const fromCwd = findOpenclawRoot(process.cwd());
  if (fromCwd) roots.push(fromCwd);
  const fromHere = findOpenclawRoot(__dirname);
  if (fromHere) roots.push(fromHere);

  // Legacy heuristic: allow importing from deeply nested build outputs.
  roots.push(path.resolve(__dirname, "..", "..", ".."));

  // Common monorepo layouts: {repo}/openclaw as a nested package.
  roots.push(path.join(process.cwd(), "openclaw"));

  // Also consider parent dirs of each root so we can resolve {repo}/openclaw/vendor/n8n
  // when we started inside {repo}/openclaw.
  for (const root of [...roots]) {
    roots.push(path.dirname(root));
  }

  return uniqResolved(roots);
}

function isN8nRepoDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    // Minimal shape check to avoid false positives on arbitrary directories.
    if (fs.existsSync(path.join(dir, "packages", "cli"))) return true;
    if (fs.existsSync(path.join(dir, "packages", "cli", "bin", "n8n"))) return true;
    return false;
  } catch {
    return false;
  }
}

function resolveRepoCandidates(): string[] {
  // Candidate locations:
  // - env override
  // - repo-root/n8n (legacy)
  // - repo-root/vendor/n8n (when OpenClaw itself is repo root)
  // - repo-root/openclaw/vendor/n8n (when OpenClaw is nested under a parent repo)
  const envPath = process.env.N8N_EMBED_PATH?.trim();
  const candidates: string[] = [];

  if (envPath) candidates.push(envPath);

  for (const root of resolveRootCandidates()) {
    candidates.push(path.join(root, "n8n"));
    candidates.push(path.join(root, "vendor", "n8n"));
    candidates.push(path.join(root, "openclaw", "vendor", "n8n"));
  }

  // Keep order while removing accidental duplicates.
  return uniqResolved(candidates);
}

export function findVendoredN8nRepo(): string | null {
  const candidates = resolveRepoCandidates();
  for (const c of candidates) {
    if (isN8nRepoDir(c)) return c;
  }
  return null;
}

/**
 * Resolve custom n8n node package directories.
 * Sources:
 * - vendored n8n custom nodes directory: vendor/n8n/custom/nodes/*
 * - legacy root-level package fallback: ../../n8n-nodes-basecamp
 */
function resolveCustomNodeDirs(n8nRepoDir: string): string[] {
  const found = new Set<string>();

  const addIfPackage = (candidate: string) => {
    try {
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        found.add(path.resolve(candidate));
      }
    } catch {
      // ignore
    }
  };

  // Legacy fallbacks
  addIfPackage(path.join(n8nRepoDir, "packages", "cli", "node_modules", "n8n-nodes-basecamp"));
  addIfPackage(path.join(n8nRepoDir, "..", "..", "n8n-nodes-basecamp"));

  // Vendored custom node packages (preferred)
  const customNodesRoot = path.join(n8nRepoDir, "custom", "nodes");
  try {
    const entries = fs.readdirSync(customNodesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      addIfPackage(path.join(customNodesRoot, entry.name));
    }
  } catch {
    // ignore missing custom nodes dir
  }

  return Array.from(found);
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
  // Use a syntactically valid email by default (n8n validates owner email on setup).
  env.N8N_OWNER_EMAIL = env.N8N_OWNER_EMAIL ?? process.env.N8N_OWNER_EMAIL ?? "admin@openclaw.local";
  env.N8N_OWNER_PASSWORD = env.N8N_OWNER_PASSWORD ?? process.env.N8N_OWNER_PASSWORD ?? "changeme";
  // Keep gateway env in sync with the embedded child so the auth bridge can bootstrap.
  process.env.N8N_OWNER_EMAIL = process.env.N8N_OWNER_EMAIL ?? env.N8N_OWNER_EMAIL;
  process.env.N8N_OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD ?? env.N8N_OWNER_PASSWORD;

  // Custom nodes: tell n8n where to find additional community node packages.
  const customNodeDirs = resolveCustomNodeDirs(repo);
  if (customNodeDirs.length > 0) {
    const existing = (env.N8N_CUSTOM_EXTENSIONS ?? "")
      .split(path.delimiter)
      .map((part) => part.trim())
      .filter(Boolean);
    env.N8N_CUSTOM_EXTENSIONS = Array.from(new Set([...existing, ...customNodeDirs])).join(
      path.delimiter,
    );
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
