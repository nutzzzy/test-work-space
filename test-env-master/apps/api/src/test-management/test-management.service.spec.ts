import { TestExecutionStatus } from "@qa-workbench/shared";
import { TestManagementService } from "./test-management.service";

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    testCase: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    testRun: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    testSuite: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    testSuiteCase: {
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    jiraIssue: {
      findFirst: jest.fn(),
    },
    ...overrides,
  };
}

describe("TestManagementService", () => {
  it("records a new TestRun without overwriting history", async () => {
    const prisma = createPrismaMock();
    (prisma.testCase.findUnique as jest.Mock).mockResolvedValue({
      id: "tc-1",
      title: "Cancel order",
    });
    (prisma.testRun.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: "run-1", ...data, executedAt: new Date() }),
    );

    const service = new TestManagementService(prisma as never);
    const first = await service.recordRun({
      testCaseId: "tc-1",
      status: TestExecutionStatus.PASSED,
      notes: "ok",
    });
    const second = await service.recordRun({
      testCaseId: "tc-1",
      status: TestExecutionStatus.FAILED,
      notes: "broke",
    });

    expect(prisma.testRun.create).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("PASSED");
    expect(second.status).toBe("FAILED");
    expect(prisma.testRun.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() }),
    );
  });

  it("rejects invalid status changes", async () => {
    const prisma = createPrismaMock();
    const service = new TestManagementService(prisma as never);
    await expect(
      service.recordRun({ testCaseId: "tc-1", status: "DONE" }),
    ).rejects.toThrow(/Invalid status/);
  });

  it("rejects NOT_RUN as an execution status", async () => {
    const prisma = createPrismaMock();
    const service = new TestManagementService(prisma as never);
    await expect(
      service.recordRun({
        testCaseId: "tc-1",
        status: TestExecutionStatus.NOT_RUN,
      }),
    ).rejects.toThrow(/NOT_RUN/);
  });

  it("builds AC → TC → run/bug traceability relations", async () => {
    const prisma = createPrismaMock();
    (prisma.jiraIssue.findFirst as jest.Mock).mockResolvedValue({
      id: "issue-1",
      key: "QA-1",
      title: "Cancel order",
      acceptanceCriteria: [
        {
          id: "ac-1",
          key: "AC-1",
          text: "User can cancel",
          testCases: [
            {
              testCase: {
                id: "tc-1",
                title: "TC-01 cancel happy path",
                priority: "HIGH",
                automationStatus: "NOT_AUTOMATED",
                runs: [{ id: "run-1", status: "FAILED" }],
                bugs: [{ id: "bug-1", title: "Cancel 500", severity: "HIGH" }],
                automationCandidates: [],
              },
            },
          ],
        },
        {
          id: "ac-2",
          key: "AC-2",
          text: "Refund issued",
          testCases: [],
        },
      ],
      testCases: [
        {
          id: "tc-1",
          title: "TC-01 cancel happy path",
          acceptanceLinks: [{ acceptanceCriterionId: "ac-1" }],
          runs: [{ status: "FAILED" }],
          bugs: [],
        },
        {
          id: "tc-orphan",
          title: "Unlinked case",
          acceptanceLinks: [],
          runs: [],
          bugs: [],
        },
      ],
    });

    const service = new TestManagementService(prisma as never);
    const tree = await service.getTraceability("QA-1");

    expect(tree.coverage.acceptanceTotal).toBe(2);
    expect(tree.coverage.acceptanceCovered).toBe(1);
    expect(tree.coverage.requirementCoverage).toBe(50);
    expect(tree.nodes[0].testCases[0].latestStatus).toBe("FAILED");
    expect(tree.nodes[0].testCases[0].bugs[0].id).toBe("bug-1");
    expect(tree.unlinkedTestCases).toHaveLength(1);
  });

  it("stores a manual test case linked to an acceptance criterion", async () => {
    const prisma = createPrismaMock();
    (prisma.jiraIssue.findFirst as jest.Mock).mockResolvedValue({
      id: "issue-1",
      acceptanceCriteria: [{ id: "ac-1", key: "AC-01" }],
    });
    (prisma.testCase.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: "tc-new", ...data }),
    );

    const service = new TestManagementService(prisma as never);
    const created = await service.createCase({
      jiraIssueId: "BX-1",
      title: "  تماس با شماره موبایل  ",
      steps: [" درخواست را بفرستید ", ""],
      expectedResult: " پذیرفته شود ",
      acceptanceKey: "AC-01",
    });

    expect(created.manuallyEdited).toBe(true);
    expect(created.steps).toEqual(["درخواست را بفرستید"]);
    expect(created.title).toBe("تماس با شماره موبایل");
    expect(prisma.testCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jiraIssueId: "issue-1",
          tags: ["manual"],
          acceptanceLinks: {
            create: [{ acceptanceCriterionId: "ac-1" }],
          },
        }),
      }),
    );
  });

  it("rejects a manual test case without steps", async () => {
    const prisma = createPrismaMock();
    const service = new TestManagementService(prisma as never);
    await expect(
      service.createCase({
        jiraIssueId: "BX-1",
        title: "کیس",
        steps: ["  "],
        expectedResult: "نتیجه",
      }),
    ).rejects.toThrow(/at least one step/);
  });

  it("rejects a manual test case for an unknown acceptance criterion", async () => {
    const prisma = createPrismaMock();
    (prisma.jiraIssue.findFirst as jest.Mock).mockResolvedValue({
      id: "issue-1",
      acceptanceCriteria: [{ id: "ac-1", key: "AC-01" }],
    });
    const service = new TestManagementService(prisma as never);
    await expect(
      service.createCase({
        jiraIssueId: "BX-1",
        title: "کیس",
        steps: ["قدم"],
        expectedResult: "نتیجه",
        acceptanceKey: "AC-99",
      }),
    ).rejects.toThrow(/acceptance criterion not found/);
  });

  it("rejects a manual test case when the issue does not exist", async () => {
    const prisma = createPrismaMock();
    (prisma.jiraIssue.findFirst as jest.Mock).mockResolvedValue(null);
    const service = new TestManagementService(prisma as never);
    await expect(
      service.createCase({
        jiraIssueId: "MISSING",
        title: "کیس",
        steps: ["قدم"],
        expectedResult: "نتیجه",
      }),
    ).rejects.toThrow(/Issue not found/);
  });
});
