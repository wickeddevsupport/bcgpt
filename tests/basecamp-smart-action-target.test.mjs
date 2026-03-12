import test from "node:test";
import assert from "node:assert/strict";

import { extractSmartActionBasecampTarget } from "../smart-action-basecamp-target.js";

test("extracts exact Basecamp target details from pasted card URL", () => {
  const target = extractSmartActionBasecampTarget(
    "Review this card: https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048"
  );

  assert.deepEqual(target, {
    url: "https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048",
    accountId: 5282924,
    bucketId: 45864540,
    cardId: 9515058775,
    recordingId: 9654404048,
    commentId: 9654404048,
    cardPath: "/buckets/45864540/card_tables/cards/9515058775",
    hasExactCardTarget: true,
    hasExactResource: true,
  });
});

test("prefers explicit PMOS resource hints when they are present", () => {
  const target = extractSmartActionBasecampTarget(`
Review the Basecamp card at https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048.
Basecamp account_id: 5282924
Basecamp bucket_id: 45864540
Basecamp card_id: 9515058775
Basecamp recording_id: 9654404048
Exact Basecamp card path: /buckets/45864540/card_tables/cards/9515058775
  `);

  assert.equal(target.accountId, 5282924);
  assert.equal(target.bucketId, 45864540);
  assert.equal(target.cardId, 9515058775);
  assert.equal(target.recordingId, 9654404048);
  assert.equal(target.commentId, 9654404048);
  assert.equal(target.cardPath, "/buckets/45864540/card_tables/cards/9515058775");
  assert.equal(target.hasExactCardTarget, true);
  assert.equal(target.hasExactResource, true);
});

test("returns no exact target for non-Basecamp text", () => {
  const target = extractSmartActionBasecampTarget("Summarize my projects and blockers.");

  assert.equal(target.url, null);
  assert.equal(target.accountId, null);
  assert.equal(target.bucketId, null);
  assert.equal(target.cardId, null);
  assert.equal(target.recordingId, null);
  assert.equal(target.commentId, null);
  assert.equal(target.cardPath, null);
  assert.equal(target.hasExactCardTarget, false);
  assert.equal(target.hasExactResource, false);
});
