import type { z } from "zod";
import type { AIProvider, AiGenerateOptions } from "./ai-provider";

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generateStructured<T>(options: AiGenerateOptions<T>): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: options.system },
          {
            role: "user",
            content: `${options.prompt}\n\nRespond with valid JSON only.${
              options.locale === "fa"
                ? " All human-readable string values MUST be in Persian (Farsi)."
                : ""
            }`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    const content = data.message?.content ?? "";
    return parseAndValidate(content, options.schema);
  }
}

export function parseAndValidate<T>(
  content: string,
  schema: z.ZodType<T>,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI response is not valid JSON");
    }
    parsed = JSON.parse(match[0]);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`AI schema validation failed: ${result.error.message}`);
  }
  return result.data;
}
