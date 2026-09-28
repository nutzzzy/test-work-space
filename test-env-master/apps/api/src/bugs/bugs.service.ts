import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BugsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.bug.findMany({
      include: { testCase: true, testRun: true, jiraIssue: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(input: {
    title: string;
    description?: string;
    reproductionSteps?: string[];
    expectedResult?: string;
    actualResult?: string;
    severity?: string;
    priority?: string;
    environment?: string;
    evidence?: string;
    jiraIssueId?: string;
    testCaseId?: string;
    testRunId?: string;
  }) {
    return this.prisma.bug.create({
      data: {
        title: input.title,
        description: input.description ?? "",
        reproductionSteps: input.reproductionSteps ?? [],
        expectedResult: input.expectedResult ?? "",
        actualResult: input.actualResult ?? "",
        severity: input.severity ?? "MEDIUM",
        priority: input.priority ?? "MEDIUM",
        environment: input.environment,
        evidence: input.evidence,
        jiraIssueId: input.jiraIssueId,
        testCaseId: input.testCaseId,
        testRunId: input.testRunId,
      },
    });
  }

  async createFromFailedRun(testRunId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: testRunId },
      include: { testCase: true },
    });
    if (!run) throw new NotFoundException("Test run not found");
    return this.create({
      title: `Bug: ${run.testCase.title}`,
      description: run.notes ?? "Failed test execution",
      reproductionSteps: Array.isArray(run.testCase.steps)
        ? (run.testCase.steps as string[])
        : [],
      expectedResult: run.testCase.expectedResult,
      actualResult: run.notes ?? "FAILED",
      severity: "HIGH",
      priority: run.testCase.priority,
      evidence: run.evidence ?? undefined,
      jiraIssueId: run.testCase.jiraIssueId ?? undefined,
      testCaseId: run.testCaseId,
      testRunId: run.id,
    });
  }
}
