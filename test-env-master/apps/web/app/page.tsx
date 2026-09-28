"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type Metrics = {
  totalTests: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  notRun: number;
  passRate: number;
  executionProgress: number;
  requirementCoverage: number;
  automationCoverage: number;
  riskDistribution: Record<string, number>;
  manualVsAutomated: { manual: number; automated: number };
  priorityDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  historicalRuns: Array<{ date: string; passed: number; failed: number }>;
};

export default function DashboardPage() {
  const { t, n, err, label } = useI18n();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Metrics>("/dashboard/metrics")
      .then(setMetrics)
      .catch((e: Error) => setError(e.message));
  }, []);

  const axisName = (key: string) => {
    const status = t(`status.${key}`);
    if (status !== `status.${key}`) return status;
    return label("level", key);
  };

  const named = (data: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [axisName(key), value]),
    );

  const tiles: Array<{ key: keyof Metrics; label: string; tone: string }> = [
    { key: "totalTests", label: t("dashboard.totalTests"), tone: "text-foreground" },
    { key: "passed", label: t("dashboard.passed"), tone: "text-success" },
    { key: "failed", label: t("dashboard.failed"), tone: "text-destructive" },
    { key: "blocked", label: t("dashboard.blocked"), tone: "text-warning" },
    { key: "notRun", label: t("dashboard.notRun"), tone: "text-muted-foreground" },
    { key: "passRate", label: t("dashboard.passRate"), tone: "text-primary" },
  ];

  const statusChart = {
    backgroundColor: "transparent",
    color: ["#3dd68c", "#f07178", "#e6b450", "#8b98ab", "#4c9aff"],
    textStyle: { color: "#8b98ab" },
    tooltip: { trigger: "item" },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        data: Object.entries(metrics?.statusDistribution ?? {}).map(
          ([name, value]) => ({ name: axisName(name), value }),
        ),
        label: { color: "#c5d0de" },
      },
    ],
  };

  const historyChart = {
    backgroundColor: "transparent",
    textStyle: { color: "#8b98ab" },
    tooltip: { trigger: "axis" },
    legend: {
      data: [t("dashboard.passed"), t("dashboard.failed")],
      textStyle: { color: "#8b98ab" },
    },
    xAxis: {
      type: "category",
      data: metrics?.historicalRuns.map((h) => h.date) ?? [],
      axisLabel: { color: "#8b98ab" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8b98ab" },
      splitLine: { lineStyle: { color: "#2a3544" } },
    },
    series: [
      {
        name: t("dashboard.passed"),
        type: "bar",
        data: metrics?.historicalRuns.map((h) => h.passed) ?? [],
        itemStyle: { color: "#3dd68c" },
      },
      {
        name: t("dashboard.failed"),
        type: "bar",
        data: metrics?.historicalRuns.map((h) => h.failed) ?? [],
        itemStyle: { color: "#f07178" },
      },
    ],
  };

  const barChart = (data: Record<string, number>, color = "#4c9aff") => ({
    backgroundColor: "transparent",
    textStyle: { color: "#8b98ab" },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: Object.keys(data),
      axisLabel: { color: "#8b98ab" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8b98ab" },
      splitLine: { lineStyle: { color: "#2a3544" } },
    },
    series: [
      {
        type: "bar",
        data: Object.values(data),
        itemStyle: { color },
      },
    ],
  });

  const automationChart = {
    backgroundColor: "transparent",
    color: ["#8b98ab", "#4c9aff"],
    textStyle: { color: "#8b98ab" },
    tooltip: { trigger: "item" },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        data: [
          {
            name: t("dashboard.manual"),
            value: metrics?.manualVsAutomated.manual ?? 0,
          },
          {
            name: t("dashboard.automated"),
            value: metrics?.manualVsAutomated.automated ?? 0,
          },
        ],
        label: { color: "#c5d0de" },
      },
    ],
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {t("dashboard.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <Badge className="border-primary/30 bg-primary/10 text-primary">
          {t("common.live")}
        </Badge>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-3 text-sm text-destructive">
            {t("dashboard.apiOffline", { error: err(error) })}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.key}>
            <CardContent className="space-y-1 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </div>
              <div className={`font-mono text-xl font-semibold ${tile.tone}`}>
                {metrics
                  ? tile.key === "passRate"
                    ? `${n(metrics.passRate)}%`
                    : n(metrics[tile.key] as number)
                  : "—"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Metric
          label={t("dashboard.executionProgress")}
          value={`${n(metrics?.executionProgress ?? 0)}%`}
        />
        <Metric
          label={t("dashboard.requirementCoverage")}
          value={`${n(metrics?.requirementCoverage ?? 0)}%`}
        />
        <Metric
          label={t("dashboard.automationCoverage")}
          value={`${n(metrics?.automationCoverage ?? 0)}%`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.statusDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={statusChart} style={{ height: 240 }} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.historicalRuns")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={historyChart} style={{ height: 240 }} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.priorityDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={barChart(named(metrics?.priorityDistribution ?? {}), "#e6b450")}
              style={{ height: 240 }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.riskDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={barChart(named(metrics?.riskDistribution ?? {}), "#f07178")}
              style={{ height: 240 }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.manualVsAutomated")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={automationChart} style={{ height: 240 }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-sm text-primary">{value}</span>
      </CardContent>
    </Card>
  );
}
