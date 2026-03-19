import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBasecampRequestPath } from "../mcp/basecamp-request.js";

test("normalizeBasecampRequestPath normalizes relative Basecamp endpoints", () => {
  assert.equal(
    normalizeBasecampRequestPath("/buckets/123/todolists", {
      query: { status: "active", page: 2 },
    }),
    "/buckets/123/todolists.json?status=active&page=2",
  );
});

test("normalizeBasecampRequestPath strips leading HTTP verbs", () => {
  assert.equal(
    normalizeBasecampRequestPath("GET /buckets/123/card_tables/cards/456", {
      query: "include=comments",
    }),
    "/buckets/123/card_tables/cards/456.json?include=comments",
  );
});

test("normalizeBasecampRequestPath preserves full URLs and merges query params", () => {
  assert.equal(
    normalizeBasecampRequestPath("https://3.basecampapi.com/5282924/projects.json?page=1", {
      query: { per_page: 50 },
    }),
    "https://3.basecampapi.com/5282924/projects.json?page=1&per_page=50",
  );
});
