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

async function goToProjectsTab(page: Page): Promise<boolean> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  // Navigate to Projects nav item
  const projectsNav = page.locator(".nav-item:has-text('Projects'), nav a:has-text('Projects'), [data-nav='projects']");
  if (await projectsNav.count() > 0) {
    await projectsNav.first().click();
  }

  // Wait for the command center to render
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  // Click the "Projects" tab in the dashboard tab strip (not Overview)
  const projectsTabBtn = page.locator(".dashboard-tab-btn:has-text('Projects')");
  if (await projectsTabBtn.count() > 0) {
    await projectsTabBtn.first().click();
    await page.waitForTimeout(500);
  }

  // Wait for either project cards or "no projects" indicator
  const cards = page.locator("article.project-card");
  const noProjects = page.locator("text=No projects, text=disconnected, text=not configured").first();
  await Promise.race([
    cards.first().waitFor({ state: "visible", timeout: 15_000 }),
    noProjects.waitFor({ state: "visible", timeout: 15_000 }),
  ]).catch(() => null);

  return (await cards.count()) > 0;
}

async function openFirstProject(page: Page): Promise<string | null> {
  const cards = page.locator("article.project-card");
  if (await cards.count() === 0) return null;
  const card = cards.first();
  const projectName = await card.locator(".project-card__title").first().innerText().catch(() => "");
  // Click the Explore button
  const exploreBtn = card.locator("button:has-text('Explore')");
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
  });

  test("project cards load and display", async ({ page }) => {
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) {
      test.skip(true, "No projects loaded — Basecamp not connected for this test account.");
      return;
    }
    const cards = page.locator("article.project-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking Explore opens project detail view", async ({ page }) => {
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) { test.skip(true, "No projects."); return; }
    const projectName = await openFirstProject(page);
    if (!projectName) { test.skip(true, "No project cards found."); return; }
    // Detail view should be visible (has project detail tabs)
    const detail = page.locator(".project-detail");
    await detail.waitFor({ state: "visible", timeout: 10_000 });
    expect(await detail.count()).toBeGreaterThan(0);
  });

  test("todos tab auto-loads without clicking Load button", async ({ page }) => {
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) { test.skip(true, "No projects."); return; }
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
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) { test.skip(true, "No projects."); return; }
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
    test.setTimeout(120_000);
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) { test.skip(true, "No projects."); return; }
    const projectName = await openFirstProject(page);
    if (!projectName) { test.skip(true, "No project cards found."); return; }

    // Click Todos tab to get a section with Ask AI
    const todosTab = page.locator(".agent-tab:has-text('Todos')");
    await todosTab.waitFor({ state: "visible", timeout: 10_000 });
    await todosTab.click();

    // Wait for data to load (spinner disappears)
    await page.locator(".progress-bar__fill--indeterminate").waitFor({ state: "detached", timeout: 50_000 }).catch(() => null);

    // Ask AI button should now be in the loaded section
    const askAiBtn = page.locator(".project-section-content button:has-text('Ask AI')");
    await askAiBtn.waitFor({ state: "visible", timeout: 10_000 });
    await askAiBtn.click();
    await page.waitForTimeout(500);

    // The chat input (contenteditable div used as textarea in Lit) should have the draft
    const chatText = await page.evaluate(() => {
      // Try all contenteditable elements, pick the one that has content
      const edits = Array.from(document.querySelectorAll("[contenteditable='true']"));
      for (const el of edits) {
        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length > 5) return text;
      }
      // Fallback: textarea
      const textareas = Array.from(document.querySelectorAll("textarea"));
      for (const el of textareas) {
        if (el.value.trim().length > 5) return el.value.trim();
      }
      return "";
    });

    expect(chatText.toLowerCase()).toContain(projectName.toLowerCase().slice(0, 8));
  });

  test("chat.send screenContext is not rejected by server", async ({ page }) => {
    const hasProjects = await goToProjectsTab(page);
    if (!hasProjects) { test.skip(true, "No projects."); return; }
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
