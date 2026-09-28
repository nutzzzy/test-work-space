import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { BugsService } from "./bugs.service";

@Controller("bugs")
export class BugsController {
  constructor(private readonly bugsService: BugsService) {}

  @Get()
  list() {
    return this.bugsService.list();
  }

  @Post()
  create(
    @Body()
    body: {
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
    },
  ) {
    return this.bugsService.create(body);
  }

  @Post("from-run/:testRunId")
  fromRun(@Param("testRunId") testRunId: string) {
    return this.bugsService.createFromFailedRun(testRunId);
  }
}
