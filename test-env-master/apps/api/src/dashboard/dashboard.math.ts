export function computePassRate(passed: number, executed: number): number {
  return executed === 0 ? 0 : Math.round((passed / executed) * 1000) / 10;
}

export function computeCoverage(covered: number, total: number): number {
  return total === 0 ? 0 : Math.round((covered / total) * 1000) / 10;
}
