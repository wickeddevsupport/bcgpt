function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    content_type: match[1] || "application/octet-stream",
    content_base64: match[2],
  };
}

function normalizeCommentAttachmentSpec(spec, index) {
  if (typeof spec === "string") {
    const attachableSgid = spec.trim();
    if (!attachableSgid) {
      throw new Error(`attachments[${index}] must not be empty.`);
    }
    return { attachable_sgid: attachableSgid };
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`attachments[${index}] must be an object or attachable_sgid string.`);
  }

  const attachableSgid = firstString(spec.attachable_sgid, spec.attachableSgid, spec.sgid);
  const name = firstString(spec.name, spec.filename, spec.file_name, spec.fileName, spec.title);
  const dataUrl = firstString(spec.data_url, spec.dataUrl, spec.data);
  const parsedDataUrl = parseDataUrl(dataUrl);
  const contentType = firstString(
    spec.content_type,
    spec.contentType,
    spec.mime_type,
    spec.mimeType,
    parsedDataUrl?.content_type
  );
  const contentBase64 = firstString(
    spec.content_base64,
    spec.contentBase64,
    spec.base64,
    parsedDataUrl?.content_base64
  );

  if (attachableSgid) {
    return {
      attachable_sgid: attachableSgid,
      name,
      content_type: contentType,
    };
  }

  if (!name || !contentType || !contentBase64) {
    throw new Error(
      `attachments[${index}] must include attachable_sgid or name/content_type/content_base64.`
    );
  }

  return {
    name,
    content_type: contentType,
    content_base64: contentBase64,
  };
}

export function normalizeCommentAttachmentSpecs(args = {}) {
  const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)) ? args.body : {};
  const rawSpecs = [
    ...asArray(args.attachments),
    ...asArray(body.attachments),
    ...asArray(args.images),
    ...asArray(body.images),
    ...asArray(args.files),
    ...asArray(body.files),
  ];

  return rawSpecs.map((spec, index) => normalizeCommentAttachmentSpec(spec, index));
}

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildCommentContentWithAttachments(content, attachments = []) {
  const parts = [];
  const text = typeof content === "string" ? content.trim() : "";
  if (text) parts.push(content);

  for (const attachment of attachments) {
    const sgid = firstString(attachment?.attachable_sgid, attachment?.attachableSgid, attachment?.sgid);
    if (!sgid) continue;
    parts.push(`<bc-attachment sgid="${escapeHtmlAttr(sgid)}"></bc-attachment>`);
  }

  return parts.join("\n\n");
}
