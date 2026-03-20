import test from "node:test";
import assert from "node:assert/strict";

import { routeToolCall, shouldRoute } from "../gateway-router.js";

test("routes only PMOS remote workflow tools", async () => {
  assert.equal(shouldRoute("pmos_ops_list_workflows"), true);
  assert.equal(shouldRoute("pmos_n8n_create_workflow"), true);
  assert.equal(shouldRoute("pmos_web_search"), true);

  assert.equal(shouldRoute("pmos_workspace_sync"), false);
  assert.equal(shouldRoute("pmos_project_sync"), false);
  assert.equal(shouldRoute("pmos_entity_detail"), false);
  assert.equal(shouldRoute("list_projects"), false);
});

test("returns null for local PMOS Basecamp tools", async () => {
  const result = await routeToolCall("pmos_entity_detail", { id: 123 }, {});
  assert.equal(result, null);
});
