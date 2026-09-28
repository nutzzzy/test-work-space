"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type FlowStep = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

function httpSummary(config: Record<string, unknown>) {
  const method = typeof config.method === "string" ? config.method : "GET";
  const url = typeof config.url === "string" ? config.url : "";
  return `${method.toUpperCase()} ${url}`.trim();
}

export function ScenarioFlow({
  steps,
  selectedId,
  onSelect,
  statuses,
  formatNumber,
  typeLabel,
  disabledLabel,
}: {
  steps: FlowStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statuses: Array<string | undefined>;
  formatNumber: (value: number) => string;
  typeLabel: (type: string) => string;
  disabledLabel: string;
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const selected = step.id === selectedId;
        const status = statuses[index];
        return (
          <li key={step.id} className="relative ps-8">
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  "absolute start-[11px] top-7 bottom-0 w-px",
                  status === "PASSED" ? "bg-success/70" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "absolute start-0 top-2.5 flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px]",
                status === "PASSED" && "border-success/60 bg-success/15 text-success",
                status === "FAILED" &&
                  "border-destructive/60 bg-destructive/15 text-destructive",
                status === "RUNNING" && "border-primary bg-primary/15 text-primary",
                !status && "border-border bg-card text-muted-foreground",
                selected && "ring-1 ring-primary",
              )}
            >
              {formatNumber(index + 1)}
            </span>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={cn(
                "mb-2 w-full rounded-md border px-3 py-2 text-start transition-colors",
                selected
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-card hover:bg-accent",
                !step.enabled && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{step.name}</span>
                <Badge>{typeLabel(step.type)}</Badge>
                {!step.enabled ? <Badge>{disabledLabel}</Badge> : null}
              </div>
              {step.type === "HTTP_REQUEST" ? (
                <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground dir-ltr">
                  {httpSummary(step.config)}
                </div>
              ) : null}
              {step.type === "DATABASE_ACTION" ? (
                <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground dir-ltr">
                  {String(step.config.operation ?? "SELECT")}{" "}
                  {String(step.config.query ?? "").replace(/\s+/g, " ").slice(0, 80)}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
