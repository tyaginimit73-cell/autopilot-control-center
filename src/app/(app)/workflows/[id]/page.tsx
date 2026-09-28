"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Gauge, Pause, Play, RotateCcw, Square, Workflow } from "lucide-react";
import { useDevices, useExecutions, useUi, useWorkflows } from "@/lib/client";
import { Badge, Button, Card, PanelHeader, ProgressBar, SectionLabel, Toggle } from "@/components/ui";
import { ExecutionTimeline } from "@/components/panels";
import { WorkflowEditor } from "@/components/builder";
import { LiveConsole } from "@/components/shell";

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const { current, loadOne, reset, save, patchMeta } = useWorkflows();
  const live = useExecutions((s) => s.live);
  const start = useExecutions((s) => s.start);
  const pause = useExecutions((s) => s.pause);
  const resume = useExecutions((s) => s.resume);
  const stop = useExecutions((s) => s.stop);
  const activeId = useDevices((s) => s.activeId);
  const toast = useUi((s) => s.toast);
  const [tab, setTab] = React.useState<"builder" | "runs">("builder");

  React.useEffect(() => {
    if (params?.id) void loadOne(params.id);
    return () => reset();
  }, [loadOne, params?.id, reset]);

  const steps = live?.executionId
    ? Array.from({ length: live.total || 1 }, (_, index) => ({
        index,
        actionType: current?.actions?.[index]?.type ?? "WAIT",
        status: index < (live?.index ?? 0) ? "COMPLETED" : index === (live?.index ?? 0) ? "RUNNING" : "PENDING",
        message: index === (live?.index ?? 0) ? live?.message ?? "" : "",
        attempt: 1,
      }))
    : [];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Link href="/workflows" className="grid size-9 place-items-center rounded-lg border border-white/[0.07] text-mist-300 transition hover:text-mist-100" aria-label="Back to workflow library">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Workflow className="size-4 text-signal-300" />
            <h2 className="truncate font-display text-[1.05rem] font-semibold">{current?.name ?? "Loading workflow…"}</h2>
            <Badge tone={current?.status === "ACTIVE" ? "success" : "info"}>{current?.status?.toLowerCase() ?? "draft"}</Badge>
            {current?.isDryRun ? <Badge tone="warn" dot>dry run</Badge> : <Badge tone="error" dot>live</Badge>}
          </div>
          <p className="mt-0.5 truncate text-[0.74rem] text-mist-500">{current?.description || "Add a description so future-you knows why this exists"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={Boolean(current?.isDryRun)} onChange={(isDryRun) => current && patchMeta({ isDryRun })} label="Dry run" />
          <Button
            variant="primary"
            icon={<Play className="size-4" />}
            disabled={!current}
            onClick={async () => {
              try {
                if (useWorkflows.getState().dirty && params?.id) await save(params.id, { name: current!.name, description: current!.description, actions: current!.actions, status: current!.status, isDryRun: current!.isDryRun });
                const result = await start(params.id, activeId ?? undefined);
                toast({ tone: "info", title: "Running", message: result.dryRun ? "Dry-run execution started" : "Live execution started" });
                setTab("runs");
              } catch (error) {
                toast({ tone: "error", title: "Cannot run", message: (error as Error).message });
              }
            }}
          >
            Run workflow
          </Button>
          {live ? (
            <>
              <Button size="sm" variant="outline" icon={live.status === "PAUSED" ? <RotateCcw className="size-3.5" /> : <Pause className="size-3.5" />} onClick={() => void (live.status === "PAUSED" ? resume(live.executionId) : pause(live.executionId))}>
                {live.status === "PAUSED" ? "Resume" : "Pause"}
              </Button>
              <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={() => void stop(live.executionId)}>Stop</Button>
            </>
          ) : null}
        </div>
      </Card>

      {live ? (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Gauge className="size-4 text-signal-300" />
              <p className="text-[0.85rem] text-mist-100">{live.workflowName}</p>
              <Badge tone={live.status === "PAUSED" ? "warn" : "success"} dot>{live.status.toLowerCase()}</Badge>
              <span className="ml-auto font-mono text-[0.72rem] text-mist-500">step {live.index + 1}/{live.total} · {live.actionType}</span>
            </div>
            <ProgressBar className="mt-3" value={live.total ? (live.index + 1) / live.total : 0.05} tone={live.status === "PAUSED" ? "warn" : "signal"} />
            <Link href="/history" className="mt-2 inline-block text-[0.72rem] text-signal-300 hover:underline">open execution history →</Link>
          </Card>
        </motion.div>
      ) : null}

      <div className="flex items-center gap-2">
        {(["builder", "runs"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={tab === option ? "rounded-lg border border-signal-400/30 bg-signal-400/10 px-3 py-1.5 text-[0.78rem] text-mist-100" : "rounded-lg border border-white/[0.07] px-3 py-1.5 text-[0.78rem] text-mist-500 transition hover:text-mist-300"}
          >
            {option === "builder" ? "Builder" : "Run & timeline"}
          </button>
        ))}
      </div>

      {tab === "builder" ? (
        <WorkflowEditor />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
          <Card className="p-5">
            <PanelHeader title="Execution timeline" subtitle={live ? "Live step states for the current run" : "Start a run to populate the timeline"} />
            {steps.length ? <ExecutionTimeline steps={steps as never} live={{ index: live?.index ?? 0, total: live?.total ?? 0 }} /> : <p className="text-[0.78rem] text-mist-500">No execution running.</p>}
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3"><SectionLabel>Console</SectionLabel></div>
            <LiveConsole className="rounded-none border-0 shadow-none" height="h-96" />
          </Card>
        </div>
      )}
    </div>
  );
}
