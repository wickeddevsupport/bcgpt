import test from "node:test";
import assert from "node:assert/strict";

import { getTools } from "../mcp/tools.js";

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value == null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (previous == null) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

test("default tool catalog stays focused on common Basecamp operations", () => {
  withEnv("BCGPT_MCP_TOOL_PROFILE", undefined, () => {
    withEnv("BCGPT_EXPOSE_ENDPOINT_TOOLS", undefined, () => {
      const tools = getTools();
      const names = new Set(tools.map((tool) => tool.name));
      const smartAction = tools.find((tool) => tool.name === "smart_action");
      const projectStructure = tools.find((tool) => tool.name === "get_project_structure");
      const pmosWorkspaceSync = tools.find((tool) => tool.name === "pmos_workspace_sync");
      const pmosProjectSync = tools.find((tool) => tool.name === "pmos_project_sync");
      const pmosEntityDetail = tools.find((tool) => tool.name === "pmos_entity_detail");

      assert.ok(names.has("list_todos_due"));
      assert.ok(names.has("list_people"));
      assert.ok(names.has("list_project_people"));
      assert.ok(names.has("pmos_workspace_sync"));
      assert.ok(names.has("pmos_project_sync"));
      assert.ok(names.has("pmos_entity_detail"));
      assert.ok(!names.has("mcp_call"));
      assert.ok(!names.has("run_regression_suite"));
      assert.ok(!Array.from(names).some((name) => name.startsWith("api_get_")));
      assert.ok(smartAction);
      assert.ok(projectStructure);
      assert.ok(pmosWorkspaceSync);
      assert.ok(pmosProjectSync);
      assert.ok(pmosEntityDetail);
      assert.match(String(smartAction.description || ""), /Prefer direct tools/i);
      assert.doesNotMatch(String(smartAction.description || ""), /FIRST TOOL/i);
      assert.equal(projectStructure?.inputSchema?.properties?.include_details?.type, "boolean");
      assert.equal(projectStructure?.inputSchema?.properties?.include_disabled?.type, "boolean");
      assert.equal(pmosWorkspaceSync?.inputSchema?.properties?.include_project_details?.type, "boolean");
      assert.equal(pmosWorkspaceSync?.inputSchema?.properties?.include_project_docks?.type, "boolean");
      assert.equal(pmosWorkspaceSync?.inputSchema?.properties?.max_age_ms?.type, "integer");
      assert.equal(pmosWorkspaceSync?.inputSchema?.properties?.force_refresh?.type, "boolean");
      assert.equal(pmosWorkspaceSync?.inputSchema?.properties?.allow_stale_on_error?.type, "boolean");
      assert.equal(pmosProjectSync?.inputSchema?.properties?.project?.type, "string");
      assert.equal(pmosProjectSync?.inputSchema?.properties?.include_cards?.type, "boolean");
      assert.equal(pmosEntityDetail?.inputSchema?.properties?.include_comments?.type, "boolean");
      assert.equal(pmosEntityDetail?.inputSchema?.properties?.url?.type, "string");
    });
  });
});

test("full catalog can still expose endpoint wrappers when explicitly enabled", () => {
  withEnv("BCGPT_MCP_TOOL_PROFILE", "full", () => {
    withEnv("BCGPT_EXPOSE_ENDPOINT_TOOLS", "true", () => {
      const tools = getTools();
      const names = new Set(tools.map((tool) => tool.name));

      assert.ok(names.has("mcp_call"));
      assert.ok(names.has("run_regression_suite"));
      assert.ok(names.has("api_get_buckets_by_bucket_id_card_tables_by_card_table_id"));
    });
  });
});
