export type StepExecutionResult = {
  status: "PASSED" | "FAILED" | "SKIPPED" | "CANCELLED";
  output?: unknown;
  error?: string;
  extractedVars?: Record<string, string>;
  resolvedInput?: unknown;
};

export class ExecutionContext {
  private readonly variables = new Map<string, string>();
  private readonly initialKeys = new Set<string>();
  private cancelled = false;
  private readonly abortHandlers = new Set<() => void>();
  lastHttpResponse: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    rawBody: string;
  } | null = null;

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) {
      this.variables.set(k, v);
      this.initialKeys.add(k);
    }
  }

  isInitial(key: string) {
    return this.initialKeys.has(key);
  }

  cancel() {
    this.cancelled = true;
    for (const handler of this.abortHandlers) {
      try {
        handler();
      } catch {
        // ignore abort handler errors
      }
    }
  }

  onAbort(handler: () => void): () => void {
    this.abortHandlers.add(handler);
    return () => this.abortHandlers.delete(handler);
  }

  isCancelled() {
    return this.cancelled;
  }

  get(key: string): string | undefined {
    return this.variables.get(key);
  }

  set(key: string, value: string) {
    this.variables.set(key, value);
  }

  entries(): Record<string, string> {
    return Object.fromEntries(this.variables.entries());
  }

  interpolate(input: string): string {
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
      const value = this.variables.get(key);
      if (value === undefined) {
        throw new Error(`Unresolved variable: {{${key}}}`);
      }
      return value;
    });
  }

  interpolateDeep<T>(value: T): T {
    if (typeof value === "string") {
      return this.interpolate(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.interpolateDeep(v)) as T;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.interpolateDeep(v);
      }
      return out as T;
    }
    return value;
  }
}

export interface StepExecutor {
  readonly type: string;
  execute(
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepExecutionResult>;
}

export type OrchestrationStep = {
  id?: string;
  name: string;
  type: string;
  enabled: boolean;
  orderIndex: number;
  config: Record<string, unknown>;
};

export type OrchestrationStepResult = StepExecutionResult & {
  name: string;
  type: string;
  orderIndex: number;
  durationMs: number;
};

export type OrchestrationResult = {
  status: "PASSED" | "FAILED" | "CANCELLED";
  error?: string;
  stepResults: OrchestrationStepResult[];
};
