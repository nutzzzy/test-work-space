import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NormalizedJiraIssue } from "@qa-workbench/shared";
import * as XLSX from "xlsx";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret, encryptSecret } from "../common/crypto.util";
import { createJiraAdapter } from "./jira.adapter";
import {
  rowsToIssues,
  SPREADSHEET_TEMPLATE_HEADERS,
  SPREADSHEET_TEMPLATE_SAMPLE,
  type SpreadsheetIssueRow,
} from "./spreadsheet-import";

@Injectable()
export class JiraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey() {
    return this.config.get<string>(
      "SECRETS_ENCRYPTION_KEY",
      "change-me-to-a-long-random-secret-key",
    );
  }

  async getConfigPublic() {
    const cfg = await this.prisma.jiraConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (!cfg) return null;
    return {
      id: cfg.id,
      baseUrl: cfg.baseUrl,
      email: cfg.email,
      projectKey: cfg.projectKey,
      hasToken: Boolean(cfg.apiTokenEnc),
      updatedAt: cfg.updatedAt,
    };
  }

  async upsertConfig(input: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey?: string;
  }) {
    if (!input.baseUrl || !input.email || !input.apiToken) {
      throw new BadRequestException("baseUrl, email and apiToken are required");
    }
    const enc = encryptSecret(input.apiToken, this.encryptionKey());
    const existing = await this.prisma.jiraConfig.findFirst();
    if (existing) {
      return this.prisma.jiraConfig.update({
        where: { id: existing.id },
        data: {
          baseUrl: input.baseUrl.replace(/\/$/, ""),
          email: input.email,
          apiTokenEnc: enc,
          projectKey: input.projectKey || null,
        },
      });
    }
    return this.prisma.jiraConfig.create({
      data: {
        baseUrl: input.baseUrl.replace(/\/$/, ""),
        email: input.email,
        apiTokenEnc: enc,
        projectKey: input.projectKey || null,
      },
    });
  }

  private async getCredentials() {
    const cfg = await this.prisma.jiraConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (!cfg) {
      throw new BadRequestException("Jira is not configured");
    }
    return {
      baseUrl: cfg.baseUrl,
      email: cfg.email,
      apiToken: decryptSecret(cfg.apiTokenEnc, this.encryptionKey()),
    };
  }

  async upsertNormalizedIssue(issue: NormalizedJiraIssue | SpreadsheetIssueRow) {
    const key = issue.key.trim().toUpperCase();
    if (!key || !issue.title.trim()) {
      throw new BadRequestException("key and title are required");
    }

    const acceptanceCriteria = issue.acceptanceCriteria ?? [];
    const labels = issue.labels ?? [];
    const linkedIssues =
      "linkedIssues" in issue ? (issue.linkedIssues ?? []) : [];

    const existing = await this.prisma.jiraIssue.findUnique({ where: { key } });

    if (existing) {
      await this.prisma.acceptanceCriterion.deleteMany({
        where: { jiraIssueId: existing.id },
      });
      await this.prisma.jiraIssue.update({
        where: { id: existing.id },
        data: {
          title: issue.title,
          description: issue.description ?? "",
          issueType: issue.issueType,
          priority: issue.priority,
          labels,
          rawAcceptanceText: acceptanceCriteria.join("\n"),
          linkedIssuesJson: linkedIssues,
          acceptanceCriteria: {
            create: acceptanceCriteria.map((text, index) => ({
              key: `AC-${index + 1}`,
              text,
              orderIndex: index,
            })),
          },
        },
      });
      return this.getIssue(existing.id);
    }

    const created = await this.prisma.jiraIssue.create({
      data: {
        key,
        title: issue.title,
        description: issue.description ?? "",
        issueType: issue.issueType,
        priority: issue.priority,
        labels,
        rawAcceptanceText: acceptanceCriteria.join("\n"),
        linkedIssuesJson: linkedIssues,
        acceptanceCriteria: {
          create: acceptanceCriteria.map((text, index) => ({
            key: `AC-${index + 1}`,
            text,
            orderIndex: index,
          })),
        },
      },
    });
    return this.getIssue(created.id);
  }

  async createManualIssue(input: {
    key: string;
    title: string;
    description?: string;
    issueType?: string;
    priority?: string;
    labels?: string[];
    acceptanceCriteria?: string[];
  }) {
    return this.upsertNormalizedIssue({
      key: input.key,
      title: input.title,
      description: input.description ?? "",
      issueType: input.issueType,
      priority: input.priority,
      labels: input.labels ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      linkedIssues: [],
    });
  }

  async importFromSpreadsheet(buffer: Buffer, filename: string) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException("Spreadsheet has no sheets");
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    const parsed = rowsToIssues(rows);
    if (parsed.length === 0) {
      throw new BadRequestException(
        "No valid rows found. Need at least key + title columns.",
      );
    }

    const imported = [];
    for (const row of parsed) {
      imported.push(await this.upsertNormalizedIssue(row));
    }

    return {
      filename,
      importedCount: imported.length,
      keys: imported.map((i) => i.key),
      issues: imported,
    };
  }

  buildTemplateBuffer(format: "csv" | "xlsx" = "xlsx") {
    const rows: string[][] = [
      [...SPREADSHEET_TEMPLATE_HEADERS],
      [...SPREADSHEET_TEMPLATE_SAMPLE],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "issues");
    const bookType = format === "csv" ? "csv" : "xlsx";
    return XLSX.write(book, { type: "buffer", bookType }) as Buffer;
  }

  async importIssue(key: string) {
    const normalizedKey = key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(normalizedKey)) {
      throw new BadRequestException("Invalid issue key format");
    }

    const credentials = await this.getCredentials();
    const adapter = createJiraAdapter(credentials);
    const issue = await adapter.fetchIssue(normalizedKey);
    return this.upsertNormalizedIssue(issue);
  }

  async updateIssue(
    id: string,
    input: {
      key: string;
      title: string;
      description?: string;
      priority?: string;
      acceptanceCriteria?: string[];
    },
  ) {
    const existing = await this.prisma.jiraIssue.findUnique({
      where: { id },
      include: { acceptanceCriteria: { orderBy: { orderIndex: "asc" } } },
    });
    if (!existing) throw new NotFoundException("Issue not found");

    const key = input.key.trim().toUpperCase();
    const title = input.title.trim();
    if (!key || !title) {
      throw new BadRequestException("key and title are required");
    }
    if (!/^[A-Z][A-Z0-9]*-[A-Z0-9]+$/.test(key)) {
      throw new BadRequestException("Invalid issue key format");
    }
    if (key !== existing.key) {
      const clash = await this.prisma.jiraIssue.findUnique({ where: { key } });
      if (clash) throw new BadRequestException("Issue key already exists");
    }

    const acceptanceCriteria = (input.acceptanceCriteria ?? [])
      .map((text) => text.trim())
      .filter(Boolean);
    const currentTexts = existing.acceptanceCriteria.map((item) => item.text);
    const criteriaChanged =
      currentTexts.length !== acceptanceCriteria.length ||
      currentTexts.some((text, index) => text !== acceptanceCriteria[index]);

    await this.prisma.jiraIssue.update({
      where: { id },
      data: {
        key,
        title,
        description: input.description ?? "",
        priority: input.priority?.trim() || null,
        rawAcceptanceText: acceptanceCriteria.join("\n"),
        ...(criteriaChanged
          ? {
              acceptanceCriteria: {
                deleteMany: {},
                create: acceptanceCriteria.map((text, index) => ({
                  key: `AC-${index + 1}`,
                  text,
                  orderIndex: index,
                })),
              },
            }
          : {}),
      },
    });
    return this.getIssue(id);
  }

  async deleteIssue(id: string) {
    const existing = await this.prisma.jiraIssue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Issue not found");

    await this.prisma.$transaction(async (tx) => {
      const cases = await tx.testCase.findMany({
        where: { jiraIssueId: id },
        select: { id: true },
      });
      const caseIds = cases.map((item) => item.id);
      await tx.bug.deleteMany({
        where: {
          OR: [
            { jiraIssueId: id },
            ...(caseIds.length ? [{ testCaseId: { in: caseIds } }] : []),
          ],
        },
      });
      await tx.testCase.deleteMany({ where: { jiraIssueId: id } });
      await tx.jiraIssue.delete({ where: { id } });
    });

    return { deleted: true, id, key: existing.key };
  }

  async listIssues() {
    return this.prisma.jiraIssue.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        acceptanceCriteria: { orderBy: { orderIndex: "asc" } },
        _count: { select: { testCases: true, risks: true, bugs: true } },
      },
    });
  }

  async getIssue(idOrKey: string) {
    const issue = await this.prisma.jiraIssue.findFirst({
      where: {
        OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }],
      },
      include: {
        acceptanceCriteria: { orderBy: { orderIndex: "asc" } },
        requirementAnalysis: true,
        testStrategy: true,
        testCases: {
          include: {
            acceptanceLinks: { include: { acceptanceCriterion: true } },
            runs: { orderBy: { executedAt: "desc" }, take: 20 },
          },
          orderBy: { createdAt: "asc" },
        },
        edgeCases: { orderBy: { createdAt: "asc" } },
        risks: {
          orderBy: [{ releaseBlocking: "desc" }, { createdAt: "asc" }],
        },
        automationCandidates: { orderBy: { createdAt: "asc" } },
        bugs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!issue) throw new NotFoundException("Issue not found");
    return issue;
  }
}
