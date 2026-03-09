import { describe, expect, it } from "vitest";
import { buildFigmaRestAuditReport, parseFigmaFileKey } from "./figma-rest-audit.js";

describe("parseFigmaFileKey", () => {
  it("extracts a file key from figma URLs and raw keys", () => {
    expect(parseFigmaFileKey("https://www.figma.com/design/AbCdEf1234567890/Test?node-id=1-2")).toBe(
      "AbCdEf1234567890",
    );
    expect(parseFigmaFileKey("AbCdEf1234567890")).toBe("AbCdEf1234567890");
    expect(parseFigmaFileKey("")).toBeNull();
  });
});

describe("buildFigmaRestAuditReport", () => {
  it("summarizes layout, typography, and component signals from a file payload", () => {
    const report = buildFigmaRestAuditReport(
      {
        name: "Marketing Landing",
        editorType: "figma",
        lastModified: "2026-03-09T12:00:00Z",
        version: "42",
        components: {
          c1: { key: "c1", name: "Button / Primary" },
          c2: { key: "c2", name: "Button / Secondary" },
          c3: { key: "c3", name: "Card / Default" },
          c4: { key: "c4", name: "Hero / Split" },
          c5: { key: "c5", name: "Navbar / Desktop" },
          c6: { key: "c6", name: "Footer / Default" },
        },
        componentSets: {},
        styles: {
          s1: { key: "s1", styleType: "TEXT" },
          s2: { key: "s2", styleType: "FILL" },
        },
        document: {
          name: "Doc",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "Landing",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Hero",
                  layoutMode: "NONE",
                  children: [
                    {
                      id: "1:2",
                      type: "TEXT",
                      name: "Heading",
                      characters: "Hello",
                      fontName: { family: "Inter", style: "Bold" },
                      styles: {},
                    },
                    {
                      id: "1:3",
                      type: "TEXT",
                      name: "Body",
                      characters: "World",
                      fontName: { family: "Merriweather", style: "Regular" },
                      styles: { text: "s1" },
                    },
                    {
                      id: "1:4",
                      type: "GROUP",
                      name: "Actions",
                      children: [],
                    },
                  ],
                },
                {
                  id: "2:1",
                  type: "FRAME",
                  name: "Cards",
                  layoutMode: "VERTICAL",
                  children: [
                    {
                      id: "2:2",
                      type: "INSTANCE",
                      name: "Card 1",
                      componentId: "c3",
                      layoutPositioning: "ABSOLUTE",
                      children: [],
                    },
                    {
                      id: "2:3",
                      type: "INSTANCE",
                      name: "Card 2",
                      componentId: "c3",
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      { focus: "layout", fileKey: "AbCdEf1234567890" },
    );

    expect(report.source).toBe("figma-rest-pat");
    expect(report.requestedFocus).toBe("layout");
    expect(report.file).toMatchObject({
      key: "AbCdEf1234567890",
      name: "Marketing Landing",
      editorType: "figma",
    });
    expect(report.summary).toMatchObject({
      pages: 1,
      frames: 2,
      componentsDefined: 6,
      componentSetsDefined: 0,
      instances: 2,
      textNodes: 2,
    });
    expect(report.autoLayout).toMatchObject({
      autoLayoutContainers: 1,
      manualLayoutCandidates: 1,
      absoluteChildrenInAutoLayout: 1,
    });
    expect(report.typography).toMatchObject({
      uniqueFontFamilies: 2,
      textNodesWithoutSharedStyle: 1,
    });
    expect(report.issues).toContainEqual(expect.stringContaining("manual layout candidates"));
    expect(report.suggestions).toContainEqual(expect.stringContaining("Auto Layout"));
    expect(report.regressionSnapshot).toMatchObject({
      pageNames: ["Landing"],
    });
  });
});
