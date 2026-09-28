import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DatabaseConnectorsService } from "../database-connectors/database-connectors.service";
import { PrismaService } from "../prisma/prisma.service";
import { ScenarioRunner } from "../scenario-engine/scenario.runner";

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ScenarioRunner,
    private readonly connectors: DatabaseConnectorsService,
  ) {}

  list() {
    return this.prisma.scenario.findMany({
      include: {
        steps: { orderBy: { orderIndex: "asc" } },
        environment: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { stepRuns: { orderBy: { orderIndex: "asc" } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async get(id: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { orderIndex: "asc" } },
        environment: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { stepRuns: { orderBy: { orderIndex: "asc" } } },
        },
      },
    });
    if (!scenario) throw new NotFoundException("Scenario not found");
    return scenario;
  }

  create(input: {
    name: string;
    description?: string;
    environmentId?: string;
    stopOnFailure?: boolean;
  }) {
    return this.prisma.scenario.create({
      data: {
        name: input.name,
        description: input.description ?? "",
        environmentId: input.environmentId,
        stopOnFailure: input.stopOnFailure ?? true,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      environmentId: string | null;
      stopOnFailure: boolean;
    }>,
  ) {
    return this.prisma.scenario.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.scenario.delete({ where: { id } });
    return { ok: true };
  }

  async duplicate(id: string) {
    const scenario = await this.get(id);
    return this.prisma.scenario.create({
      data: {
        name: `${scenario.name} (copy)`,
        description: scenario.description,
        environmentId: scenario.environmentId,
        stopOnFailure: scenario.stopOnFailure,
        steps: {
          create: scenario.steps.map((s) => ({
            name: s.name,
            type: s.type,
            orderIndex: s.orderIndex,
            enabled: s.enabled,
            config: s.config as Prisma.InputJsonValue,
          })),
        },
      },
      include: { steps: true },
    });
  }

  async addStep(
    scenarioId: string,
    input: {
      name: string;
      type: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
  ) {
    const known = this.runner.getRegistry().list();
    if (!known.includes(input.type)) {
      throw new BadRequestException(`Unknown StepType: ${input.type}`);
    }
    if (input.type === "DATABASE_ACTION") {
      await this.connectors.assertStepConfig(input.config ?? {});
    }
    const count = await this.prisma.scenarioStep.count({ where: { scenarioId } });
    return this.prisma.scenarioStep.create({
      data: {
        scenarioId,
        name: input.name,
        type: input.type,
        orderIndex: count,
        enabled: input.enabled ?? true,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async updateStep(
    stepId: string,
    data: Partial<{
      name: string;
      config: Record<string, unknown>;
      enabled: boolean;
      orderIndex: number;
    }>,
  ) {
    if (data.config) {
      const current = await this.prisma.scenarioStep.findUnique({ where: { id: stepId } });
      if (current?.type === "DATABASE_ACTION") {
        await this.connectors.assertStepConfig(data.config);
      }
    }
    return this.prisma.scenarioStep.update({
      where: { id: stepId },
      data: {
        name: data.name,
        enabled: data.enabled,
        orderIndex: data.orderIndex,
        config: data.config
          ? (data.config as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async deleteStep(stepId: string) {
    await this.prisma.scenarioStep.delete({ where: { id: stepId } });
    return { ok: true };
  }

  async reorderSteps(scenarioId: string, stepIds: string[]) {
    await this.prisma.$transaction(
      stepIds.map((id, orderIndex) =>
        this.prisma.scenarioStep.update({
          where: { id },
          data: { orderIndex, scenarioId },
        }),
      ),
    );
    return this.get(scenarioId);
  }

  async duplicateStep(stepId: string) {
    const step = await this.prisma.scenarioStep.findUnique({ where: { id: stepId } });
    if (!step) throw new NotFoundException("Step not found");
    const count = await this.prisma.scenarioStep.count({
      where: { scenarioId: step.scenarioId },
    });
    return this.prisma.scenarioStep.create({
      data: {
        scenarioId: step.scenarioId,
        name: `${step.name} (copy)`,
        type: step.type,
        orderIndex: count,
        enabled: step.enabled,
        config: step.config as Prisma.InputJsonValue,
      },
    });
  }

  /** Live async start — returns RUNNING immediately. */
  start(scenarioId: string) {
    return this.runner.start(scenarioId);
  }

  /** Await full completion (scripts/demo). */
  run(scenarioId: string) {
    return this.runner.run(scenarioId);
  }

  getRun(runId: string) {
    return this.runner.getRun(runId);
  }

  cancel(runId: string) {
    return this.runner.cancel(runId);
  }

  listRuns(scenarioId?: string) {
    return this.prisma.scenarioRun.findMany({
      where: scenarioId ? { scenarioId } : undefined,
      include: {
        scenario: true,
        stepRuns: { orderBy: { orderIndex: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
