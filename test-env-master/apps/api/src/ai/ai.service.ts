import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { z } from "zod";
import type { AIProvider } from "./ai-provider";
import { HeuristicAIProvider } from "./heuristic.provider";
import type { AppLocale } from "./localize-fa";
import { OllamaProvider } from "./ollama.provider";

@Injectable()
export class AIService {
  private readonly heuristic = new HeuristicAIProvider();

  constructor(private readonly config: ConfigService) {}

  getProvider(): AIProvider {
    const baseUrl = this.config.get<string>(
      "OLLAMA_BASE_URL",
      "http://localhost:11434",
    );
    const model = this.config.get<string>("OLLAMA_MODEL", "llama3.2");
    return new OllamaProvider(baseUrl, model);
  }

  async generateStructured<T>(options: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    locale?: AppLocale;
  }): Promise<{ data: T; provider: string }> {
    const provider = this.getProvider();
    try {
      const data = await provider.generateStructured(options);
      return { data, provider: provider.name };
    } catch {
      const data = await this.heuristic.generateStructured(options);
      return { data, provider: this.heuristic.name };
    }
  }
}
