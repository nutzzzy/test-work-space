import type { NormalizedJiraIssue } from "@qa-workbench/shared";

export type JiraCredentials = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

export interface JiraAdapter {
  fetchIssue(key: string): Promise<NormalizedJiraIssue>;
}

const AC_SECTION =
  /acceptance\s*criteria[:\s]*([\s\S]*?)(?=\n#{1,3}\s|\n[A-Z][a-z]+ ?:|\n---|\n\*\*[A-Z]|$)/i;

function extractAcceptanceCriteria(description: string): string[] {
  const fromSection = description.match(AC_SECTION)?.[1] ?? description;
  const lines = fromSection
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 3);

  const unique = [...new Set(lines)].slice(0, 30);
  if (unique.length > 0) return unique;
  return description.trim() ? [description.trim().slice(0, 500)] : [];
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export class HttpJiraAdapter implements JiraAdapter {
  constructor(private readonly credentials: JiraCredentials) {}

  async fetchIssue(key: string): Promise<NormalizedJiraIssue> {
    const base = this.credentials.baseUrl.replace(/\/$/, "");
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,priority,labels,issuelinks`;
    const auth = Buffer.from(
      `${this.credentials.email}:${this.credentials.apiToken}`,
    ).toString("base64");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Jira API error ${response.status} for ${key}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      key: string;
      fields: {
        summary?: string;
        description?: unknown;
        issuetype?: { name?: string };
        priority?: { name?: string };
        labels?: string[];
        issuelinks?: Array<{
          type?: { name?: string };
          inwardIssue?: { key?: string; fields?: { summary?: string } };
          outwardIssue?: { key?: string; fields?: { summary?: string } };
        }>;
      };
    };

    const description = normalizeDescription(data.fields.description);
    const linkedIssues: NormalizedJiraIssue["linkedIssues"] = [];
    for (const link of data.fields.issuelinks ?? []) {
      const issue = link.outwardIssue ?? link.inwardIssue;
      if (issue?.key) {
        linkedIssues.push({
          key: issue.key,
          type: link.type?.name,
          summary: issue.fields?.summary,
        });
      }
    }

    return {
      key: data.key,
      title: data.fields.summary ?? key,
      description,
      issueType: data.fields.issuetype?.name,
      priority: data.fields.priority?.name,
      labels: data.fields.labels ?? [],
      acceptanceCriteria: extractAcceptanceCriteria(description),
      linkedIssues,
    };
  }
}

function normalizeDescription(description: unknown): string {
  if (!description) return "";
  if (typeof description === "string") return stripHtml(description);
  // ADF (Atlassian Document Format) — flatten text nodes
  try {
    const texts: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && n.text) texts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(description);
    return texts.join(" ").trim();
  } catch {
    return "";
  }
}

export function createJiraAdapter(credentials: JiraCredentials): JiraAdapter {
  return new HttpJiraAdapter(credentials);
}

export { extractAcceptanceCriteria };
