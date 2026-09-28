import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EnvironmentsService } from "../environments/environments.service";
import { maskDeep } from "../common/mask.util";
import { DatabaseConnectorsService } from "../database-connectors/database-connectors.service";
import { AssertionExecutor } from "./executors/assertion.executor";
import { ConditionExecutor } from "./executors/condition.executor";
import { DatabaseActionExecutor } from "./executors/database-action.executor";
import { DelayExecutor } from "./executors/delay.executor";
import { ExtractVariableExecutor } from "./executors/extract-variable.executor";
import { HttpRequestExecutor } from "./executors/http-request.executor";
import { SetVariableExecutor } from "./executors/set-variable.executor";
import { orchestrateSteps } from "./orchestrate";
import { StepExecutorRegistry } from "./step-executor.registry";
import { ExecutionContext } from "./types";

@Injectable()
export class ScenarioRunner {
  private readonly logger = new Logger(ScenarioRunner.name);
  private readonly registry = new StepExecutorRegistry();
  private readonly active = new Map<string, ExecutionContext>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly environments: EnvironmentsService,
    connectors: DatabaseConnectorsService,
  ) {
    for (const executor of [
      new HttpRequestExecutor(),
      new AssertionExecutor(),
      new ExtractVariableExecutor(),
      new SetVariableExecutor(),
      new DelayExecutor(),
      new ConditionExecutor(),
      new DatabaseActionExecutor(connectors),
    ]) {
      this.registry.register(executor);
    }
  }

  getRegistry() {
    return this.registry;
  }

  async getRun(runId: string) {
    const run = await this.prisma.scenarioRun.findUnique({
      where: { id: runId },
      include: {
        scenario: true,
        stepRuns: { orderBy: { orderIndex: "asc" } },
      },
    });
    if (!run) throw new NotFoundException("Scenario run not found");
    return run;
  }

  async cancel(runId: string) {
    const ctx = this.active.get(runId);
    if (ctx) {
      ctx.cancel();
      return { ok: true, live: true };
    }
    const run = await this.prisma.scenarioRun.findUnique({
      where: { id: runId },
    });
    if (run && run.status === "RUNNING") {
      await this.prisma.scenarioRun.update({
        where: { id: runId },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
    }
    return { ok: true, live: false };
  }

  /**
   * Starts a run asynchronously and returns immediately (RUNNING)
   * so the UI can poll + cancel (live execution).
   */
  async start(scenarioId: string) {
    const prepared = await this.prepareRun(scenarioId);
    void this.executePrepared(prepared).catch((error) => {
      this.logger.error(
        `Scenario run ${prepared.runId} crashed`,
        error instanceof Error ? error.stack : String(error),
      );
    });
    return this.getRun(prepared.runId);
  }

  /** Synchronous full run — useful for scripts / demos that await completion. */
  async run(scenarioId: string) {
    const prepared = await this.prepareRun(scenarioId);
    await this.executePrepared(prepared);
    return this.getRun(prepared.runId);
  }

  private async prepareRun(scenarioId: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: { steps: { orderBy: { orderIndex: "asc" } } },
    });
    if (!scenario) throw new NotFoundException("Scenario not found");

    const envVars = scenario.environmentId
      ? await this.environments.getResolvedVariables(scenario.environmentId)
      : {};

    const run = await this.prisma.scenarioRun.create({
      data: {
        scenarioId: scenario.id,
        environmentId: scenario.environmentId,
        status: "RUNNING",
        startedAt: new Date(),
        variablesJson: maskDeep(envVars) as Prisma.InputJsonValue,
      },
    });

    const context = new ExecutionContext(envVars);
    this.active.set(run.id, context);

    return {
      runId: run.id,
      scenario,
      context,
      startedAt: run.startedAt ?? new Date(),
    };
  }

  private async executePrepared(prepared: {
    runId: string;
    scenario: {
      id: string;
      stopOnFailure: boolean;
      steps: Array<{
        id: string;
        name: string;
        type: string;
        orderIndex: number;
        enabled: boolean;
        config: Prisma.JsonValue;
      }>;
    };
    context: ExecutionContext;
    startedAt: Date;
  }) {
    const { runId, scenario, context, startedAt } = prepared;
    let finalStatus: "PASSED" | "FAILED" | "CANCELLED" = "PASSED";
    let runError: string | undefined;

    try {
      const result = await orchestrateSteps(
        scenario.steps.map((step) => ({
          id: step.id,
          name: step.name,
          type: step.type,
          orderIndex: step.orderIndex,
          enabled: step.enabled,
          config: (step.config ?? {}) as Record<string, unknown>,
        })),
        this.registry,
        context,
        {
          stopOnFailure: scenario.stopOnFailure,
          onStepComplete: async (stepResult) => {
            const matching = scenario.steps.find(
              (s) =>
                s.orderIndex === stepResult.orderIndex &&
                s.name === stepResult.name,
            );
            const finishedAt = new Date();
            const startedAtStep = new Date(
              finishedAt.getTime() - stepResult.durationMs,
            );
            await this.prisma.scenarioStepRun.create({
              data: {
                scenarioRunId: runId,
                scenarioStepId: matching?.id,
                name: stepResult.name,
                type: stepResult.type,
                orderIndex: stepResult.orderIndex,
                status: stepResult.status,
                startedAt: startedAtStep,
                finishedAt,
                durationMs: stepResult.durationMs,
                resolvedInput: stepResult.resolvedInput
                  ? (maskDeep(stepResult.resolvedInput) as Prisma.InputJsonValue)
                  : undefined,
                output: stepResult.output
                  ? (maskDeep(stepResult.output) as Prisma.InputJsonValue)
                  : undefined,
                error: stepResult.error,
                extractedVars: stepResult.extractedVars
                  ? (maskDeep(stepResult.extractedVars) as Prisma.InputJsonValue)
                  : undefined,
              },
            });
            // Live variables snapshot for polling UI
            await this.prisma.scenarioRun.update({
              where: { id: runId },
              data: {
                variablesJson: maskDeep(
                  context.entries(),
                ) as Prisma.InputJsonValue,
              },
            });
          },
        },
      );

      finalStatus = result.status;
      runError = result.error;
    } catch (error) {
      finalStatus = "FAILED";
      runError =
        error instanceof Error ? error.message : "Scenario execution failed";
    } finally {
      this.active.delete(runId);
    }

    if (context.isCancelled()) {
      finalStatus = "CANCELLED";
    }

    const finishedAt = new Date();
    await this.prisma.scenarioRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: runError,
        variablesJson: maskDeep(context.entries()) as Prisma.InputJsonValue,
      },
    });
  }
}
