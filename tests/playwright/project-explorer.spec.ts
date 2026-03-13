/**
 * Browser tests for PMOS Project Explorer — tabs auto-load, render real data,
 * screenContext is injected into chat, and Ask AI prompts are context-aware.
 *
 * Required env vars:
 *   PMOS_TEST_EMAIL
 *   PMOS_TEST_PASSWORD
 */

import { expect, test, type Page } from "@playwright/test";

function env(name: string): string | null {
  return process.env[name]?.trim().replace(/\\!/g, "!") || null;
}

async function ensureLogin(page: Page): Promise<void> {
  const email = env("PMOS_TEST_EMAIL");
  const password = env("PMOS_TEST_PASSWORD");
  test.skip(!email || !password, "Set PMOS_TEST_EMAIL and PMOS_TEST_PASSWORD to run.");

  const me = await page.request.get("/api/pmos/auth/me").catch(() => null);
  const alreadyAuth =
    me?.ok() &&
    ((await me.json().catch(() => null)) as { authenticated?: boolean } | null)?.authenticated === true;
  if (alreadyAuth) return;

  const loginResp = await page.request.post("/api/pmos/auth/login", {
    data: { email, password },
  });
  if (!loginResp.ok()) {
    await page.request.post("/api/pmos/auth/signup", { data: { name: "Test User", email, password } });
    const retry = await page.request.post("/api/pmos/auth/login", { data: { email, password } });
    expect(retry.ok(), `Login failed: ${retry.status()}`).toBe(true);
  }
}

async function goToProjectExplorer(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Navigate to Command Center
  const ccLink = page.locator("nav a[href='/command-center'], [data-nav='command-center'], .nav-item:has-text('Command')");
  if (await ccLink.count() > 0) {
    await ccLink.first().click();
  } else {
    await page.goto("/command-center", { waitUntil: "domcontentloaded" });
  }
}

async function getFirstProjectCard(page: Page): Promise<ReturnType<Page["locator"]> | null> {
  const cards = page.locator(".project-card, .pmos-project-card, [data-testid='project-card']");
  await cards.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => null);
  if (await cards.count() === 0) return null;
  return cards.first();
}

async function openFirstProject(page: Page): Promise<string | null> {
  const card = await getFirstProjectCard(page);
  if (!card) return null;
  const projectName = await card.locator(".project-card__name, .card-title, h3, h4").first().innerText().catch(() => "");
  // Click the Explore button
  const exploreBtn = card.locator("button:has-text('Explore'), a:has-text('Explore')");
  if (await exploreBtn.count() > 0) {
    await exploreBtn.first().click();
  } else {
    await card.click();
  }
  return projectName.trim();
}

test.describe("Project Explorer", () => {
  test.beforeEach(async ({ page }) => {
    await ensureLogin(page);
    await goToProjectExplorer(page);
  });

  test("project cards load and display", async ({ page }) => {
    const cards = page.locator(".project-card, .pmos-project-card, [data-testid='project-card']");
    await cards.first().waitFor({ state: "visible", timeout: 20_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking Explore opens project detail view", async ({ page }) => {
    const projectName = await openFirstProject(page);
    if (!projectName) {
      test.skip(true, "No project cards found — Basecamp not connected or no projects.");
      return;
    }
    // Detail view should be visible
    const detail = page.locator(".project-detail, [data-testid='project-detail']");
    await detail.waitFor({ state: "visible", timeout: 10_000 });
    expect(await detail.count()).toBeGreaterThan(0);
  });

  test("todos tab auto-loads without clicking Load button", async ({ page }) => {
    const projectName = await openFirstProject(page);
    if (!projectName) {
      test.skip(true, "No project cards found.");
      return;
    }
    // Click todos tab
    const todosTab = page.locator(".agent-tab:has-text('Todos'), [data-tab='todos']");
    await todosTab.waitFor({ state: "visible", timeout: 10_000 });
    await todosTab.click();

    // Should auto-load (show spinner then content -- never show "Not yet loaded" requiring a click)
    const notLoadedMsg = page.locator("text=Not yet loaded");
    // Give it a moment to trigger auto-load
    await page.waitForTimeout(500);
    // The "Not yet loaded" state should not persist — either loading or data
    const hasNotLoaded = await notLoadedMsg.isVisible().catch(() => false);
    expect(hasNotLoaded, "Todos tab should auto-load, not require manual click").toBe(false);

    // Eventually content should appear (progress bar gone, actual data)
    await page.locator(".progress-bar__fill--indeterminate").waitFor({ state: "detached", timeout: 45_000 }).catch(() => null);
    // Should show section list (even empty is fine, but no raw JSON pre)
    const rawJson = page.locator(".project-section-pre");
    const hasRawJson = await rawJson.isVisible().catch(() => false);
    expect(hasRawJson, "Todos tab should render UI, not raw JSON").toBe(false);
  });

  test("people tab uses list_people (no timeout / abort)", async ({ page }) => {
    const projectName = await openFirstProject(page);
    if (!projectName) {
      test.skip(true, "No project cards found.");
      return;
    }
    // Click people tab
    const peopleTab = page.locator(".agent-tab:has-text('People'), [data-tab='people']");
    await peopleTab.waitFor({ state: "visible", timeout: 10_000 });
    await peopleTab.click();

    // Wait for load to complete (up to 40s — list_people is fast, no AI loop)
    await page.locator(".progress-bar__fill--indeterminate").waitFor({ state: "detached", timeout: 40_000 }).catch(() => null);

    // Should NOT show "operation was aborted"
    const abortedMsg = page.locator("text=operation was aborted");
    const hasAborted = await abortedMsg.isVisible().catch(() => false);
    expect(hasAborted, "People tab should not abort — uses list_people now").toBe(false);

    // Should show either people list or a clean "No people found" (not raw JSON)
    const rawJson = page.locator(".project-section-pre");
    const hasRawJson = await rawJson.isVisible().catch(() => false);
    expect(hasRawJson, "People tab should render UI, not raw JSON").toBe(false);
  });

  test("Ask AI button pre-fills context-aware prompt", async ({ page }) => {
    const projectName = await openFirstProject(page);
    if (!projectName) {
      test.skip(true, "No project cards found.");
      return;
    }
    // Wait for todos tab to load
    const todosTab = page.locator(".agent-tab:has-text('Todos'), [data-tab='todos']");
    await todosTab.waitFor({ state: "visible", timeout: 10_000 });
    await todosTab.click();
    await page.locator(".progress-bar__fill--indeterminate").waitFor({ state: "detached", timeout: 45_000 }).catch(() => null);

    // Click Ask AI
    const askAiBtn = page.locator("button:has-text('Ask AI')").first();
    await askAiBtn.waitFor({ state: "visible", timeout: 5_000 });
    await askAiBtn.click();

    // Chat input should be pre-filled with project name
    const chatInput = page.locator(".chat-input, textarea[placeholder*='message'], [contenteditable='true']").first();
    await chatInput.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
    const inputValue = await chatInput.inputValue().catch(() => chatInput.innerText().catch(() => ""));
    expect(inputValue.toLowerCase()).toContain(projectName.toLowerCase().slice(0, 10));
  });

  test("chat.send screenContext is not rejected by server", async ({ page }) => {
    const projectName = await openFirstProject(page);
    if (!projectName) {
      test.skip(true, "No project cards found.");
      return;
    }

    // Listen for any error responses about screenContext
    const errors: string[] = [];
    page.on("websocket", (ws) => {
      ws.on("framesent", () => null);
      ws.on("framereceived", (frame) => {
        const text = typeof frame.payload === "string" ? frame.payload : "";
        if (text.includes("screenContext") && text.includes("unexpected property")) {
          errors.push(text);
        }
      });
    });

    // Also watch console errors
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("screenContext")) {
        errors.push(msg.text());
      }
    });

    // Wait for overview to show then try sending a quick message
    const chatInput = page.locator(".chat-input, textarea[placeholder*='message'], [contenteditable='true']").first();
    await chatInput.waitFor({ state: "visible", timeout: 10_000 }).catch(() => null);

    if (await chatInput.isVisible()) {
      await chatInput.click();
      await chatInput.fill("What project am I looking at?");
      await page.keyboard.press("Enter");
      // Give it 3 seconds for any error to surface
      await page.waitForTimeout(3_000);
    }

    expect(errors, "No screenContext validation errors should occur").toHaveLength(0);
  });
});
