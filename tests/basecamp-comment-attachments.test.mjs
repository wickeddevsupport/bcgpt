import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommentContentWithAttachments,
  normalizeCommentAttachmentSpecs,
} from "../mcp/comment-attachments.js";

test("normalizes create_comment attachment aliases and data URLs", () => {
  const specs = normalizeCommentAttachmentSpecs({
    attachments: [
      {
        name: "proof.png",
        data_url: "data:image/png;base64,QUJDRA==",
      },
    ],
    body: {
      images: [
        {
          attachable_sgid: "sgid-123",
        },
      ],
      files: [
        {
          filename: "brief.pdf",
          content_type: "application/pdf",
          content_base64: "UEZERGF0YQ==",
        },
      ],
    },
  });

  assert.deepEqual(specs, [
    {
      name: "proof.png",
      content_type: "image/png",
      content_base64: "QUJDRA==",
    },
    {
      attachable_sgid: "sgid-123",
      name: undefined,
      content_type: undefined,
    },
    {
      name: "brief.pdf",
      content_type: "application/pdf",
      content_base64: "UEZERGF0YQ==",
    },
  ]);
});

test("renders Basecamp rich text with inline attachment tags", () => {
  const content = buildCommentContentWithAttachments("Please review these.", [
    { attachable_sgid: "sgid-1" },
    { sgid: "sgid-2" },
  ]);

  assert.equal(
    content,
    'Please review these.\n\n<bc-attachment sgid="sgid-1"></bc-attachment>\n\n<bc-attachment sgid="sgid-2"></bc-attachment>'
  );
});

test("rejects malformed attachment payloads early", () => {
  assert.throws(
    () => normalizeCommentAttachmentSpecs({
      attachments: [{ name: "missing-content.png", content_type: "image/png" }],
    }),
    /attachments\[0\].*attachable_sgid or name\/content_type\/content_base64/i
  );
});
