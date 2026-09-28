"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Clock, Download, RefreshCw, SquareTerminal } from "lucide-react";
import { api, endpoints, useExecutions, useUi } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, PanelHeader, SectionLabel, Segmented, StatusDot, cn } from "@/components/ui";
import { ExecutionTimeline } from "@/components/panels";

type Tone = "success" | "error" | "warn" | "neutral";
const statusTone = (status: string): Tone => (status === "COMPLETED" ? "success" : status === "FAILED" ? "error" : status === "RUNNING" ? "warn" : "neutral");

export default function HistoryPage() {
  const { history, loadHistory, loading } = useExecutions();
  const [filter, setFilter] = React.useState<"ALL" | "COMPLETED" | "FAILED" | "STOPPED" | "RUNNING">("ALL");
  const [query, setQuery] = React.useState("");
  const router = useRouter();

  React.useEffect(() => {
    void loadHistory({ limit: 100 });
  }, [loadHistory]);

  const rows = history.filter(
    (execution) =>
      (filter === "ALL" || execution.status === filter) &&
      (!query.trim() || execution.workflowName.toLowerCase().includes(query.toLowerCase())),
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `autopilot-executions-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <PanelHeader
          title="Execution history"
          subtitle="Every run, its status, duration and step outcome"
          icon={<SquareTerminal className="size-4" />}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="subtle" icon={<Download className="size-3.5" />} onClick={exportJson}>Export</Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void loadHistory({ limit: 100 })}>Refresh</Button>
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by workflow name" className="h-9 max-w-xs text-[0.8rem]" />
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "RUNNING", label: "Running" },
              { value: "COMPLETED", label: "Completed" },
              { value: "FAILED", label: "Failed" },
              { value: "STOPPED", label: "Stopped" },
            ]}
          />
          <span className="ml-auto text-[0.72rem] text-mist-500">{rows.length} of {history.length}</span>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-separate border-spacing-y-1 text-left">
              <thead>
                <tr className="text-mist-500">
                  {["Workflow", "Device", "Started", "Duration", "Status", ""].map((header) => (
                    <th key={header} className="mono-label px-3 pb-1 font-normal">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((execution) => (
                  <tr
                    key={execution.id}
                    onClick={() => router.push(`/history/${execution.id}`)}
                    className="cursor-pointer rounded-lg transition hover:bg-white/[0.04]"
                  >
                    <td className="rounded-l-lg bg-white/[0.02] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <StatusDot state={execution.status === "RUNNING" ? "busy" : execution.status === "COMPLETED" ? "online" : execution.status === "FAILED" ? "warn" : "offline"} size={7} />
                        <span className="text-[0.82rem] text-mist-100">{execution.workflowName}</span>
                        {execution.dryRun ? <Badge tone="warn">dry</Badge> : null}
                        {execution.trigger === "SCHEDULE" ? <Badge tone="info">scheduled</Badge> : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[0.64rem] text-mist-500">{execution.id.slice(0, 8)} · {execution.currentActionIndex + 1}/{execution.totalActions || "—"} steps</p>
                    </td>
                    <td className="bg-white/[0.02] px-3 py-2.5 text-[0.76rem] text-mist-300">{execution.deviceId?.slice(0, 8) ?? "—"}</td>
                    <td className="bg-white/[0.02] px-3 py-2.5 font-mono text-[0.72rem] text-mist-300">{new Date(execution.startedAt).toLocaleString("en-GB", { hour12: false })}</td>
                    <td className="bg-white/[0.02] px-3 py-2.5 font-mono text-[0.72rem] text-mist-300">{execution.durationMs != null ? `${(execution.durationMs / 1000).toFixed(2)}s` : "—"}</td>
                    <td className="bg-white/[0.02] px-3 py-2.5"><Badge tone={statusTone(execution.status)}>{execution.status.toLowerCase()}</Badge></td>
                    <td className="rounded-r-lg bg-white/[0.02] px-3 py-2.5 text-right">
                      <ChevronRight className="size-4 text-mist-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Clock className="size-5" />} title="No executions match" message="Run a workflow from the library or the dashboard and it will appear here with its full step timeline." action={<Link href="/workflows" className="text-[0.78rem] text-signal-300 hover:underline">open workflow library →</Link>} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <SectionLabel>Outcome mix</SectionLabel>
          <div className="mt-3 space-y-2">
            {(["COMPLETED", "FAILED", "STOPPED", "RUNNING"] as const).map((status) => {
              const count = history.filter((e) => e.status === status).length;
              const pct = history.length ? (count / history.length) * 100 : 0;
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-[0.72rem] text-mist-300">
                    <span>{status.toLowerCase()}</span>
                    <span className="font-mono text-mist-500">{count} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className={cn("h-full rounded-full", status === "COMPLETED" ? "bg-signal-400" : status === "FAILED" ? "bg-alert-400" : status === "RUNNING" ? "bg-amber-glow" : "bg-ink-500")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <SectionLabel>Latest run detail</SectionLabel>
          {history[0] ? (
            <div className="mt-3">
              <p className="text-[0.84rem] text-mist-100">{history[0].workflowName}</p>
              <p className="mt-0.5 text-[0.72rem] text-mist-500">
                {history[0].error ?? `${history[0].totalActions} actions · started ${new Date(history[0].startedAt).toLocaleTimeString("en-GB")}`}
              </p>
              <div className="mt-3">
                <ExecutionTimeline steps={history[0].steps as never} />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[0.76rem] text-mist-500">Nothing recorded yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
