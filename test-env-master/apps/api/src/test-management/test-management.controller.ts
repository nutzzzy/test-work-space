import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { TestManagementService } from "./test-management.service";

const CreateCaseSchema = z.object({
  jiraIssueId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  steps: z.array(z.string()).min(1),
  expectedResult: z.string().min(1),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  type: z.string().optional(),
  acceptanceKey: z.string().optional(),
});

@Controller()
export class TestManagementController {
  constructor(private readonly service: TestManagementService) {}

  @Get("test-cases")
  listCases(@Query("jiraIssueId") jiraIssueId?: string) {
    return this.service.listCases(jiraIssueId);
  }

  @Post("test-cases")
  createCase(@Body() body: unknown) {
    const parsed = CreateCaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("invalid test case");
    }
    return this.service.createCase(parsed.data);
  }

  @Get("test-cases/:id")
  getCase(@Param("id") id: string) {
    return this.service.getCase(id);
  }

  @Patch("test-cases/:id")
  updateCase(
    @Param("id") id: string,
    @Body()
    body: Partial<{
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
    return this.service.updateCase(id, body);
  }

  @Post("test-runs")
  recordRun(
    @Body()
    body: {
      testCaseId: string;
      status: string;
      notes?: string;
      evidence?: string;
    },
  ) {
    return this.service.recordRun(body);
  }

  @Get("test-runs")
  listRuns(@Query("testCaseId") testCaseId?: string) {
    return this.service.listRuns(testCaseId);
  }

  @Get("test-suites")
  listSuites() {
    return this.service.listSuites();
  }

  @Get("test-suites/:id")
  getSuite(@Param("id") id: string) {
    return this.service.getSuite(id);
  }

  @Post("test-suites")
  createSuite(
    @Body()
    body: {
      name: string;
      description?: string;
      kind?: string;
      testCaseIds?: string[];
    },
  ) {
    return this.service.createSuite(body);
  }

  @Delete("test-suites/:id")
  deleteSuite(@Param("id") id: string) {
    return this.service.deleteSuite(id);
  }

  @Post("test-suites/:id/cases")
  addCase(
    @Param("id") id: string,
    @Body() body: { testCaseId: string },
  ) {
    return this.service.addCaseToSuite(id, body.testCaseId);
  }

  @Delete("test-suites/:id/cases/:testCaseId")
  removeCase(
    @Param("id") id: string,
    @Param("testCaseId") testCaseId: string,
  ) {
    return this.service.removeCaseFromSuite(id, testCaseId);
  }

  @Get("traceability/:jiraIssueId")
  traceability(@Param("jiraIssueId") jiraIssueId: string) {
    return this.service.getTraceability(jiraIssueId);
  }
}
