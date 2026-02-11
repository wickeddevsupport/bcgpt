#!/usr/bin/env node

/**
 * Seed default flow-gallery templates/apps through the publisher API.
 *
 * Usage:
 *   APPS_TOKEN="<jwt>" node scripts/seed-default-apps.mjs
 *   APPS_TOKEN="<jwt>" node scripts/seed-default-apps.mjs --reset
 *   APPS_TOKEN="<jwt>" APPS_BASE_URL="https://flow.wickedlab.io" node scripts/seed-default-apps.mjs
 */

const baseUrl = process.env.APPS_BASE_URL ?? 'https://flow.wickedlab.io';
const token = process.env.APPS_TOKEN;
const reset = process.argv.includes('--reset');

if (!token) {
  console.error('Missing APPS_TOKEN environment variable.');
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, '')}/apps/api/publisher/seed-defaults`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    confirm: 'SEED_DEFAULTS',
    reset,
  }),
});

const text = await response.text();
let payload = text;
try {
  payload = JSON.parse(text);
} catch {
  // keep raw text
}

if (!response.ok) {
  console.error(`Seed failed (${response.status})`, payload);
  process.exit(1);
}

console.log('Seed complete:', payload);
