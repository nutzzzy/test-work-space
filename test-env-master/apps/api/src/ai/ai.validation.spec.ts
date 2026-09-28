import { RequirementAnalysisSchema } from "@qa-workbench/shared";
import { HeuristicAIProvider } from "./heuristic.provider";
import { parseAndValidate } from "./ollama.provider";

describe("AI structured output", () => {
  it("validates heuristic requirement analysis", async () => {
    const provider = new HeuristicAIProvider();
    const data = await provider.generateStructured({
      system: "test",
      prompt: "Title: Cancel order\nDescription: User cancels\nAcceptance Criteria:\n- can cancel",
      schema: RequirementAnalysisSchema,
      locale: "en",
    });
    expect(data.summary).toMatch(/Analyze requirement/);
    expect(data.gaps.length).toBeGreaterThan(0);
    expect(data.questions.product.length).toBeGreaterThan(0);
  });

  it("returns Persian analysis when locale is fa", async () => {
    const provider = new HeuristicAIProvider();
    const data = await provider.generateStructured({
      system: "test",
      prompt: "Title: لغو سفارش\nDescription: تست\nAcceptance Criteria:\n- بتواند لغو کند",
      schema: RequirementAnalysisSchema,
      locale: "fa",
    });
    expect(data.summary).toMatch(/تحلیل نیازمندی/);
    expect(data.gaps[0]).toMatch(/پیش‌شرط|صلاحیت/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAndValidate("not-json", RequirementAnalysisSchema)).toThrow(
      /not valid JSON/,
    );
  });

  it("rejects schema-invalid payload", () => {
    expect(() =>
      parseAndValidate(JSON.stringify({ summary: 1 }), RequirementAnalysisSchema),
    ).toThrow(/schema validation failed/);
  });
});
