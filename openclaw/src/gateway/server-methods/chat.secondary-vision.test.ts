import { describe, expect, it } from "vitest";
import { __chatTesting } from "./chat.ts";

describe("chat secondary vision helpers", () => {
  it("builds a prompt that tells the image reader to help a text-only assistant", () => {
    const prompt = __chatTesting.buildSecondaryVisionPrompt(0, 1);
    expect(prompt).toContain("text-only assistant");
    expect(prompt).toContain("visible text");
  });

  it("appends structured secondary image context without dropping the user message", () => {
    const augmented = __chatTesting.appendSecondaryVisionContext("What does this screenshot say?", [
      {
        text: "A dashboard with an overdue tasks widget and a red error banner.",
        provider: "openai",
        model: "gpt-5-mini",
      },
    ]);

    expect(augmented).toContain("What does this screenshot say?");
    expect(augmented).toContain("Secondary image-reader context");
    expect(augmented).toContain('<image_context index="1" source="openai/gpt-5-mini">');
    expect(augmented).toContain("overdue tasks widget");
  });
});
