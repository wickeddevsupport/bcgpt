import { describe, expect, it } from "vitest";
import {
  extractFirstBasecampUrl,
  extractFirstFigmaUrl,
  inspectWorkspaceChatUrls,
} from "./url-routing.js";

describe("url-routing", () => {
  it("extracts the first Figma URL and file key from chat text", () => {
    const text =
      "Check this file https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1 and tell me what is wrong.";

    expect(extractFirstFigmaUrl(text)).toBe(
      "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
    );
    expect(inspectWorkspaceChatUrls(text)).toMatchObject({
      figmaUrl:
        "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
      figmaFileKey: "3INmNiG3X3NKAZtCI3SMg6",
      basecampUrl: null,
    });
  });

  it("extracts the first Basecamp URL from chat text", () => {
    const text =
      "Audit this card https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048 and summarize blockers.";

    expect(extractFirstBasecampUrl(text)).toBe(
      "https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048",
    );
    expect(inspectWorkspaceChatUrls(text)).toMatchObject({
      figmaUrl: null,
      figmaFileKey: null,
      basecampUrl:
        "https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048",
    });
  });
});
