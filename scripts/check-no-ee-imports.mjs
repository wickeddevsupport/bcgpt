/**
 * License safety guardrail.
 *
 * Fails if MIT-licensed code imports from Enterprise-licensed paths:
 * - activepieces/packages/ee/**
 * - activepieces/packages/server/api/src/app/ee/**
 *
 * This is intentionally conservative: if you genuinely need EE code,
 * do not use this guardrail and obtain a valid EE license.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(process.cwd());
const AP_ROOT = path.join(REPO_ROOT, 'activepieces');

const EE_PATH_MARKERS = [
  '/packages/ee/',
  '/packages/server/api/src/app/ee/',
  // common import prefixes that might appear
  "'@activepieces/ee-",
  '"@activepieces/ee-',
  "'../ee/",
  '"../ee/',
  "'./ee/",
  '"./ee/',
  "'../../ee/",
  '"../../ee/',
];

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.nx',
  'coverage',
  'tmp',
  '.cache',
]);

const ALLOWLIST_DIR_PREFIXES = [
  // EE directories themselves may reference EE paths.
  path.join(AP_ROOT, 'packages', 'ee') + path.sep,
  path.join(AP_ROOT, 'packages', 'server', 'api', 'src', 'app', 'ee') + path.sep,
];

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
]);

function isSubpathOfAny(filePath, prefixes) {
  return prefixes.some((p) => filePath.startsWith(p));
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
      continue;
    }
    out.push(full);
  }
}

function normalizeSlashes(s) {
  return s.replace(/\\/g, '/');
}

function shouldScan(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTS.has(ext);
}

function fileContainsEeImport(content) {
  const normalized = normalizeSlashes(content);
  return EE_PATH_MARKERS.some((m) => normalized.includes(m));
}

function main() {
  if (!fs.existsSync(AP_ROOT)) {
    console.error(`activepieces folder not found at ${AP_ROOT}`);
    process.exit(2);
  }

  const files = [];
  walk(AP_ROOT, files);

  const violations = [];

  for (const f of files) {
    if (!shouldScan(f)) continue;
    if (isSubpathOfAny(f, ALLOWLIST_DIR_PREFIXES)) continue;
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (!fileContainsEeImport(content)) continue;

    // Narrow false positives: only flag if the file appears to reference an EE path in an import/require.
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const n = normalizeSlashes(line);
      const isImportLine =
        /\bimport\b/.test(line) ||
        /\brequire\(/.test(line) ||
        /\bfrom\b/.test(line);
      if (!isImportLine) continue;
      if (EE_PATH_MARKERS.some((m) => n.includes(m))) {
        hits.push({ line: i + 1, text: line.trim().slice(0, 220) });
      }
    }
    if (hits.length) {
      violations.push({ file: path.relative(REPO_ROOT, f), hits });
    }
  }

  if (violations.length) {
    console.error('EE import violations found (MIT code importing EE paths):');
    for (const v of violations) {
      console.error(`- ${v.file}`);
      for (const h of v.hits) {
        console.error(`  - L${h.line}: ${h.text}`);
      }
    }
    process.exit(1);
  }

  console.log('OK: no EE imports detected in MIT code.');
}

main();

