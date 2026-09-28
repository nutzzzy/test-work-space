import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  localizeIssueContentToFa,
  normalizeLocale,
  type AppLocale,
} from "../ai/localize-fa";
import { PrismaService } from "../prisma/prisma.service";
import {
  designAcceptanceCriteria,
  designAnalysis,
  designAutomation,
  designEdgeCases,
  designRisks,
  designStrategy,
  designTestCases,
  type DesignedCriterion,
} from "./qa-design";

function sourceCriteria(
  rawAcceptanceText: string | null | undefined,
  current: Array<{ text: string }>,
) {
  const rawLines = rawAcceptanceText
    ?.split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rawLines && rawLines.length > 0) return rawLines;
  return current.map((item) => item.text);
}

@Injectable()
export class AnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  private designedFrom(issue: {
    acceptanceCriteria: Array<{
      key: string;
      text: string;
      origin: string;
      orderIndex: number;
    }>;
  }): DesignedCriterion[] {
    return issue.acceptanceCriteria.map((item) => ({
      key: item.key,
      text: item.text,
      origin: item.origin === "derived" ? "derived" : "cleaned",
      orderIndex: item.orderIndex,
    }));
  }

  private async loadIssue(jiraIssueId: string) {
    const issue = await this.prisma.jiraIssue.findFirst({
      where: { OR: [{ id: jiraIssueId }, { key: jiraIssueId.toUpperCase() }] },
      include: {
        acceptanceCriteria: { orderBy: { orderIndex: "asc" as const } },
        testCases: true,
      },
    });
    if (!issue) throw new NotFoundException("Issue not found");
    return issue;
  }

  async localizeIssueForRequest(jiraIssueId: string, localeInput?: unknown) {
    return this.localizeIssueContent(
      jiraIssueId,
      normalizeLocale(localeInput),
    );
  }

  /** Localize stored issue title/description/AC when UI language is Persian. */
  async localizeIssueContent(jiraIssueId: string, locale: AppLocale) {
    if (locale !== "fa") return null;
    const issue = await this.loadIssue(jiraIssueId);
    const localized = localizeIssueContentToFa({
      title: issue.title,
      description: issue.description,
      acceptanceCriteria: issue.acceptanceCriteria.map((a) => a.text),
    });

    await this.prisma.jiraIssue.update({
      where: { id: issue.id },
      data: {
        title: localized.title,
        description: localized.description,
      },
    });

    await Promise.all(
      issue.acceptanceCriteria.map((ac, index) =>
        this.prisma.acceptanceCriterion.update({
          where: { id: ac.id },
          data: { text: localized.acceptanceCriteria[index] ?? ac.text },
        }),
      ),
    );

    return this.loadIssue(jiraIssueId);
  }

  async analyzeRequirements(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    await this.localizeIssueContent(jiraIssueId, locale);
    const loaded = await this.loadIssue(jiraIssueId);
    const issue = await this.ensureDesignedCriteria(loaded, locale);
    const existing = await this.prisma.requirementAnalysis.findUnique({
      where: { jiraIssueId: issue.id },
    });
    if (existing?.manuallyEdited) {
      throw new BadRequestException(
        "Analysis was manually edited; refuse automatic overwrite",
      );
    }

    const criteria = this.designedFrom(issue);
    const data = designAnalysis({
      title: issue.title,
      criteria,
      locale,
    });

    const saved = await this.prisma.requirementAnalysis.upsert({
      where: { jiraIssueId: issue.id },
      create: {
        jiraIssueId: issue.id,
        summary: data.summary,
        acceptanceCriteria: data.acceptanceCriteria,
        gaps: data.gaps,
        ambiguities: data.ambiguities,
        missingScenarios: data.missingScenarios,
        potentialRisks: data.potentialRisks,
        questionsProduct: data.questions.product,
        questionsDeveloper: data.questions.developer,
        questionsBusiness: data.questions.business,
      },
      update: {
        summary: data.summary,
        acceptanceCriteria: data.acceptanceCriteria,
        gaps: data.gaps,
        ambiguities: data.ambiguities,
        missingScenarios: data.missingScenarios,
        potentialRisks: data.potentialRisks,
        questionsProduct: data.questions.product,
        questionsDeveloper: data.questions.developer,
        questionsBusiness: data.questions.business,
      },
    });
    return { ...saved, provider: "heuristic" as const };
  }

  async generateStrategy(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    const issue = await this.ensureDesignedCriteria(
      await this.loadIssue(jiraIssueId),
      locale,
    );
    const existing = await this.prisma.testStrategy.findUnique({
      where: { jiraIssueId: issue.id },
    });
    if (existing?.manuallyEdited) {
      throw new BadRequestException(
        "Strategy was manually edited; refuse automatic overwrite",
      );
    }
    const data = designStrategy(issue.title, this.designedFrom(issue), locale);
    const saved = await this.prisma.testStrategy.upsert({
      where: { jiraIssueId: issue.id },
      create: {
        jiraIssueId: issue.id,
        scope: data.scope,
        objectives: data.objectives,
        testTypes: data.testTypes,
        environments: data.environments,
        dependencies: data.dependencies,
        assumptions: data.assumptions,
      },
      update: {
        scope: data.scope,
        objectives: data.objectives,
        testTypes: data.testTypes,
        environments: data.environments,
        dependencies: data.dependencies,
        assumptions: data.assumptions,
      },
    });
    return { ...saved, provider: "heuristic" as const };
  }

  async generateTestCases(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    const issue = await this.ensureDesignedCriteria(
      await this.loadIssue(jiraIssueId),
      locale,
    );
    const designedCases = designTestCases(
      issue.acceptanceCriteria.map((item) => ({
        key: item.key,
        text: item.text,
        origin: item.origin === "derived" ? "derived" : "cleaned",
        orderIndex: item.orderIndex,
      })),
      locale,
    );

    await this.prisma.testCase.deleteMany({
      where: { jiraIssueId: issue.id, manuallyEdited: false },
    });

    const ordered = [...designedCases].sort((left, right) => {
      const byAc =
        this.criterionOrder(issue.acceptanceCriteria, left.relatedAcceptanceCriteria) -
        this.criterionOrder(issue.acceptanceCriteria, right.relatedAcceptanceCriteria);
      if (byAc !== 0) return byAc;
      return this.caseRank(left.tags) - this.caseRank(right.tags);
    });

    const created = [];
    for (const tc of ordered) {
      const related = this.linkCriteria(
        issue.acceptanceCriteria,
        tc.relatedAcceptanceCriteria,
      );
      const row = await this.prisma.testCase.create({
        data: {
          jiraIssueId: issue.id,
          title: tc.title,
          description: tc.description,
          preconditions: tc.preconditions,
          steps: tc.steps,
          expectedResult: tc.expectedResult,
          priority: tc.priority,
          type: tc.type,
          tags: tc.tags,
          acceptanceLinks: {
            create: related.map((ac) => ({
              acceptanceCriterionId: ac.id,
            })),
          },
        },
      });
      created.push(row);
    }
    return { created, provider: "heuristic" as const };
  }

  async generateEdgeCases(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    const issue = await this.ensureDesignedCriteria(
      await this.loadIssue(jiraIssueId),
      locale,
    );
    const designed = designEdgeCases(this.designedFrom(issue), locale);
    await this.prisma.edgeCase.deleteMany({
      where: { jiraIssueId: issue.id, manuallyEdited: false },
    });
    const created = await Promise.all(
      designed.map((edge) =>
        this.prisma.edgeCase.create({
          data: {
            jiraIssueId: issue.id,
            title: edge.title,
            description: edge.description,
          },
        }),
      ),
    );
    return { created, provider: "heuristic" as const };
  }

  async generateRisks(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    const issue = await this.ensureDesignedCriteria(
      await this.loadIssue(jiraIssueId),
      locale,
    );
    const criteria = this.designedFrom(issue);
    const risks = designRisks(criteria, locale);
    await this.prisma.risk.deleteMany({
      where: { jiraIssueId: issue.id, manuallyEdited: false },
    });
    const created = [];
    for (const risk of risks) {
      created.push(
        await this.prisma.risk.create({
          data: {
            jiraIssueId: issue.id,
            description: risk.description,
            impact: risk.impact,
            likelihood: risk.likelihood,
            mitigation: risk.mitigation,
            releaseBlocking: risk.releaseBlocking,
            acceptanceKeys: risk.acceptanceKeys,
          },
        }),
      );
    }
    return { created, provider: "heuristic" as const };
  }

  async generateAutomation(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    const issue = await this.ensureDesignedCriteria(
      await this.loadIssue(jiraIssueId),
      locale,
    );
    const candidates = designAutomation(this.designedFrom(issue), locale);
    await this.prisma.automationCandidate.deleteMany({
      where: { jiraIssueId: issue.id, manuallyEdited: false },
    });
    const created = [];
    for (const candidate of candidates) {
      const match = issue.testCases.find(
        (testCase) =>
          testCase.title.toLowerCase().includes(candidate.relatedTestCaseTitle.toLowerCase()) ||
          candidate.relatedTestCaseTitle.toLowerCase().includes(testCase.title.toLowerCase()),
      );
      created.push(
        await this.prisma.automationCandidate.create({
          data: {
            jiraIssueId: issue.id,
            testCaseId: match?.id,
            recommendedLevel: candidate.recommendedLevel,
            apiUiRecommendation: candidate.apiUiRecommendation,
            reasoning: candidate.reasoning,
          },
        }),
      );
    }
    return { created, provider: "heuristic" as const };
  }

  async generateAll(jiraIssueId: string, localeInput?: unknown) {
    const locale = normalizeLocale(localeInput);
    // First localize source issue fields so Overview also becomes Persian
    await this.localizeIssueContent(jiraIssueId, locale);

    const analysis = await this.analyzeRequirements(jiraIssueId, locale);
    const strategy = await this.generateStrategy(jiraIssueId, locale);
    const testCases = await this.generateTestCases(jiraIssueId, locale);
    const edgeCases = await this.generateEdgeCases(jiraIssueId, locale);
    const risks = await this.generateRisks(jiraIssueId, locale);
    const automation = await this.generateAutomation(jiraIssueId, locale);
    return { analysis, strategy, testCases, edgeCases, risks, automation };
  }

  private async ensureDesignedCriteria(
    issue: Awaited<ReturnType<AnalysisService["loadIssue"]>>,
    locale: AppLocale,
  ) {
    const current = [...issue.acceptanceCriteria].sort(
      (left, right) => left.orderIndex - right.orderIndex,
    );
    const designed = designAcceptanceCriteria({
      title: issue.title,
      description: issue.description,
      rawCriteria: sourceCriteria(issue.rawAcceptanceText, current),
      locale,
    });
    if (current.length > 0 && current.every((item) => item.origin === "derived")) {
      for (const item of designed) item.origin = "derived";
    }
    const same =
      current.length === designed.length &&
      current.every(
        (item, index) =>
          item.key === designed[index]?.key &&
          item.text === designed[index]?.text &&
          item.origin === designed[index]?.origin,
      );
    if (same) return issue;

    const manual = await this.prisma.testCase.findMany({
      where: { jiraIssueId: issue.id, manuallyEdited: true },
      include: {
        acceptanceLinks: { include: { acceptanceCriterion: true } },
      },
    });
    const preserved = manual.flatMap((testCase) =>
      testCase.acceptanceLinks.map((link) => ({
        testCaseId: testCase.id,
        text: link.acceptanceCriterion.text,
        key: link.acceptanceCriterion.key,
      })),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.acceptanceCriterion.deleteMany({
        where: { jiraIssueId: issue.id },
      });
      await tx.acceptanceCriterion.createMany({
        data: designed.map((item) => ({
          jiraIssueId: issue.id,
          key: item.key,
          text: item.text,
          orderIndex: item.orderIndex,
          origin: item.origin,
        })),
      });
      if (!issue.rawAcceptanceText?.trim() && current.length > 0) {
        await tx.jiraIssue.update({
          where: { id: issue.id },
          data: {
            rawAcceptanceText: current.map((item) => item.text).join("\n"),
          },
        });
      }
    });

    if (preserved.length > 0) {
      const freshCriteria = await this.prisma.acceptanceCriterion.findMany({
        where: { jiraIssueId: issue.id },
      });
      for (const link of preserved) {
        const match = freshCriteria.find(
          (item) =>
            item.key === link.key ||
            item.text.toLowerCase() === link.text.toLowerCase() ||
            item.text.toLowerCase().includes(link.text.toLowerCase()),
        );
        if (!match) continue;
        await this.prisma.testCaseAcceptanceCriterion.createMany({
          data: [
            {
              testCaseId: link.testCaseId,
              acceptanceCriterionId: match.id,
            },
          ],
          skipDuplicates: true,
        });
      }
    }

    return this.loadIssue(issue.id);
  }

  private linkCriteria(
    criteria: Array<{ id: string; key: string; text: string }>,
    refs: string[],
  ) {
    const byKey = criteria.filter((item) => refs.includes(item.key));
    if (byKey.length > 0) return byKey;
    return criteria.filter((item) =>
      refs.some((ref) => {
        const left = ref.toLowerCase();
        const right = item.text.toLowerCase();
        return left === right || right.includes(left) || left.includes(right);
      }),
    );
  }

  private criterionOrder(
    criteria: Array<{ key: string; text: string; orderIndex: number }>,
    refs: string[],
  ) {
    const indexes = refs
      .map((ref) =>
        criteria.findIndex(
          (item) => item.key === ref || item.text.toLowerCase() === ref.toLowerCase(),
        ),
      )
      .filter((index) => index >= 0);
    return indexes.length > 0 ? Math.min(...indexes) : 999;
  }

  private caseRank(tags: string[]) {
    if (tags.includes("negative")) return 1;
    if (tags.includes("boundary")) return 2;
    return 0;
  }
}
