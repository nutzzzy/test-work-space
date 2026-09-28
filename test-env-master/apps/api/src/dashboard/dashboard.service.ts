import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { computeCoverage, computePassRate } from "./dashboard.math";

export type DashboardMetrics = {
  totalTests: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  notRun: number;
  passRate: number;
  executionProgress: number;
  requirementCoverage: number;
  automationCoverage: number;
  riskDistribution: Record<string, number>;
  manualVsAutomated: { manual: number; automated: number };
  priorityDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  historicalRuns: Array<{ date: string; passed: number; failed: number }>;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<DashboardMetrics> {
    const [testCases, latestRuns, risks, acceptance, linked] =
      await Promise.all([
        this.prisma.testCase.findMany({
          include: {
            runs: { orderBy: { executedAt: "desc" }, take: 1 },
          },
        }),
        this.prisma.testRun.findMany({
          orderBy: { executedAt: "desc" },
          take: 200,
        }),
        this.prisma.risk.findMany(),
        this.prisma.acceptanceCriterion.count(),
        this.prisma.testCaseAcceptanceCriterion.findMany({
          distinct: ["acceptanceCriterionId"],
          select: { acceptanceCriterionId: true },
        }),
      ]);

    const statusOf = (tc: (typeof testCases)[number]) =>
      tc.runs[0]?.status ?? "NOT_RUN";

    const counts = {
      PASSED: 0,
      FAILED: 0,
      BLOCKED: 0,
      SKIPPED: 0,
      NOT_RUN: 0,
    };
    const priorityDistribution: Record<string, number> = {};
    let automated = 0;

    for (const tc of testCases) {
      const status = statusOf(tc);
      counts[status as keyof typeof counts] =
        (counts[status as keyof typeof counts] ?? 0) + 1;
      priorityDistribution[tc.priority] =
        (priorityDistribution[tc.priority] ?? 0) + 1;
      if (tc.automationStatus !== "NOT_AUTOMATED") automated += 1;
    }

    const totalTests = testCases.length;
    const executed = totalTests - counts.NOT_RUN;
    const passRate = computePassRate(counts.PASSED, executed);
    const executionProgress = computeCoverage(executed, totalTests);
    const requirementCoverage = computeCoverage(linked.length, acceptance);
    const automationCoverage = computeCoverage(automated, totalTests);

    const riskDistribution: Record<string, number> = {};
    for (const risk of risks) {
      riskDistribution[risk.impact] = (riskDistribution[risk.impact] ?? 0) + 1;
    }

    const byDay = new Map<string, { passed: number; failed: number }>();
    for (const run of latestRuns) {
      const date = run.executedAt.toISOString().slice(0, 10);
      const bucket = byDay.get(date) ?? { passed: 0, failed: 0 };
      if (run.status === "PASSED") bucket.passed += 1;
      if (run.status === "FAILED") bucket.failed += 1;
      byDay.set(date, bucket);
    }
    const historicalRuns = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, v]) => ({ date, ...v }));

    return {
      totalTests,
      executed,
      passed: counts.PASSED,
      failed: counts.FAILED,
      blocked: counts.BLOCKED,
      skipped: counts.SKIPPED,
      notRun: counts.NOT_RUN,
      passRate,
      executionProgress,
      requirementCoverage,
      automationCoverage,
      riskDistribution,
      manualVsAutomated: {
        manual: totalTests - automated,
        automated,
      },
      priorityDistribution,
      statusDistribution: counts,
      historicalRuns,
    };
  }
}
