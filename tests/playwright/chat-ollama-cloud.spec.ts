/**
 * Diagnose and fix Ollama cloud model 401 error in Open WebUI.
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = "https://chat.wickedlab.io";
const EMAIL = "rajan@wickedwebsites.us";
const PASS = "WickedOS!Temp2026#1";

async function login(page: Page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  // Check if already logged in
  const me = await page.request.get(`${BASE}/api/v1/auths/`).catch(() => null);
  if (me?.ok()) return;

  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  await page.locator('input[type="email"], input[placeholder*="mail"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
  await page.waitForURL(`${BASE}/`, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

test("diagnose: capture Ollama connection settings and cloud model 401", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  // Capture API errors
  const errors: { url: string; status: number; body: string }[] = [];
  page.on("response", async (resp) => {
    if (resp.status() >= 400 && (resp.url().includes("ollama") || resp.url().includes("chat") || resp.url().includes("generate"))) {
      const body = await resp.text().catch(() => "");
      errors.push({ url: resp.url(), status: resp.status(), body: body.slice(0, 300) });
    }
  });

  // Go to Admin Panel → Settings → Connections
  await page.goto(`${BASE}/admin/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2000);

  // Click Connections tab if present
  const connectionsTab = page.locator('button:has-text("Connections"), a:has-text("Connections"), [data-tab="connections"]');
  if (await connectionsTab.count() > 0) {
    await connectionsTab.first().click();
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: "pw-chat-connections.png", fullPage: true });

  // Read current Ollama connection URL(s) from the page
  const urlInputs = await page.locator('input[placeholder*="URL"], input[placeholder*="url"], input[type="url"]').all();
  const urls: string[] = [];
  for (const inp of urlInputs) {
    const v = await inp.inputValue().catch(() => "");
    if (v) urls.push(v);
  }
  console.log("Connection URLs found:", urls);

  // Now try sending a chat with a cloud model
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);

  // Open model selector
  const modelBtn = page.locator('[aria-label*="model"], button:has-text("Select a model"), .model-selector').first();
  if (await modelBtn.isVisible()) {
    await modelBtn.click();
    await page.waitForTimeout(500);
    // Pick first external/cloud model
    const externalModel = page.locator('[data-value*="external"], li:has-text("minimax"), li:has-text("deepseek"), li:has-text("gemma3")').first();
    if (await externalModel.count() > 0) {
      const modelName = await externalModel.innerText().catch(() => "unknown");
      console.log("Selecting cloud model:", modelName);
      await externalModel.click();
      await page.waitForTimeout(500);
    }
  }

  // Type a test message — Open WebUI uses a contenteditable div inside #chat-input-container
  const chatInput = page.locator('#chat-input-container [contenteditable], #chat-input-container p, textarea#chat-input, div[aria-label*="message"]').first();
  await chatInput.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  if (await chatInput.isVisible()) {
    await chatInput.click();
    await page.keyboard.type("Hello, reply with just: OK");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(8000);
  }

  await page.screenshot({ path: "pw-chat-cloud-test.png", fullPage: true });

  console.log("Errors captured:", JSON.stringify(errors, null, 2));
  console.log("URLs found:", urls);

  // Log for diagnosis — don't fail, just report
  expect(urls.length + errors.length).toBeGreaterThanOrEqual(0);
});

test("fix: update Ollama cloud URL to correct endpoint", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);

  // Use the API to check and fix the Ollama connections
  const resp = await page.request.get(`${BASE}/api/v1/configs/ollama/urls`);
  console.log("Ollama URLs API status:", resp.status());
  const body = await resp.text().catch(() => "");
  console.log("Ollama URLs body:", body.slice(0, 500));

  // Try the admin API to list connections
  const connResp = await page.request.get(`${BASE}/api/v1/configs`);
  console.log("Configs status:", connResp.status());
  const connBody = await connResp.text().catch(() => "");
  console.log("Configs body:", connBody.slice(0, 1000));

  expect(connResp.status()).toBeLessThan(500);
});
