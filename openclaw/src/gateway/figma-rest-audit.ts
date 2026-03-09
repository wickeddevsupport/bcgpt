function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function fileMapCount(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

type TraversalStats = {
  totalNodes: number;
  pages: number;
  frames: number;
  groups: number;
  sections: number;
  components: number;
  componentSets: number;
  instances: number;
  textNodes: number;
  autoLayoutContainers: number;
  manualLayoutCandidates: number;
  absoluteChildrenInAutoLayout: number;
  textNodesWithoutSharedStyle: number;
  mixedFontNodes: number;
  pageNames: string[];
  fontFamilies: Map<string, number>;
  fontStyles: Map<string, number>;
};

function createTraversalStats(): TraversalStats {
  return {
    totalNodes: 0,
    pages: 0,
    frames: 0,
    groups: 0,
    sections: 0,
    components: 0,
    componentSets: 0,
    instances: 0,
    textNodes: 0,
    autoLayoutContainers: 0,
    manualLayoutCandidates: 0,
    absoluteChildrenInAutoLayout: 0,
    textNodesWithoutSharedStyle: 0,
    mixedFontNodes: 0,
    pageNames: [],
    fontFamilies: new Map<string, number>(),
    fontStyles: new Map<string, number>(),
  };
}

function incrementCounter(map: Map<string, number>, key: string | null): void {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

function collectTextNodeStats(node: Record<string, unknown>, stats: TraversalStats): void {
  const styles = asRecord(node.styles);
  if (!asString(styles.text)) {
    stats.textNodesWithoutSharedStyle += 1;
  }

  const fontName = node.fontName;
  if (fontName === "MIXED") {
    stats.mixedFontNodes += 1;
    return;
  }

  const fontRecord = asRecord(fontName);
  const family = asString(fontRecord.family) ?? asString(asRecord(node.style).fontFamily);
  const style = asString(fontRecord.style);
  incrementCounter(stats.fontFamilies, family);
  incrementCounter(stats.fontStyles, family && style ? `${family} / ${style}` : style);
}

function collectNodeStats(
  node: Record<string, unknown>,
  stats: TraversalStats,
): Array<Record<string, unknown>> {
  stats.totalNodes += 1;

  const type = asString(node.type) ?? "UNKNOWN";
  const name = asString(node.name);
  const children = asArray(node.children).filter(isRecord);

  switch (type) {
    case "CANVAS":
      stats.pages += 1;
      if (name) {
        stats.pageNames.push(name);
      }
      break;
    case "FRAME":
      stats.frames += 1;
      break;
    case "GROUP":
      stats.groups += 1;
      break;
    case "SECTION":
      stats.sections += 1;
      break;
    case "COMPONENT":
      stats.components += 1;
      break;
    case "COMPONENT_SET":
      stats.componentSets += 1;
      break;
    case "INSTANCE":
      stats.instances += 1;
      break;
    case "TEXT":
      stats.textNodes += 1;
      collectTextNodeStats(node, stats);
      break;
    default:
      break;
  }

  if (type === "FRAME" || type === "COMPONENT" || type === "COMPONENT_SET" || type === "INSTANCE") {
    const childCount = children.length;
    const layoutMode = asString(node.layoutMode) ?? "NONE";
    if (layoutMode !== "NONE") {
      stats.autoLayoutContainers += 1;
      stats.absoluteChildrenInAutoLayout += children.filter(
        (child) => asString(child.layoutPositioning) === "ABSOLUTE",
      ).length;
    } else if (childCount >= 3) {
      stats.manualLayoutCandidates += 1;
    }
  }

  return children;
}

function sortedEntries(map: Map<string, number>, limit = 8): Array<{ name: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function parseFigmaFileKey(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)\b/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const plainMatch = trimmed.match(/^[a-zA-Z0-9]{10,}$/);
  return plainMatch ? plainMatch[0] : null;
}

export function buildFigmaRestAuditReport(
  payload: unknown,
  opts?: { focus?: string | null; fileKey?: string | null },
): Record<string, unknown> {
  const file = asRecord(payload);
  const document = asRecord(file.document);
  const rootChildren = asArray(document.children).filter(isRecord);
  const stats = createTraversalStats();
  const stack: Array<Record<string, unknown>> = [...rootChildren];

  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = collectNodeStats(node, stats);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }

  const styles = asRecord(file.styles);
  const styleCounts: Record<string, number> = {};
  for (const styleValue of Object.values(styles)) {
    const styleType = (asString(asRecord(styleValue).styleType) ?? "UNKNOWN").toLowerCase();
    styleCounts[styleType] = (styleCounts[styleType] ?? 0) + 1;
  }

  const focus = asString(opts?.focus) ?? "general";
  const componentsDefined = fileMapCount(file.components);
  const componentSetsDefined = fileMapCount(file.componentSets);
  const uniqueFontFamilies = stats.fontFamilies.size;
  const topFonts = sortedEntries(stats.fontFamilies, 8);
  const topFontStyles = sortedEntries(stats.fontStyles, 8);

  const issues: string[] = [];
  const suggestions: string[] = [];

  if (stats.manualLayoutCandidates > 0) {
    issues.push(
      `${stats.manualLayoutCandidates} container${stats.manualLayoutCandidates === 1 ? "" : "s"} look like manual layout candidates (3+ children without Auto Layout).`,
    );
    suggestions.push("Convert repeated stack-like groups into Auto Layout to reduce spacing drift and regression risk.");
  }
  if (stats.absoluteChildrenInAutoLayout > 0) {
    issues.push(
      `${stats.absoluteChildrenInAutoLayout} child layer${stats.absoluteChildrenInAutoLayout === 1 ? "" : "s"} are absolutely positioned inside Auto Layout containers.`,
    );
    suggestions.push("Review absolute-positioned layers inside Auto Layout; they usually become fragile during content growth.");
  }
  if (stats.textNodesWithoutSharedStyle > 0) {
    issues.push(
      `${stats.textNodesWithoutSharedStyle} text node${stats.textNodesWithoutSharedStyle === 1 ? "" : "s"} do not reference a shared text style.`,
    );
    suggestions.push("Promote repeated typography patterns into shared text styles or variables for stronger consistency.");
  }
  if (uniqueFontFamilies > 4) {
    issues.push(`${uniqueFontFamilies} distinct font families appear in the traversed file structure.`);
    suggestions.push("Rationalize the font stack; most product systems should stay within 2-4 families.");
  }
  if (componentsDefined >= 6 && componentSetsDefined === 0) {
    issues.push("The file defines multiple components but no component sets/variants were detected.");
    suggestions.push("Group related components into variants so state changes live in one place.");
  }
  if (Object.keys(styleCounts).length <= 1) {
    suggestions.push("Local fill/text/effect styles look sparse. Validate that design tokens or variables are consistently applied.");
  }

  const fileName = asString(file.name) ?? asString(document.name);
  const editorType = asString(file.editorType);
  const lastModified = asString(file.lastModified);
  const version = asString(file.version);

  return {
    source: "figma-rest-pat",
    mode: "rest-audit",
    requestedFocus: focus,
    fallbackReason: "Figma MCP remote auth unavailable; audit generated via Figma REST API using the workspace PAT.",
    file: {
      key: opts?.fileKey ?? null,
      name: fileName,
      editorType,
      lastModified,
      version,
      thumbnailUrl: asString(file.thumbnailUrl),
    },
    summary: {
      pages: stats.pages,
      totalNodes: stats.totalNodes,
      frames: stats.frames,
      groups: stats.groups,
      sections: stats.sections,
      componentsDefined,
      componentSetsDefined,
      componentsInTree: stats.components,
      componentSetsInTree: stats.componentSets,
      instances: stats.instances,
      textNodes: stats.textNodes,
    },
    autoLayout: {
      autoLayoutContainers: stats.autoLayoutContainers,
      manualLayoutCandidates: stats.manualLayoutCandidates,
      absoluteChildrenInAutoLayout: stats.absoluteChildrenInAutoLayout,
    },
    typography: {
      uniqueFontFamilies,
      mixedFontNodes: stats.mixedFontNodes,
      textNodesWithoutSharedStyle: stats.textNodesWithoutSharedStyle,
      topFontFamilies: topFonts,
      topFontStyles,
    },
    styles: {
      totalLocalStyles: fileMapCount(styles),
      countsByType: styleCounts,
    },
    regressionSnapshot: {
      pageNames: stats.pageNames.slice(0, 12),
      counts: {
        pages: stats.pages,
        totalNodes: stats.totalNodes,
        autoLayoutContainers: stats.autoLayoutContainers,
        manualLayoutCandidates: stats.manualLayoutCandidates,
        componentsDefined,
        componentSetsDefined,
        instances: stats.instances,
        textNodes: stats.textNodes,
        uniqueFontFamilies,
      },
      note: "Use this structural snapshot as a baseline for future audits; it is not a pixel-diff regression run.",
    },
    issues,
    suggestions,
  };
}
