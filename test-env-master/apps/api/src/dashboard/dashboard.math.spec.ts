import { computePassRate, computeCoverage } from "./dashboard.math";

describe("Dashboard metric calculations", () => {
  it("computes pass rate", () => {
    expect(computePassRate(8, 10)).toBe(80);
    expect(computePassRate(0, 0)).toBe(0);
    expect(computePassRate(1, 3)).toBe(33.3);
  });

  it("computes coverage percentages", () => {
    expect(computeCoverage(1, 2)).toBe(50);
    expect(computeCoverage(0, 0)).toBe(0);
    expect(computeCoverage(3, 3)).toBe(100);
  });
});
