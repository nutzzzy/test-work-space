"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

type Bug = {
  id: string;
  title: string;
  description: string;
  severity: string;
  priority: string;
  expectedResult?: string;
  actualResult?: string;
  testCase?: { title: string } | null;
  testRun?: { id: string; status: string } | null;
};

type TestCase = { id: string; title: string };

export default function BugsPage() {
  const { t, label } = useI18n();
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("");
  const [priority, setPriority] = useState("");
  const [testCaseId, setTestCaseId] = useState("");
  const [actualResult, setActualResult] = useState("");

  const reload = async () => {
    const [bugList, caseList] = await Promise.all([
      api<Bug[]>("/bugs"),
      api<TestCase[]>("/test-cases"),
    ]);
    setBugs(bugList);
    setCases(caseList);
  };

  useEffect(() => {
    void reload().catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("bugs.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("bugs.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("bugs.createBug")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{t("jira.titleField")}</span>
            <input
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
              placeholder={t("jira.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">
              {t("bugs.actualResult")}
            </span>
            <textarea
              className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder={t("bugs.actualResultHint")}
              value={actualResult}
              onChange={(e) => setActualResult(e.target.value)}
            />
          </label>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{t("bugs.severity")}</span>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="">{t("common.select")}</option>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
                  <option key={s} value={s}>
                    {label("level", s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{t("bugs.priority")}</span>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">{t("common.select")}</option>
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
                  <option key={s} value={s}>
                    {label("level", s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{t("bugs.testCase")}</span>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={testCaseId}
                onChange={(e) => setTestCaseId(e.target.value)}
              >
                <option value="">{t("common.select")}</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            onClick={async () => {
              if (!title.trim() || !severity || !priority) return;
              await api("/bugs", {
                method: "POST",
                body: JSON.stringify({
                  title,
                  severity,
                  priority,
                  actualResult,
                  testCaseId: testCaseId || undefined,
                  reproductionSteps: [],
                }),
              });
              setTitle("");
              setActualResult("");
              setSeverity("");
              setPriority("");
              setTestCaseId("");
              await reload();
            }}
            disabled={!title.trim() || !severity || !priority}
          >
            {t("common.create")}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {bugs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
        ) : null}
        {bugs.map((bug) => (
          <Card key={bug.id}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Badge>{label("level", bug.severity)}</Badge>
                <Badge>{label("level", bug.priority)}</Badge>
              </div>
              <div className="mt-2 text-sm">{bug.title}</div>
              {bug.testCase ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("bugs.linkedCase", { title: bug.testCase.title })}
                </div>
              ) : null}
              {bug.actualResult ? (
                <div className="mt-1 text-xs text-destructive">
                  {bug.actualResult}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
