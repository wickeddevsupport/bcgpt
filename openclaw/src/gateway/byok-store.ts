/**
 * BYOK (Bring Your Own Keys) – encrypted key storage per workspace.
 *
 * Keys are encrypted at rest using AES-256-GCM. The master key is derived
 * from the OPENCLAW_BYOK_SECRET env var (or a persistent random secret
 * stored in the state directory).
 *
 * Storage location: ~/.openclaw/workspaces/{workspaceId}/byok.json
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ensureDir } from "../utils.js";

// ── Types ──────────────────────────────────────────────────────────────

export type AIProvider = "openai" | "anthropic" | "google" | "azure" | "custom";

export interface ByokEntry {
  provider: AIProvider;
  /** User-facing label (e.g. "My OpenAI key") */
  label: string;
  /** AES-256-GCM encrypted API key (base64) */
  encryptedKey: string;
  /** IV used for this encryption (base64) */
  iv: string;
  /** Auth tag (base64) */
  tag: string;
  /** Default model ID for this provider */
  defaultModel?: string;
  /** Whether key has been validated against the provider API */
  validated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ByokStore {
  workspaceId: string;
  keys: Record<string, ByokEntry>; // keyed by provider
  updatedAt: string;
}

// ── Encryption helpers ─────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;

let _masterKey: Buffer | null = null;

function secretFilePath(): string {
  return path.join(CONFIG_DIR, "byok.secret");
}

async function getMasterKey(): Promise<Buffer> {
  if (_masterKey) return _masterKey;

  // 1. Env var override
  const envSecret = process.env.OPENCLAW_BYOK_SECRET?.trim();
  if (envSecret) {
    _masterKey = crypto.scryptSync(envSecret, "openclaw-byok-salt", KEY_LENGTH);
    return _masterKey;
  }

  // 2. Persistent secret file
  const secretPath = secretFilePath();
  try {
    const raw = await fs.readFile(secretPath, "utf-8");
    const buf = Buffer.from(raw.trim(), "hex");
    if (buf.length === KEY_LENGTH) {
      _masterKey = buf;
      return _masterKey;
    }
  } catch {
    // File doesn't exist yet — create it
  }

  // 3. Generate new random secret
  const secret = crypto.randomBytes(KEY_LENGTH);
  await ensureDir(path.dirname(secretPath));
  await fs.writeFile(secretPath, secret.toString("hex") + "\n", { mode: 0o600 });
  _masterKey = secret;
  return _masterKey;
}

function encrypt(plaintext: string, key: Buffer): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(encrypted: string, iv: string, tag: string, key: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ── File I/O ───────────────────────────────────────────────────────────

function byokPath(workspaceId: string): string {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, "byok.json");
}

async function readStore(workspaceId: string): Promise<ByokStore> {
  const p = byokPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as ByokStore;
  } catch {
    return { workspaceId, keys: {}, updatedAt: new Date().toISOString() };
  }
}

async function writeStore(store: ByokStore): Promise<void> {
  const p = byokPath(store.workspaceId);
  await ensureDir(path.dirname(p));
  const raw = JSON.stringify(store, null, 2).trimEnd().concat("\n");
  await fs.writeFile(p, raw, { mode: 0o600 });
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Add or update a key for a provider in the given workspace.
 */
export async function setKey(
  workspaceId: string,
  provider: AIProvider,
  apiKey: string,
  opts?: { label?: string; defaultModel?: string },
): Promise<void> {
  const key = await getMasterKey();
  const { encrypted, iv, tag } = encrypt(apiKey, key);
  const now = new Date().toISOString();

  const store = await readStore(workspaceId);
  const existing = store.keys[provider];

  store.keys[provider] = {
    provider,
    label: opts?.label ?? existing?.label ?? provider,
    encryptedKey: encrypted,
    iv,
    tag,
    defaultModel: opts?.defaultModel ?? existing?.defaultModel,
    validated: false, // reset validation on key change
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.updatedAt = now;

  await writeStore(store);
}

/**
 * Retrieve the decrypted API key for a provider.
 */
export async function getKey(workspaceId: string, provider: AIProvider): Promise<string | null> {
  const store = await readStore(workspaceId);
  const entry = store.keys[provider];
  if (!entry) return null;

  const key = await getMasterKey();
  try {
    return decrypt(entry.encryptedKey, entry.iv, entry.tag, key);
  } catch {
    return null; // corrupted or master key changed
  }
}

/**
 * Remove a provider's key from the workspace.
 */
export async function removeKey(workspaceId: string, provider: AIProvider): Promise<boolean> {
  const store = await readStore(workspaceId);
  if (!store.keys[provider]) return false;
  delete store.keys[provider];
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return true;
}

/**
 * List all keys for a workspace (without decrypted values).
 */
export async function listKeys(
  workspaceId: string,
): Promise<Array<{ provider: AIProvider; label: string; defaultModel?: string; validated?: boolean; createdAt: string; updatedAt: string }>> {
  const store = await readStore(workspaceId);
  return Object.values(store.keys).map((entry) => ({
    provider: entry.provider,
    label: entry.label,
    defaultModel: entry.defaultModel,
    validated: entry.validated,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

/**
 * Mark a key as validated (after a successful test API call).
 */
export async function markValidated(
  workspaceId: string,
  provider: AIProvider,
  valid: boolean,
): Promise<void> {
  const store = await readStore(workspaceId);
  const entry = store.keys[provider];
  if (!entry) return;
  entry.validated = valid;
  entry.updatedAt = new Date().toISOString();
  store.updatedAt = entry.updatedAt;
  await writeStore(store);
}

/**
 * Validate a key by making a lightweight API call to the provider.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export async function validateKey(
  provider: AIProvider,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    switch (provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        if (res.ok) return { valid: true };
        const body = await res.text().catch(() => "");
        return { valid: false, error: `OpenAI API returned ${res.status}: ${body.slice(0, 200)}` };
      }
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
          signal: controller.signal,
        });
        // 200 or 400 (bad request but auth passed) both indicate valid key
        if (res.ok || res.status === 400) return { valid: true };
        if (res.status === 401 || res.status === 403) {
          return { valid: false, error: "Invalid Anthropic API key" };
        }
        return { valid: true }; // other errors (429, 500) mean key is valid but service issue
      }
      case "google": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
          { signal: controller.signal },
        );
        if (res.ok) return { valid: true };
        return { valid: false, error: `Google API returned ${res.status}` };
      }
      default:
        // For custom/azure providers, we can't validate automatically
        return { valid: true };
    }
  } catch (err) {
    return { valid: false, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}
