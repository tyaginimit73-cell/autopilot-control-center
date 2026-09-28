"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Filter, GitBranch, Play, Plus, Search, Trash2 } from "lucide-react";
import { useDevices, useExecutions, useUi, useWorkflows } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PanelHeader, Segmented, Select, Toggle, cn } from "@/components/ui";
import { WorkflowCard } from "@/components/panels";
import { newAction } from "@/components/builder";
import type { ActionType } from "@autopilot/shared";

export default function WorkflowsPage() {
  const { workflows, load, create, remove } = useWorkflows();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"ALL" | "ACTIVE" | "DRAFT" | "ARCHIVED">("ALL");
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ name: "", description: "", isDryRun: true, starter: "OPEN_URL" as ActionType, deviceId: "" });
  const activeId = useDevices((s) => s.activeId);
  const start = useExecutions((s) => s.start);
  const toast = useUi((s) => s.toast);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = workflows.filter((workflow) => {
    const haystack = `${workflow.name} ${workflow.description}`.toLowerCase();
    return (status === "ALL" || workflow.status === status) && (!query.trim() || haystack.includes(query.toLowerCase()));
  });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows by name or description" className="pl-9" />
        </div>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "ALL", label: "All" },
            { value: "ACTIVE", label: "Active" },
            { value: "DRAFT", label: "Drafts" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
        />
        <span className="hidden items-center gap-1.5 text-[0.72rem] text-mist-500 sm:inline-flex">
          <Filter className="size-3.5" /> {filtered.length}/{workflows.length}
        </span>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New workflow
        </Button>
      </Card>

      {filtered.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((workflow, index) => (
            <motion.div key={workflow.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.15, index * 0.04) }}>
              <WorkflowCard
                workflow={workflow}
                onOpen={() => router.push(`/workflows/${workflow.id}`)}
                onRun={async () => {
                  try {
                    const result = await start(workflow.id, activeId ?? undefined);
                    toast({ tone: "info", title: "Execution started", message: `${workflow.name}${result.dryRun ? " (dry run)" : ""}` });
                  } catch (error) {
                    toast({ tone: "error", title: "Cannot start", message: (error as Error).message });
                  }
                }}
              />
              <div className="mt-1.5 flex items-center gap-2 px-1">
                <Link href={`/workflows/${workflow.id}`} className="text-[0.72rem] text-signal-300 hover:underline">open in builder</Link>
                <IconButton label="Delete workflow" className="ml-auto hover:border-alert-500/50 hover:text-alert-400" onClick={() => setConfirmDelete(workflow.id)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<GitBranch className="size-5" />}
          title={workflows.length ? "No workflow matches those filters" : "No workflows yet"}
          message={workflows.length ? "Clear the search or switch the status filter to see the rest of your library." : "Create your first automation, or record one by driving the agent from the console."}
          action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New workflow</Button>}
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a workflow"
        subtitle="It opens straight in the builder — the starter action keeps validation honest."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const created = await create({
                    name: draft.name.trim() || "Untitled workflow",
                    description: draft.description,
                    status: "DRAFT",
                    isDryRun: draft.isDryRun,
                    actions: [
                      { ...newAction(draft.starter), delay: 0 },
                      { ...newAction("WAIT"), parameters: { milliseconds: 800 } },
                    ],
                  });
                  setCreating(false);
                  router.push(`/workflows/${created.id}`);
                } catch (error) {
                  toast({ tone: "error", title: "Could not create workflow", message: (error as Error).message });
                }
              }}
            >
              Create &amp; edit
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Name">
            <Input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Evening inbox triage" />
          </Field>
          <Field label="Description">
            <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What should this achieve?" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First action">
              <Select value={draft.starter} onChange={(event) => setDraft({ ...draft, starter: event.target.value as ActionType })}>
                {(Object.keys({ OPEN_URL: 1, MOVE_MOUSE: 1, OPEN_APPLICATION: 1, TYPE_TEXT: 1, WAIT: 1, CLICK_ELEMENT: 1 }) as ActionType[]).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
            </Field>
            <Toggle checked={draft.isDryRun} onChange={(isDryRun) => setDraft({ ...draft, isDryRun })} label="Run in dry-run mode" description="Recommended for a first pass" />
          </div>
          <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.72rem] leading-relaxed text-mist-500">
            New workflows start as <Badge tone="info">DRAFT</Badge>. Publish them to make them available to the scheduler.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete workflow"
        message="The workflow and its execution history are removed. Schedules pointing at it are deleted too."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await remove(confirmDelete);
          setConfirmDelete(null);
          toast({ tone: "info", title: "Workflow deleted" });
        }}
      />
    </div>
  );
}

export function WorkflowMeta({ name, tone = "neutral" }: { name: string; tone?: "neutral" | "warn" }) {
  return <Badge tone={tone === "warn" ? "warn" : "neutral"}>{name}</Badge>;
}

export const rowClass = cn("flex items-center gap-2");
export { Play };
