#!/usr/bin/env node

const baseUrl = (process.env.PMOS_URL || "https://os.wickedlab.io").replace(/\/+$/, "");
const token = (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.PMOS_GATEWAY_TOKEN || "").trim();
const projectId = (process.env.ACTIVEPIECES_PROJECT_ID || "").trim();

if (!token) {
  console.error("Missing OPENCLAW_GATEWAY_TOKEN (or PMOS_GATEWAY_TOKEN).");
  process.exit(1);
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => "");
  return { res, text };
}

async function assertGetOk(path) {
  const url = `${baseUrl}${path}`;
  const { res, text } = await fetchText(url);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return text;
}

async function assertTool(tool, args = {}) {
  const url = `${baseUrl}/tools/invoke`;
  const { res, text } = await fetchText(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool,
      args,
      sessionKey: "smoke-main",
    }),
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // no-op
  }
  if (!res.ok || !json?.ok) {
    throw new Error(`Tool ${tool} failed: ${res.status} ${text}`);
  }
  return json;
}

function assertContains(html, needle, label) {
  if (!html.includes(needle)) {
    throw new Error(`Missing UI marker (${label}): ${needle}`);
  }
}

async function main() {
  console.log(`PMOS smoke target: ${baseUrl}`);
  const rootHtml = await assertGetOk("/");
  await assertGetOk("/api/health");

  assertContains(rootHtml, "PMOS", "brand");
  assertContains(rootHtml, "Command Center", "phase6");
  assertContains(rootHtml, "Admin", "phase4");
  assertContains(rootHtml, "AI Flow Builder", "phase5");

  if (projectId) {
    await assertTool("flow_flows_list", { projectId, limit: 5 });
    await assertTool("flow_flow_runs_list", { projectId, limit: 5 });
  } else {
    console.warn("ACTIVEPIECES_PROJECT_ID not provided; skipping flow list tool smoke.");
  }

  console.log("PMOS smoke checks passed.");
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
