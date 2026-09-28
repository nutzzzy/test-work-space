import type { ExecutionContext, StepExecutionResult, StepExecutor } from "../types";

export class DelayExecutor implements StepExecutor {
  readonly type = "DELAY";

  async execute(
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<StepExecutionResult> {
    const ms = Math.min(Math.max(Number(config.ms ?? 0), 0), 60_000);
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (context.isCancelled()) {
        return { status: "CANCELLED", error: "Cancelled during delay" };
      }
      await new Promise((r) => setTimeout(r, Math.min(50, ms)));
    }
    return {
      status: "PASSED",
      resolvedInput: { ms },
      output: { waitedMs: ms },
    };
  }
}
