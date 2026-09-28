import type { StepExecutorRegistry } from "./step-executor.registry";
import type {
  ExecutionContext,
  OrchestrationResult,
  OrchestrationStep,
  OrchestrationStepResult,
} from "./types";

/**
 * Pure step-loop used by ScenarioRunner and unit tests.
 * Handles order, skip, cancel, stopOnFailure / continueOnFailure.
 */
export async function orchestrateSteps(
  steps: OrchestrationStep[],
  registry: StepExecutorRegistry,
  context: ExecutionContext,
  options: {
    stopOnFailure: boolean;
    onStepComplete?: (result: OrchestrationStepResult) => Promise<void> | void;
  },
): Promise<OrchestrationResult> {
  const stepResults: OrchestrationStepResult[] = [];
  let finalStatus: OrchestrationResult["status"] = "PASSED";
  let runError: string | undefined;

  const ordered = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const step of ordered) {
    if (context.isCancelled()) {
      finalStatus = "CANCELLED";
      break;
    }

    if (!step.enabled) {
      const skipped: OrchestrationStepResult = {
        name: step.name,
        type: step.type,
        orderIndex: step.orderIndex,
        status: "SKIPPED",
        durationMs: 0,
      };
      stepResults.push(skipped);
      await options.onStepComplete?.(skipped);
      continue;
    }

    const started = Date.now();
    let result;
    try {
      const executor = registry.resolve(step.type);
      result = await executor.execute(step.config ?? {}, context);
    } catch (error) {
      result = {
        status: "FAILED" as const,
        error:
          error instanceof Error ? error.message : "Step execution failed",
      };
    }

    const stepResult: OrchestrationStepResult = {
      ...result,
      name: step.name,
      type: step.type,
      orderIndex: step.orderIndex,
      durationMs: Date.now() - started,
    };
    stepResults.push(stepResult);
    await options.onStepComplete?.(stepResult);

    if (context.isCancelled() || result.status === "CANCELLED") {
      finalStatus = "CANCELLED";
      runError = result.error ?? "Cancelled";
      break;
    }

    if (result.status === "FAILED") {
      finalStatus = "FAILED";
      runError = result.error;
      const continueOnFailure = step.config?.continueOnFailure === true;
      if (options.stopOnFailure && !continueOnFailure) break;
    }
  }

  if (context.isCancelled()) {
    finalStatus = "CANCELLED";
  }

  return { status: finalStatus, error: runError, stepResults };
}
