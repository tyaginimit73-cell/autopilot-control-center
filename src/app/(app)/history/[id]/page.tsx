"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Cpu, FileClock, GitBranch, Radio } from "lucide-react";
import { api, endpoints, useExecutions, useUi } from "@/lib/client";
import { Badge, Button, Card, PanelHeader, ProgressBar, SectionLabel, Stat, StatusDot } from "@/components/ui";
import { ExecutionTimeline } from "@/components/panels";

export default function ExecutionDetailPage() {
  const params = useParams<{ id: string }>();
  const detail = useExecutions((s) => s.detail);
  const loadDetail = useExecutions((s) => s.loadDetail);
  const toast = useUi((s) => s.toast);
  const [rerunning, setRerunning] = React.useState(false);

  React.useEffect(() => {
    if (params?.id) void loadDetail(params.id);
  }, [loadDetail, params?.id]);

  const execution = detail?.execution;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Link href="/history" className="grid size-9 place-items-center rounded-lg border border-white/[0.07] text-mist-300 transition hover:text-mist-100" aria-label="Back to history">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot state={execution?.status === "COMPLETED" ? "online" : execution?.status === "FAILED" ? "warn" : "offline"} size={7} />
            <h2 className="truncate font-display text-[1.05rem] font-semibold">{execution?.workflowName ?? "Execution"}</h2>
            {execution ? <Badge tone={execution.status === "COMPLETED" ? "success" : execution.status === "FAILED" ? "error" : "neutral"}>{execution.status.toLowerCase()}</Badge> : null}
            {execution?.dryRun ? <Badge tone="warn">dry run</Badge> : null}
          </div>
          <p className="mt-0.5 font-mono text-[0.7rem] text-mist-500">{params?.id}</p>
        </div>
        {execution?.workflowId ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Radio className="size-3.5" />}
            loading={rerunning}
            onClick={async () => {
              setRerunning(true);
              try {
                await api.post(`${endpoints.workflows}/${execution.workflowId}/start`, {});
                toast({ tone: "info", title: "Re-running", message: execution.workflowName });
              } catch (error) {
                toast({ tone: "error", title: "Cannot re-run", message: (error as Error).message });
              } finally {
                setRerunning(false);
              }
            }}
          >
            Replay workflow
          </Button>
        ) : null}
      </Card>

      {execution ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Duration" value={execution.durationMs != null ? `${(execution.durationMs / 1000).toFixed(2)}s` : "running"} icon={<FileClock className="size-4" />} />
            <Stat label="Actions" value={`${execution.currentActionIndex + 1}/${execution.totalActions}`} icon={<GitBranch className="size-4" />} />
            <Stat label="Trigger" value={execution.trigger.toLowerCase()} icon={<Cpu className="size-4" />} />
            <Stat label="Finished" value={execution.finishedAt ? new Date(execution.finishedAt).toLocaleTimeString("en-GB") : "—"} icon={<Radio className="size-4" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card className="p-5">
              <PanelHeader title="Step timeline" subtitle="Per-step status, retries and messages" />
              <ExecutionTimeline steps={execution.steps as never} logs={detail?.logs} />
            </Card>
            <div className="space-y-4">
              <Card className="p-5">
                <PanelHeader title="Progress at stop" />
                <ProgressBar value={execution.totalActions ? (execution.currentActionIndex + 1) / execution.totalActions : 0} tone={execution.status === "FAILED" ? "error" : "signal"} />
                {execution.error ? (
                  <p className="mt-3 rounded-lg border border-alert-500/25 bg-alert-500/[0.07] p-3 text-[0.76rem] leading-relaxed text-[#ffb4b7]">
                    {execution.error}
                  </p>
                ) : (
                  <p className="mt-3 text-[0.76rem] leading-relaxed text-mist-500">Completed without errors.</p>
                )}
              </Card>
              <Card className="p-5">
                <SectionLabel className="mb-2">Log tail</SectionLabel>
                <div className="max-h-72 overflow-y-auto rounded-lg bg-ink-950/60 p-3 font-mono text-[0.7rem] leading-relaxed">
                  {detail?.logs.length ? (
                    detail.logs.map((entry) => (
                      <p key={entry.id} className="break-words text-mist-300">
                        <span className="text-mist-500">{new Date(entry.createdAt).toLocaleTimeString("en-GB")}</span>
                        {entry.actionType ? <span className="text-signal-300"> [{entry.actionType}]</span> : null} {entry.message}
                      </p>
                    ))
                  ) : (
                    <p className="text-mist-500">No log lines stored for this execution.</p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Card className="p-10 text-center text-[0.8rem] text-mist-500">Loading execution…</Card>
      )}
    </div>
  );
}
