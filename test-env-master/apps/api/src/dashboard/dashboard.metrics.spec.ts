import type { DashboardMetrics } from "./dashboard.service";

function computePassRate(passed: number, executed: number) {
  return executed === 0 ? 0 : Math.round((passed / executed) * 1000) / 10;
}

describe("Dashboard metrics helpers", () => {
  it("computes pass rate", () => {
    expect(computePassRate(8, 10)).toBe(80);
    expect(computePassRate(0, 0)).toBe(0);
  });

  it("shape includes required fields", () => {
    const sample: DashboardMetrics = {
      totalTests: 0,
      executed: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      notRun: 0,
      passRate: 0,
      executionProgress: 0,
      requirementCoverage: 0,
      automationCoverage: 0,
      riskDistribution: {},
      manualVsAutomated: { manual: 0, automated: 0 },
      priorityDistribution: {},
      statusDistribution: {},
      historicalRuns: [],
    };
    expect(sample.totalTests).toBe(0);
  });
});
