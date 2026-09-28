"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBanner } from "@/components/ui/progress";
import { useAsyncProgress } from "@/hooks/use-async-progress";
import { useI18n } from "@/lib/i18n";

type Issue = {
  id: string;
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: Array<{
    id: string;
    key: string;
    text: string;
    origin?: string;
  }>;
  requirementAnalysis: {
    summary: string;
    gaps: string[];
    ambiguities: string[];
    missingScenarios: string[];
    potentialRisks: string[];
    questionsProduct: string[];
    questionsDeveloper: string[];
    questionsBusiness: string[];
  } | null;
  testStrategy: {
    scope: string;
    objectives: string[];
    testTypes: string[];
    environments: string[];
    dependencies: string[];
    assumptions: string[];
  } | null;
  testCases: Array<{
    id: string;
    title: string;
    priority: string;
    type: string;
    steps: string[];
    expectedResult: string;
    preconditions: string[];
    tags?: string[];
    acceptanceLinks: Array<{
      acceptanceCriterion: { key: string; text: string };
    }>;
    runs: Array<{
      id: string;
      status: string;
      notes?: string | null;
      evidence?: string | null;
      executedAt: string;
    }>;
  }>;
  edgeCases: Array<{ id: string; title: string; description: string }>;
  risks: Array<{
    id: string;
    description: string;
    impact: string;
    likelihood: string;
    mitigation: string;
    releaseBlocking?: boolean;
    acceptanceKeys?: string[];
  }>;
  automationCandidates: Array<{
    id: string;
    recommendedLevel: string;
    apiUiRecommendation: string;
    reasoning: string;
  }>;
  bugs: Array<{
    id: string;
    title: string;
    severity: string;
    testCaseId?: string | null;
  }>;
};

type Traceability = {
  coverage: {
    acceptanceTotal: number;
    acceptanceCovered: number;
    requirementCoverage: number;
  };
  nodes: Array<{
    id: string;
    key: string;
    text: string;
    testCases: Array<{
      id: string;
      title: string;
      latestStatus: string;
      bugs: Array<{ id: string; title: string; severity: string }>;
      automationCandidates: Array<{ id: string; apiUiRecommendation: string }>;
    }>;
  }>;
  unlinkedTestCases: Array<{ id: string; title: string; latestStatus: string }>;
};

const TAB_IDS = [
  "overview",
  "requirements",
  "strategy",
  "testCases",
  "edgeCases",
  "risks",
  "automation",
  "traceability",
  "runs",
  "bugs",
] as const;

type TabId = (typeof TAB_IDS)[number];

const TAB_LABEL_KEYS: Record<TabId, string> = {
  overview: "workspace.tabOverview",
  requirements: "workspace.tabRequirements",
  strategy: "workspace.tabStrategy",
  testCases: "workspace.tabTestCases",
  edgeCases: "workspace.tabEdgeCases",
  risks: "workspace.tabRisks",
  automation: "workspace.tabAutomation",
  traceability: "workspace.tabTraceability",
  runs: "workspace.tabRuns",
  bugs: "workspace.tabBugs",
};

const STATUSES = ["PASSED", "FAILED", "BLOCKED", "SKIPPED"] as const;

export default function WorkspaceDetailPage() {
  const { t, n, d, locale, label, err } = useI18n();
  const progress = useAsyncProgress();
  const params = useParams<{ key: string }>();
  const issueKey = String(params?.key ?? "");
  const [tab, setTab] = useState<TabId>("overview");
  const [issue, setIssue] = useState<Issue | null>(null);
  const [trace, setTrace] = useState<Traceability | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({
    title: "",
    acceptanceKey: "",
    preconditions: "",
    steps: "",
    expectedResult: "",
    priority: "MEDIUM",
  });

  const busy = progress.busy;

  const statusLabel = (status: string) => {
    const key = `status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };

  const reload = async () => {
    if (!issueKey) return;
    const data = await api<Issue>(`/jira/issues/${issueKey}`);
    setIssue(data);
    const tree = await api<Traceability>(`/traceability/${data.id}`);
    setTrace(tree);
  };

  useEffect(() => {
    if (!issueKey) return;
    let alive = true;
    setMessage(null);
    (async () => {
      try {
        let data = await api<Issue>(`/jira/issues/${issueKey}`);
        if (!alive) return;

        // When UI is Persian, localize stored English issue text and refresh
        // English heuristic analysis so overview/analysis tabs are not bilingual.
        if (locale === "fa") {
          try {
            await api(`/analysis/${data.id}/localize`, {
              method: "POST",
              body: JSON.stringify({ locale: "fa" }),
            });
            const analysis = data.requirementAnalysis;
            const looksEnglish =
              !!analysis &&
              (/^[A-Za-z]/.test(analysis.summary) ||
                analysis.gaps.some((g) => /^[A-Za-z]/.test(g)));
            if (looksEnglish) {
              await api(`/analysis/${data.id}/requirements`, {
                method: "POST",
                body: JSON.stringify({ locale: "fa" }),
              });
            }
            data = await api<Issue>(`/jira/issues/${issueKey}`);
          } catch {
            // keep raw issue if localize/analyze unavailable
          }
        }

        if (!alive) return;
        setIssue(data);
        try {
          const tree = await api<Traceability>(`/traceability/${data.id}`);
          if (alive) setTrace(tree);
        } catch {
          // optional
        }
      } catch (e) {
        if (alive)
          setMessage(
            e instanceof Error ? e.message : t("common.loadFailed"),
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [issueKey, t, locale]);

  const generate = async (path: string) => {
    if (!issue) return;
    setMessage(null);
    try {
      await progress.run(
        [
          { to: 20, label: t("common.processing") },
          { to: 55, label: t("workspace.aiStep", { path }) },
          { to: 85, label: t("jira.progressReload") },
        ],
        async () => {
          await api(`/analysis/${issue.id}/${path}`, {
            method: "POST",
            body: JSON.stringify({ locale }),
          });
          await reload();
        },
        { successLabel: t("common.progressDone") },
      );
      setMessage(t("workspace.generated", { path }));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : t("workspace.generationFailed"),
      );
    }
  };

  const runCase = async (testCaseId: string, status: string) => {
    try {
      await progress.run(
        [
          { to: 30, label: t("common.processing") },
          { to: 70, label: statusLabel(status) },
          { to: 90, label: t("jira.progressReload") },
        ],
        async () => {
          const run = await api<{ id: string }>("/test-runs", {
            method: "POST",
            body: JSON.stringify({
              testCaseId,
              status,
              notes: notes[testCaseId] || undefined,
              evidence: evidence[testCaseId] || undefined,
            }),
          });
          if (status === "FAILED") {
            await api(`/bugs/from-run/${run.id}`, {
              method: "POST",
              body: "{}",
            });
          }
          await reload();
        },
        { successLabel: t("common.progressDone") },
      );
      setMessage(
        t("workspace.recorded", { status: statusLabel(status) }),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("workspace.runFailed"));
    }
  };

  if (!issue) {
    return (
      <p className="text-sm text-muted-foreground">
        {message ??
          (issueKey
            ? t("workspace.loading", { key: issueKey })
            : t("workspace.missingKey"))}
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <ProgressBanner
        active={progress.active}
        value={progress.percent}
        label={progress.label || t("common.processing")}
        error={progress.error}
        success={progress.success}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="dir-ltr inline-block font-mono text-xs text-primary">
            {issue.key}
          </div>
          <h1 className="break-words text-lg font-semibold">{issue.title}</h1>
          {trace ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {t("workspace.coverageLine", {
                pct: n(trace.coverage.requirementCoverage),
                covered: n(trace.coverage.acceptanceCovered),
                total: n(trace.coverage.acceptanceTotal),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border pb-2">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`shrink-0 rounded px-2.5 py-1 text-xs transition-colors ${
              tab === id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {t(TAB_LABEL_KEYS[id])}
          </button>
        ))}
      </div>

      {message ? <p className="text-xs text-muted-foreground">{err(message)}</p> : null}

      {tab === "overview" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{issue.description}</p>
          <ReleaseGate issue={issue} />
          <div className="space-y-1">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("workspace.acHeading")}
            </h2>
            {issue.acceptanceCriteria.map((ac) => (
              <div
                key={ac.id}
                className="rounded border border-border px-2 py-1.5 text-sm"
              >
                <span className="dir-ltr inline-block font-mono text-xs text-primary">
                  {ac.key}
                </span>{" "}
                {ac.text}
                <AcOrigin origin={ac.origin} />
              </div>
            ))}
          </div>
          <Button disabled={busy} onClick={() => generate("all")}>
            {t("workspace.generateAll")}
          </Button>
        </div>
      )}

      {tab === "requirements" &&
        (issue.requirementAnalysis ? (
          <div className="grid gap-3 md:grid-cols-2">
            <List
              title={t("workspace.summary")}
              items={[issue.requirementAnalysis.summary]}
            />
            <List
              title={t("workspace.gaps")}
              items={issue.requirementAnalysis.gaps}
            />
            <List
              title={t("workspace.ambiguities")}
              items={issue.requirementAnalysis.ambiguities}
            />
            <List
              title={t("workspace.missingScenarios")}
              items={issue.requirementAnalysis.missingScenarios}
            />
            <List
              title={t("workspace.questionsProduct")}
              items={issue.requirementAnalysis.questionsProduct}
            />
            <List
              title={t("workspace.questionsDeveloper")}
              items={issue.requirementAnalysis.questionsDeveloper}
            />
            <List
              title={t("workspace.questionsBusiness")}
              items={issue.requirementAnalysis.questionsBusiness}
            />
          </div>
        ) : (
          <Button disabled={busy} onClick={() => generate("requirements")}>
            {t("workspace.analyzeRequirements")}
          </Button>
        ))}

      {tab === "strategy" &&
        (issue.testStrategy ? (
          <div className="grid gap-3 md:grid-cols-2">
            <List
              title={t("workspace.scope")}
              items={[issue.testStrategy.scope]}
            />
            <List
              title={t("workspace.objectives")}
              items={issue.testStrategy.objectives}
            />
            <List
              title={t("workspace.testTypes")}
              items={issue.testStrategy.testTypes}
            />
            <List
              title={t("workspace.environments")}
              items={issue.testStrategy.environments}
            />
            <List
              title={t("workspace.dependencies")}
              items={issue.testStrategy.dependencies}
            />
            <List
              title={t("workspace.assumptions")}
              items={issue.testStrategy.assumptions}
            />
          </div>
        ) : (
          <Button disabled={busy} onClick={() => generate("strategy")}>
            {t("workspace.generateStrategy")}
          </Button>
        ))}

      {tab === "testCases" && (
        <div className="space-y-3">
          <Button disabled={busy} onClick={() => generate("test-cases")}>
            {t("workspace.generateTestCases")}
          </Button>
          <Card>
            <CardHeader>
              <CardTitle>{t("workspace.manualCase")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("workspace.manualCaseHint")}
              </p>
              <input
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={manual.title}
                placeholder={t("common.name")}
                onChange={(event) =>
                  setManual((prev) => ({ ...prev, title: event.target.value }))
                }
              />
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                  value={manual.acceptanceKey}
                  onChange={(event) =>
                    setManual((prev) => ({
                      ...prev,
                      acceptanceKey: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("workspace.criterion")}</option>
                  {issue?.acceptanceCriteria.map((criterion) => (
                    <option key={criterion.id} value={criterion.key}>
                      {criterion.key}
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                  value={manual.priority}
                  onChange={(event) =>
                    setManual((prev) => ({
                      ...prev,
                      priority: event.target.value,
                    }))
                  }
                >
                  {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((priority) => (
                    <option key={priority} value={priority}>
                      {label("level", priority)}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={manual.preconditions}
                placeholder={t("workspace.manualPreconditionsHint")}
                onChange={(event) =>
                  setManual((prev) => ({
                    ...prev,
                    preconditions: event.target.value,
                  }))
                }
              />
              <textarea
                className="min-h-20 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={manual.steps}
                placeholder={t("workspace.manualStepsHint")}
                onChange={(event) =>
                  setManual((prev) => ({ ...prev, steps: event.target.value }))
                }
              />
              <textarea
                className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={manual.expectedResult}
                placeholder={t("common.expected")}
                onChange={(event) =>
                  setManual((prev) => ({
                    ...prev,
                    expectedResult: event.target.value,
                  }))
                }
              />
              <Button
                disabled={
                  busy ||
                  !manual.title.trim() ||
                  !manual.steps.trim() ||
                  !manual.expectedResult.trim()
                }
                onClick={() => {
                  if (!issue) return;
                  void (async () => {
                    setMessage(null);
                    try {
                      await api("/test-cases", {
                        method: "POST",
                        body: JSON.stringify({
                          jiraIssueId: issue.id,
                          title: manual.title,
                          acceptanceKey: manual.acceptanceKey || undefined,
                          preconditions: manual.preconditions
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                          steps: manual.steps
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                          expectedResult: manual.expectedResult,
                          priority: manual.priority,
                        }),
                      });
                      setManual({
                        title: "",
                        acceptanceKey: "",
                        preconditions: "",
                        steps: "",
                        expectedResult: "",
                        priority: "MEDIUM",
                      });
                      await reload();
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : t("workspace.generationFailed"),
                      );
                    }
                  })();
                }}
              >
                {t("workspace.saveCase")}
              </Button>
            </CardContent>
          </Card>
          {groupCases(issue).map((group) => (
            <div key={group.key} className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground">
                {group.key === "unlinked" ? (
                  t("workspace.unlinkedGroup")
                ) : (
                  <>
                    <span className="dir-ltr inline-block font-mono text-primary">
                      {group.key}
                    </span>{" "}
                    {group.text}
                  </>
                )}
              </h2>
              {group.cases.map((tc) => (
            <Card key={tc.id}>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium leading-6 break-words" dir="auto">
                  {tc.title}
                </div>
                  <StatusBadge
                    status={tc.runs[0]?.status ?? "NOT_RUN"}
                    label={statusLabel(tc.runs[0]?.status ?? "NOT_RUN")}
                  />
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {label("level", tc.priority)} · {label("level", tc.type)}
                  {tc.acceptanceLinks?.length
                    ? ` · ${tc.acceptanceLinks.map((l) => l.acceptanceCriterion.key).join(", ")}`
                    : ""}
                </div>
                {tc.preconditions?.length ? (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("common.preconditions")}
                    </div>
                    {tc.preconditions.map((item) => (
                      <p key={item} dir="auto" className="text-xs leading-5">
                        {item}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("common.steps")}
                  </div>
                  {(Array.isArray(tc.steps) ? tc.steps : []).map((step, index) => (
                    <p key={step} dir="auto" className="text-xs leading-5">
                      <span className="font-mono text-muted-foreground">
                        {n(index + 1)}.
                      </span>{" "}
                      {step}
                    </p>
                  ))}
                </div>
                <p dir="auto" className="text-xs leading-5">
                  <span className="text-muted-foreground">
                    {t("common.expected")}:
                  </span>{" "}
                  {tc.expectedResult}
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="h-7 rounded border border-border bg-background px-2 text-xs"
                    placeholder={t("common.notes")}
                    value={notes[tc.id] ?? ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [tc.id]: e.target.value }))
                    }
                  />
                  <input
                    className="h-7 rounded border border-border bg-background px-2 text-xs"
                    placeholder={t("common.evidence")}
                    value={evidence[tc.id] ?? ""}
                    onChange={(e) =>
                      setEvidence((prev) => ({
                        ...prev,
                        [tc.id]: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {STATUSES.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => runCase(tc.id, s)}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "edgeCases" && (
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => generate("edge-cases")}>
            {t("workspace.generateEdgeCases")}
          </Button>
          {issue.edgeCases.map((e) => (
            <Card key={e.id}>
              <CardContent className="p-3">
                <div className="text-sm font-medium">{e.title}</div>
                <p
                  dir="auto"
                  className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground"
                >
                  {e.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "risks" && (
        <div className="space-y-3">
          <Button disabled={busy} onClick={() => generate("risks")}>
            {t("workspace.generateRisks")}
          </Button>
          <ReleaseGate issue={issue} />
          {issue.risks.filter((risk) => !risk.releaseBlocking).length > 0 ? (
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("workspace.otherRisks")}
            </h2>
          ) : null}
          {issue.risks
            .filter((risk) => !risk.releaseBlocking)
            .map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{label("level", r.impact)}</Badge>
                  <Badge>{label("level", r.likelihood)}</Badge>
                </div>
                <p className="mt-2">{r.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.mitigation}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "automation" && (
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => generate("automation")}>
            {t("workspace.suggestAutomation")}
          </Button>
          {issue.automationCandidates.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-3 text-sm">
                <div className="flex gap-2">
                  <Badge>{label("level", c.recommendedLevel)}</Badge>
                  <Badge>{label("level", c.apiUiRecommendation)}</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{c.reasoning}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "traceability" && (
        <div className="space-y-3">
          <Card>
            <CardContent className="flex items-center justify-between p-3 text-sm">
              <span className="text-muted-foreground">
                {t("workspace.requirementCoverage")}
              </span>
              <span className="font-mono text-primary">
                {n(trace?.coverage.requirementCoverage ?? 0)}%
              </span>
            </CardContent>
          </Card>
          {(trace?.nodes ?? []).map((ac) => (
            <Card key={ac.id}>
              <CardHeader>
                <CardTitle>
                  <span className="dir-ltr inline-block font-mono text-primary">
                    {ac.key}
                  </span>{" "}
                  {ac.text}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ac.testCases.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("workspace.noLinkedCases")}
                  </p>
                ) : (
                  ac.testCases.map((tc) => (
                    <div
                      key={tc.id}
                      className="rounded border border-border px-2.5 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{tc.title}</span>
                        <StatusBadge
                          status={tc.latestStatus}
                          label={statusLabel(tc.latestStatus)}
                        />
                      </div>
                      {tc.bugs.map((b) => (
                        <div
                          key={b.id}
                          className="mt-1 font-mono text-[11px] text-destructive"
                        >
                          → {b.title} [{label("level", b.severity)}]
                        </div>
                      ))}
                      {tc.automationCandidates.map((a) => (
                        <div
                          key={a.id}
                          className="mt-1 font-mono text-[11px] text-muted-foreground"
                        >
                          →{" "}
                          {t("workspace.automationCandidate", {
                            kind: label("level", a.apiUiRecommendation),
                          })}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
          {(trace?.unlinkedTestCases.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("workspace.unlinkedCases")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {trace?.unlinkedTestCases.map((tc) => (
                  <div key={tc.id} className="flex justify-between text-sm">
                    <span>{tc.title}</span>
                    <StatusBadge
                      status={tc.latestStatus}
                      label={statusLabel(tc.latestStatus)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {tab === "runs" && (
        <div className="space-y-2">
          {issue.testCases.flatMap((tc) =>
            tc.runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded border border-border px-2.5 py-2 text-sm"
              >
                <div>
                  <div>{tc.title}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {d(run.executedAt)}
                    {run.notes ? ` · ${run.notes}` : ""}
                  </div>
                </div>
                <StatusBadge
                  status={run.status}
                  label={statusLabel(run.status)}
                />
              </div>
            )),
          )}
          {issue.testCases.every((tc) => tc.runs.length === 0) ? (
            <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
          ) : null}
        </div>
      )}

      {tab === "bugs" && (
        <div className="space-y-2">
          {issue.bugs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("workspace.noBugsYet")}
            </p>
          ) : (
            issue.bugs.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded border border-border px-2.5 py-2 text-sm"
              >
                <span>{b.title}</span>
                <Badge>{label("level", b.severity)}</Badge>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function groupCases(issue: Issue) {
  const rank = (tags: string[] | undefined) =>
    tags?.includes("negative") ? 1 : tags?.includes("boundary") ? 2 : 0;
  const groups = issue.acceptanceCriteria.map((ac) => ({
    key: ac.key,
    text: ac.text,
    cases: issue.testCases
      .filter((testCase) =>
        testCase.acceptanceLinks.some(
          (link) => link.acceptanceCriterion.key === ac.key,
        ),
      )
      .sort((left, right) => rank(left.tags) - rank(right.tags)),
  }));
  const linked = new Set(
    groups.flatMap((group) => group.cases.map((testCase) => testCase.id)),
  );
  const unlinked = issue.testCases.filter((testCase) => !linked.has(testCase.id));
  const visible = groups.filter((group) => group.cases.length > 0);
  if (unlinked.length > 0) {
    visible.push({ key: "unlinked", text: "", cases: unlinked });
  }
  return visible;
}

function AcOrigin({ origin }: { origin?: string }) {
  const { t } = useI18n();
  if (origin !== "derived" && origin !== "cleaned") return null;
  return (
    <Badge className="ms-2">
      {origin === "derived" ? t("workspace.acDerived") : t("workspace.acCleaned")}
    </Badge>
  );
}

function ReleaseGate({ issue }: { issue: Issue }) {
  const { t } = useI18n();
  const blocking = issue.risks.filter((risk) => risk.releaseBlocking);
  return (
    <Card className={blocking.length > 0 ? "border-destructive/50" : undefined}>
      <CardHeader>
        <CardTitle>{t("workspace.releaseGate")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {blocking.length > 0
            ? t("workspace.releaseGateBody")
            : t("workspace.releaseGateEmpty")}
        </p>
        {blocking.map((risk) => (
          <div
            key={risk.id}
            className="rounded border border-border px-2 py-1.5 text-sm"
          >
            <div className="mb-1 flex flex-wrap gap-1">
              <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
                {t("workspace.blocksProduction")}
              </Badge>
              {(risk.acceptanceKeys ?? []).map((key) => (
                <span
                  key={key}
                  className="dir-ltr inline-flex items-center rounded border border-border px-1.5 font-mono text-[10px]"
                >
                  {key}
                </span>
              ))}
            </div>
            <p>{risk.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item) => (
          <div key={item} className="text-sm text-muted-foreground">
            • {item}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "PASSED"
      ? "border-success/40 bg-success/10 text-success"
      : status === "FAILED"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : status === "BLOCKED"
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-border bg-secondary text-muted-foreground";
  return <Badge className={tone}>{label}</Badge>;
}
