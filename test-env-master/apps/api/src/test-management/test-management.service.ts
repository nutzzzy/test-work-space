import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { TestExecutionStatus } from "@qa-workbench/shared";
import { PrismaService } from "../prisma/prisma.service";

const ALLOWED_STATUSES = new Set(Object.values(TestExecutionStatus));

@Injectable()
export class TestManagementService {
  constructor(private readonly prisma: PrismaService) {}

  listCases(jiraIssueId?: string) {
    return this.prisma.testCase.findMany({
      where: jiraIssueId
        ? {
            OR: [
              { jiraIssueId },
              { jiraIssue: { key: jiraIssueId.toUpperCase() } },
            ],
          }
        : undefined,
      include: {
        acceptanceLinks: { include: { acceptanceCriterion: true } },
        runs: { orderBy: { executedAt: "desc" }, take: 10 },
        bugs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getCase(id: string) {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id },
      include: {
        acceptanceLinks: { include: { acceptanceCriterion: true } },
        runs: { orderBy: { executedAt: "desc" } },
        bugs: true,
        suiteLinks: { include: { suite: true } },
      },
    });
    if (!testCase) throw new NotFoundException("Test case not found");
    return testCase;
  }

  async createCase(input: {
    jiraIssueId: string;
    title: string;
    description?: string;
    preconditions?: string[];
    steps: string[];
    expectedResult: string;
    priority?: string;
    type?: string;
    acceptanceKey?: string;
  }) {
    const title = input.title.trim();
    const steps = input.steps.map((step) => step.trim()).filter(Boolean);
    const expectedResult = input.expectedResult.trim();
    if (!title) throw new BadRequestException("title is required");
    if (steps.length === 0) {
      throw new BadRequestException("at least one step is required");
    }
    if (!expectedResult) {
      throw new BadRequestException("expectedResult is required");
    }
    const priority = input.priority ?? "MEDIUM";
    if (!["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(priority)) {
      throw new BadRequestException("invalid priority");
    }

    const issue = await this.prisma.jiraIssue.findFirst({
      where: {
        OR: [
          { id: input.jiraIssueId },
          { key: input.jiraIssueId.toUpperCase() },
        ],
      },
      include: { acceptanceCriteria: true },
    });
    if (!issue) throw new NotFoundException("Issue not found");

    const acceptanceKey = input.acceptanceKey?.trim();
    const criterion = acceptanceKey
      ? issue.acceptanceCriteria.find((item) => item.key === acceptanceKey)
      : undefined;
    if (acceptanceKey && !criterion) {
      throw new BadRequestException("acceptance criterion not found");
    }

    return this.prisma.testCase.create({
      data: {
        jiraIssueId: issue.id,
        title,
        description: input.description?.trim() ?? "",
        preconditions: (input.preconditions ?? [])
          .map((item) => item.trim())
          .filter(Boolean),
        steps,
        expectedResult,
        priority,
        type: input.type?.trim() || "FUNCTIONAL",
        tags: ["manual"],
        manuallyEdited: true,
        ...(criterion
          ? {
              acceptanceLinks: {
                create: [{ acceptanceCriterionId: criterion.id }],
              },
            }
          : {}),
      },
      include: {
        acceptanceLinks: { include: { acceptanceCriterion: true } },
      },
    });
  }

  async updateCase(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      preconditions: string[];
      steps: string[];
      expectedResult: string;
      priority: string;
      type: string;
      tags: string[];
      automationStatus: string;
    }>,
  ) {
    await this.getCase(id);
    return this.prisma.testCase.update({
      where: { id },
      data: { ...data, manuallyEdited: true },
    });
  }

  async recordRun(input: {
    testCaseId: string;
    status: string;
    notes?: string;
    evidence?: string;
  }) {
    if (!ALLOWED_STATUSES.has(input.status as TestExecutionStatus)) {
      throw new BadRequestException(`Invalid status: ${input.status}`);
    }
    if (input.status === TestExecutionStatus.NOT_RUN) {
      throw new BadRequestException("Cannot record NOT_RUN as an execution");
    }

    const testCase = await this.prisma.testCase.findUnique({
      where: { id: input.testCaseId },
    });
    if (!testCase) throw new NotFoundException("Test case not found");

    // Always insert — never overwrite previous TestRuns
    return this.prisma.testRun.create({
      data: {
        testCaseId: input.testCaseId,
        status: input.status,
        notes: input.notes,
        evidence: input.evidence,
      },
    });
  }

  listRuns(testCaseId?: string) {
    return this.prisma.testRun.findMany({
      where: testCaseId ? { testCaseId } : undefined,
      include: {
        testCase: true,
        bugs: true,
      },
      orderBy: { executedAt: "desc" },
      take: 200,
    });
  }

  listSuites() {
    return this.prisma.testSuite.findMany({
      include: {
        cases: {
          include: {
            testCase: {
              include: {
                runs: { orderBy: { executedAt: "desc" }, take: 1 },
              },
            },
          },
          orderBy: { orderIndex: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getSuite(id: string) {
    const suite = await this.prisma.testSuite.findUnique({
      where: { id },
      include: {
        cases: {
          include: { testCase: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!suite) throw new NotFoundException("Suite not found");
    return suite;
  }

  createSuite(input: {
    name: string;
    description?: string;
    kind?: string;
    testCaseIds?: string[];
  }) {
    const kind = (input.kind ?? "CUSTOM").toUpperCase();
    if (!["SMOKE", "REGRESSION", "CUSTOM"].includes(kind)) {
      throw new BadRequestException("kind must be SMOKE, REGRESSION, or CUSTOM");
    }
    return this.prisma.testSuite.create({
      data: {
        name: input.name,
        description: input.description ?? "",
        kind,
        cases: input.testCaseIds?.length
          ? {
              create: input.testCaseIds.map((testCaseId, orderIndex) => ({
                testCaseId,
                orderIndex,
              })),
            }
          : undefined,
      },
      include: { cases: { include: { testCase: true } } },
    });
  }

  async addCaseToSuite(suiteId: string, testCaseId: string) {
    await this.getSuite(suiteId);
    const testCase = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
    });
    if (!testCase) throw new NotFoundException("Test case not found");

    const existing = await this.prisma.testSuiteCase.findUnique({
      where: { suiteId_testCaseId: { suiteId, testCaseId } },
    });
    if (existing) return existing;

    const count = await this.prisma.testSuiteCase.count({ where: { suiteId } });
    return this.prisma.testSuiteCase.create({
      data: { suiteId, testCaseId, orderIndex: count },
    });
  }

  async removeCaseFromSuite(suiteId: string, testCaseId: string) {
    await this.prisma.testSuiteCase.delete({
      where: { suiteId_testCaseId: { suiteId, testCaseId } },
    });
    return { ok: true };
  }

  async deleteSuite(id: string) {
    await this.getSuite(id);
    await this.prisma.testSuite.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Traceability tree:
   * AC → TestCase → latest TestRun (+ linked Bugs)
   */
  async getTraceability(jiraIssueIdOrKey: string) {
    const issue = await this.prisma.jiraIssue.findFirst({
      where: {
        OR: [
          { id: jiraIssueIdOrKey },
          { key: jiraIssueIdOrKey.toUpperCase() },
        ],
      },
      include: {
        acceptanceCriteria: {
          orderBy: { orderIndex: "asc" },
          include: {
            testCases: {
              include: {
                testCase: {
                  include: {
                    runs: { orderBy: { executedAt: "desc" }, take: 1 },
                    bugs: { orderBy: { createdAt: "desc" } },
                    automationCandidates: true,
                  },
                },
              },
            },
          },
        },
        testCases: {
          include: {
            acceptanceLinks: true,
            runs: { orderBy: { executedAt: "desc" }, take: 1 },
            bugs: true,
          },
        },
      },
    });
    if (!issue) throw new NotFoundException("Issue not found");

    const coveredAcIds = new Set(
      issue.acceptanceCriteria
        .filter((ac) => ac.testCases.length > 0)
        .map((ac) => ac.id),
    );
    const unlinkedCases = issue.testCases.filter(
      (tc) => tc.acceptanceLinks.length === 0,
    );

    return {
      issue: { id: issue.id, key: issue.key, title: issue.title },
      coverage: {
        acceptanceTotal: issue.acceptanceCriteria.length,
        acceptanceCovered: coveredAcIds.size,
        requirementCoverage:
          issue.acceptanceCriteria.length === 0
            ? 0
            : Math.round(
                (coveredAcIds.size / issue.acceptanceCriteria.length) * 1000,
              ) / 10,
      },
      nodes: issue.acceptanceCriteria.map((ac) => ({
        id: ac.id,
        key: ac.key,
        text: ac.text,
        testCases: ac.testCases.map(({ testCase }) => ({
          id: testCase.id,
          title: testCase.title,
          priority: testCase.priority,
          automationStatus: testCase.automationStatus,
          latestStatus: testCase.runs[0]?.status ?? "NOT_RUN",
          latestRunId: testCase.runs[0]?.id ?? null,
          bugs: testCase.bugs.map((b) => ({
            id: b.id,
            title: b.title,
            severity: b.severity,
          })),
          automationCandidates: testCase.automationCandidates.map((c) => ({
            id: c.id,
            recommendedLevel: c.recommendedLevel,
            apiUiRecommendation: c.apiUiRecommendation,
          })),
        })),
      })),
      unlinkedTestCases: unlinkedCases.map((tc) => ({
        id: tc.id,
        title: tc.title,
        latestStatus: tc.runs[0]?.status ?? "NOT_RUN",
      })),
    };
  }
}
