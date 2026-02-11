import express from "express";
import fetch from "node-fetch";
import {
  getApp,
  getAppBySlug,
  listApps,
  createApp,
  updateApp,
  deleteApp,
  recordExecution,
  getExecutions,
  addReview,
  getReviews,
  addFavorite,
  removeFavorite,
  getFavorites,
} from "../db.js";

const router = express.Router();

// Helper: Generate URL-friendly slug
function makeSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============ PUBLIC ROUTES ============

/**
 * GET /apps
 * Render the gallery page (HTML)
 */
router.get("/", async (req, res) => {
  try {
    const apps = await listApps({ status: "published", limit: 100 });
    const categories = [
      "AI & Creative",
      "Productivity",
      "Business",
      "Utilities",
      "Data",
      "Marketing",
      "Developer Tools",
    ];

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow App Store</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      background: rgba(255,255,255,0.95);
      padding: 30px 20px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    header h1 {
      font-size: 32px;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    header p { color: #666; margin-bottom: 20px; }
    .controls {
      display: flex;
      gap: 10px;
      margin-top: 15px;
      flex-wrap: wrap;
    }
    .search-box, .category-select {
      padding: 10px 15px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      flex: 1;
      min-width: 200px;
    }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .app-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: pointer;
      display: flex;
      flex-direction: column;
    }
    .app-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0,0,0,0.15);
    }
    .app-icon {
      width: 100%;
      height: 120px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: white;
    }
    .app-header {
      padding: 15px;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
    }
    .app-name {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 5px;
      color: #333;
    }
    .app-category {
      font-size: 12px;
      color: #999;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .app-description {
      font-size: 13px;
      color: #666;
      margin-bottom: 12px;
      flex-grow: 1;
    }
    .app-stats {
      display: flex;
      gap: 10px;
      font-size: 12px;
      color: #999;
      margin-bottom: 12px;
    }
    .app-footer {
      padding: 12px 15px;
      border-top: 1px solid #eee;
    }
    .open-btn {
      width: 100%;
      padding: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .open-btn:hover { opacity: 0.9; }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: white;
    }
    .empty-state h2 { font-size: 28px; margin-bottom: 10px; }
    .empty-state p { font-size: 16px; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 Flow App Store</h1>
      <p>Discover and use powerful workflow automation apps</p>
      <div class="controls">
        <input type="text" class="search-box" id="searchBox" placeholder="Search apps...">
        <select class="category-select" id="categorySelect">
          <option value="">All Categories</option>
          ${categories.map((cat) => `<option value="${cat}">${cat}</option>`).join("")}
        </select>
      </div>
    </header>

    <div id="appsContainer" class="gallery">
      ${
        apps.length === 0
          ? `
        <div class="empty-state" style="grid-column: 1/-1;">
          <h2>No apps yet</h2>
          <p>Check back soon for amazing workflow automation apps!</p>
        </div>
      `
          : apps
              .map(
                (app) => `
        <div class="app-card" onclick="openApp('${app.slug}')">
          <div class="app-icon">${getEmojiForCategory(app.category)}</div>
          <div class="app-header">
            <div class="app-name">${escapeHtml(app.name)}</div>
            <div class="app-category">${app.category || "Uncategorized"}</div>
            <div class="app-description">${escapeHtml(app.description || "No description")}</div>
            <div class="app-stats">
              <span>⭐ ${(app.rating || 0).toFixed(1)}</span>
              <span>📊 ${app.usage_count || 0} uses</span>
            </div>
          </div>
          <div class="app-footer">
            <button class="open-btn" onclick="event.stopPropagation(); openApp('${app.slug}')">Open App</button>
          </div>
        </div>
      `
              )
              .join("")
      }
    </div>
  </div>

  <script>
    function getEmojiForCategory(cat) {
      const map = {
        "AI & Creative": "🎨",
        "Productivity": "📈",
        "Business": "💼",
        "Utilities": "🔧",
        "Data": "📊",
        "Marketing": "📢",
        "Developer Tools": "⚙️",
      };
      return map[cat] || "⚡";
    }

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    function openApp(slug) {
      window.location.href = "/apps/" + slug;
    }

    // Simple search/filter
    document.getElementById("searchBox").addEventListener("input", filterApps);
    document.getElementById("categorySelect").addEventListener("change", filterApps);

    function filterApps() {
      location.reload(); // In production, implement client-side filtering
    }
  </script>
</body>
</html>
    `;
    res.send(html);
  } catch (err) {
    console.error("[APP_STORE] Gallery error:", err);
    res.status(500).json({ error: "Failed to load gallery" });
  }
});

/**
 * GET /api/apps
 * List published apps as JSON
 */
router.get("/api/apps", async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;
    const apps = await listApps({
      status: "published",
      category: category || null,
      limit: Math.min(Number(limit) || 50, 100),
      offset: Number(offset) || 0,
    });
    res.json({
      data: apps,
      count: apps.length,
    });
  } catch (err) {
    console.error("[APP_STORE] List apps error:", err);
    res.status(500).json({ error: "Failed to list apps" });
  }
});

/**
 * GET /apps/:slug
 * Render app runtime page for user interaction
 */
router.get("/:slug", async (req, res) => {
  try {
    const app = await getAppBySlug(req.params.slug);
    if (!app) return res.status(404).send("App not found");

    const inputSchema = Array.isArray(app.input_schema) ? app.input_schema : [];

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(app.name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 600px; margin: 0 auto; }
    .header {
      background: white;
      padding: 30px;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header h1 {
      font-size: 28px;
      color: #333;
      margin-bottom: 10px;
    }
    .header p { color: #666; font-size: 14px; }
    .content {
      background: white;
      padding: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
      font-size: 14px;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
    }
    textarea {
      min-height: 100px;
      resize: vertical;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .run-btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .run-btn:hover { opacity: 0.9; }
    .run-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .output-section {
      background: white;
      padding: 30px;
      border-radius: 0 0 12px 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      min-height: 100px;
      display: none;
    }
    .output-section.visible { display: block; }
    .output-section h3 {
      margin-bottom: 15px;
      color: #333;
      font-size: 16px;
    }
    .loading {
      text-align: center;
      color: #667eea;
      font-size: 14px;
    }
    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid rgba(102, 126, 234, 0.3);
      border-radius: 50%;
      border-top-color: #667eea;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 6px;
      margin-top: 10px;
      font-size: 14px;
    }
    .success {
      background: #efe;
      color: #3c3;
      padding: 12px;
      border-radius: 6px;
      margin-top: 10px;
      font-size: 14px;
    }
    .output-content {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 6px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 13px;
    }
    .output-image {
      max-width: 100%;
      max-height: 400px;
      margin-top: 15px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(app.name)}</h1>
      <p>${escapeHtml(app.description || "")}</p>
    </div>

    <div class="content">
      <form id="appForm">
        ${inputSchema
          .map(
            (field, idx) => `
          <div class="form-group">
            <label for="input_${idx}">${escapeHtml(field.label || field.name)}</label>
            ${
              field.type === "textarea"
                ? `<textarea id="input_${idx}" name="${field.name}" ${field.required ? "required" : ""} placeholder="${escapeHtml(
                    field.placeholder || ""
                  )}"></textarea>`
                : field.type === "select"
                ? `<select id="input_${idx}" name="${field.name}" ${field.required ? "required" : ""}>
                  <option value="">Choose an option...</option>
                  ${(field.options || []).map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("")}
                </select>`
                : `<input type="${field.type === "number" ? "number" : "text"}" id="input_${idx}" name="${field.name}" ${field.required ? "required" : ""} placeholder="${escapeHtml(field.placeholder || "")}"/>`
            }
          </div>
        `
          )
          .join("")}

        <button type="submit" class="run-btn" id="runBtn">Run App</button>
      </form>
    </div>

    <div class="output-section" id="outputSection">
      <h3>Result</h3>
      <div id="outputContent"></div>
    </div>
  </div>

  <script>
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    document.getElementById("appForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(document.getElementById("appForm"));
      const input = Object.fromEntries(formData);

      const runBtn = document.getElementById("runBtn");
      const outputSection = document.getElementById("outputSection");
      const outputContent = document.getElementById("outputContent");

      runBtn.disabled = true;
      outputContent.innerHTML = '<div class="loading"><span class="spinner"></span>Running...</div>';
      outputSection.classList.add("visible");

      try {
        const response = await fetch("/apps/api/${app.id}/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        const result = await response.json();

        if (response.ok) {
          const content = formatOutput(result.output, "${app.output_type}");
          outputContent.innerHTML = \`<div class="success">✓ Success</div>\` + content;
        } else {
          outputContent.innerHTML = \`<div class="error">✗ Error: \${escapeHtml(result.error || "Unknown error")}</div>\`;
        }
      } catch (err) {
        outputContent.innerHTML = \`<div class="error">✗ Error: \${escapeHtml(err.message)}</div>\`;
      } finally {
        runBtn.disabled = false;
      }
    });

    function formatOutput(data, type) {
      if (type === "image" && typeof data === "string") {
        return \`<img src="\${escapeHtml(data)}" class="output-image" />\`;
      }
      if (type === "json") {
        return \`<pre class="output-content">\${escapeHtml(JSON.stringify(data, null, 2))}</pre>\`;
      }
      return \`<div class="output-content">\${escapeHtml(String(data))}</div>\`;
    }
  </script>
</body>
</html>
    `;
    res.send(html);
  } catch (err) {
    console.error("[APP_STORE] App runtime error:", err);
    res.status(500).json({ error: "Failed to load app" });
  }
});

/**
 * POST /api/apps/:id/execute
 * Execute the app workflow
 */
router.post("/api/:id/execute", async (req, res) => {
  const startTime = Date.now();
  try {
    const app = await getApp(req.params.id);
    if (!app) return res.status(404).json({ error: "App not found" });

    const input = req.body || {};

    // Call the Activepieces webhook
    const webhookUrl = `${process.env.APP_BASE_URL || "http://localhost:10000"}/webhooks/${app.flow_id}/sync`;

    let output;
    let status = "success";
    let errorMessage = null;

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeout: 35000, // 35s timeout (flow has 30s limit)
      });

      const data = await response.json();

      if (response.ok) {
        output = data.body || data;
      } else {
        status = "error";
        errorMessage = data.error || "Flow execution failed";
        output = null;
      }
    } catch (err) {
      status = "error";
      errorMessage = err.message;
      output = null;
    }

    const executionTime = Date.now() - startTime;

    // Record execution
    try {
      await recordExecution(app.id, {
        user_id: null,
        input_data: input,
        output_data: output,
        status,
        execution_time_ms: executionTime,
        error_message: errorMessage,
      });
    } catch (err) {
      console.error("[APP_STORE] Failed to record execution:", err);
    }

    if (status === "error") {
      return res.status(400).json({ error: errorMessage });
    }

    res.json({ output });
  } catch (err) {
    console.error("[APP_STORE] Execute error:", err);
    res.status(500).json({ error: "Execution failed" });
  }
});

// ============ API ROUTES (JSON) ============

/**
 * GET /api/categories
 * List all categories
 */
router.get("/api/categories", (req, res) => {
  const categories = [
    "AI & Creative",
    "Productivity",
    "Business",
    "Utilities",
    "Data",
    "Marketing",
    "Developer Tools",
  ];
  res.json({ categories });
});

function getEmojiForCategory(cat) {
  const map = {
    "AI & Creative": "🎨",
    Productivity: "📈",
    Business: "💼",
    Utilities: "🔧",
    Data: "📊",
    Marketing: "📢",
    "Developer Tools": "⚙️",
  };
  return map[cat] || "⚡";
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default router;
