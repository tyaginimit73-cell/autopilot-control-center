"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Copy, Eye, EyeOff, GripVertical, Plus, Save, Settings2, Trash2, Wand2, X } from "lucide-react";
import {
  ACTION_CATALOG,
  ACTIONS_BY_GROUP,
  DEFAULT_ACTION_DELAY_MS,
  DEFAULT_ACTION_TIMEOUT_MS,
  describeAction,
  type ActionType,
  type WorkflowAction,
} from "@autopilot/shared";
import { ActionIcon, Badge, Button, Field, IconButton, Input, Modal, Select, Textarea, Toggle, Tooltip, cn, groupAccent } from "@/components/ui";
import { useUi, useWorkflows } from "@/lib/client";

/**
 * Visual workflow builder. Reordering uses native HTML5 drag-and-drop (plus
 * keyboard buttons) so there is no extra dependency and the list stays
 * accessible. Every parameter form is generated from the shared action catalog,
 * which is the same catalog the server and the agent validate against.
 */

export function newAction(type: ActionType): WorkflowAction {
  const def = ACTION_CATALOG[type];
  return {
    id: crypto.randomUUID(),
    type,
    parameters: structuredClone(def.defaults) as WorkflowAction["parameters"],
    delay: DEFAULT_ACTION_DELAY_MS,
    timeout: DEFAULT_ACTION_TIMEOUT_MS,
    retries: 0,
    enabled: true,
  };
}

export function ActionPalette({ onAdd, query, setQuery }: { onAdd: (type: ActionType) => void; query: string; setQuery: (value: string) => void }) {
  const [group, setGroup] = React.useState<string>("all");
  const filtered = ACTIONS_BY_GROUP.map((g) => ({
    ...g,
    actions: g.actions.filter(
      (action) =>
        (group === "all" || g.id === group) &&
        (query.trim() === "" ||
          action.label.toLowerCase().includes(query.toLowerCase()) ||
          action.type.toLowerCase().includes(query.toLowerCase()) ||
          action.description.toLowerCase().includes(query.toLowerCase())),
    ),
  })).filter((g) => g.actions.length);

  return (
    <div className="flex h-full flex-col gap-3">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions…" className="h-9 text-[0.8rem]" />
      <div className="flex flex-wrap gap-1">
        {[{ id: "all", label: "All" }, ...ACTIONS_BY_GROUP.map((g) => ({ id: g.id, label: g.label }))].map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setGroup(option.id)}
            className={cn("rounded-md border px-2 py-1 text-[0.68rem] transition", group === option.id ? "border-signal-400/40 bg-signal-400/10 text-mist-100" : "border-white/[0.07] text-mist-500 hover:text-mist-300")}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {filtered.map((section) => (
          <div key={section.id}>
            <p className={cn("mono-label mb-1.5")}>{section.label}</p>
            <div className="grid gap-1.5">
              {section.actions.map((action) => (
                <button
                  key={action.type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-autopilot-action", action.type);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onAdd(action.type)}
                  className="group flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition hover:border-signal-400/30 hover:bg-white/[0.05]"
                >
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border", groupAccent[action.group])}>
                    <ActionIcon name={action.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.8rem] text-mist-100">{action.label}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[0.68rem] leading-relaxed text-mist-500">{action.description}</span>
                  </span>
                  <Plus className="ml-auto size-3.5 shrink-0 text-mist-500 opacity-0 transition group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length ? <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[0.72rem] text-mist-500">No action matches “{query}”.</p> : null}
      </div>
      <p className="text-[0.66rem] leading-relaxed text-mist-500">
        Drag a card into the sequence, or click to append. Palette and validation come from the same allowlist the agent uses.
      </p>
    </div>
  );
}

export function ActionCard({
  action,
  index,
  total,
  selected,
  onSelect,
  onMove,
  onDuplicate,
  onToggle,
  onDelete,
  onDropBefore,
}: {
  action: WorkflowAction;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onDropBefore: (payload: { type: "new"; actionType: ActionType } | { type: "move"; index: number }) => void;
}) {
  const def = ACTION_CATALOG[action.type];
  const [over, setOver] = React.useState(false);
  const invalid = def && def.fields.some((field) => field.required && !action.parameters[field.key as keyof typeof action.parameters]);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-autopilot-action") || event.dataTransfer.types.includes("application/x-autopilot-index")) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const newType = event.dataTransfer.getData("application/x-autopilot-action");
        const movedIndex = event.dataTransfer.getData("application/x-autopilot-index");
        if (newType) onDropBefore({ type: "new", actionType: newType as ActionType });
        else if (movedIndex !== "") onDropBefore({ type: "move", index: Number(movedIndex) });
      }}
      className={cn(
        "relative rounded-xl border transition",
        selected ? "border-signal-400/40 bg-signal-400/[0.05]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
        over && "border-amber-glow/60",
        !action.enabled && "opacity-55",
      )}
    >
      {over ? <span className="absolute -top-px left-3 right-3 h-0.5 rounded-full bg-amber-glow" /> : null}
      <div className="flex items-start gap-2.5 p-2.5">
        <span
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-autopilot-index", String(index));
            event.dataTransfer.effectAllowed = "move";
          }}
          className="grip mt-1 cursor-grab text-mist-500 hover:text-mist-300"
          aria-label={`Drag action ${index + 1}`}
        >
          <GripVertical className="size-4" />
        </span>
        <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border", groupAccent[def?.group ?? "control"])}>
          <ActionIcon name={def?.icon ?? "globe"} />
        </span>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.66rem] text-mist-500">{String(index + 1).padStart(2, "0")}</span>
            <span className="text-[0.82rem] font-medium text-mist-100">{def?.label ?? action.type}</span>
            <Badge tone="neutral">{action.type}</Badge>
            {invalid ? <Badge tone="warn">parameters incomplete</Badge> : null}
            {!action.enabled ? <Badge tone="error">disabled</Badge> : null}
          </span>
          <span className="mt-1 block truncate font-mono text-[0.7rem] text-mist-300">{describeAction(action)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.66rem] text-mist-500">
            <span className="inline-flex items-center gap-1"><Clock className="size-3" />{action.delay}ms delay</span>
            <span>timeout {action.timeout}ms</span>
            {action.retries ? <span>{action.retries} retries</span> : null}
            {action.parameters.subActions?.length ? <span className="text-amber-glow">{action.parameters.subActions.length} sub-actions</span> : null}
          </span>
        </button>
        <span className="flex shrink-0 flex-col items-center gap-1">
          <span className="flex items-center gap-0.5">
            <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-3" />
            </IconButton>
            <IconButton label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown className="size-3" />
            </IconButton>
          </span>
          <span className="flex items-center gap-0.5">
            <Tooltip content={action.enabled ? "Skip this action" : "Enable this action"}>
              <IconButton label={action.enabled ? "Disable action" : "Enable action"} onClick={onToggle}>
                {action.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </IconButton>
            </Tooltip>
            <IconButton label="Duplicate action" onClick={onDuplicate}>
              <Copy className="size-3" />
            </IconButton>
            <IconButton label="Delete action" className="hover:border-alert-500/50 hover:text-alert-400" onClick={onDelete}>
              <Trash2 className="size-3" />
            </IconButton>
          </span>
        </span>
      </div>
    </motion.li>
  );
}

export function ActionEditor({ action, onChange, onClose }: { action: WorkflowAction | null; onChange: (action: WorkflowAction) => void; onClose: () => void }) {
  const def = action ? ACTION_CATALOG[action.type] : null;
  if (!action || !def) return null;
  const patch = (parameters: Partial<WorkflowAction["parameters"]>) => onChange({ ...action, parameters: { ...action.parameters, ...parameters } });

  return (
    <Modal open onClose={onClose} title={`${def.label} — parameters`} subtitle={def.description} width="max-w-3xl">
      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-3.5">
          {def.fields.length ? (
            def.fields.map((field) => <FieldControl key={field.key} field={field} action={action} onPatch={patch} />)
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 p-4 text-[0.75rem] text-mist-500">This action takes no parameters.</p>
          )}

          {action.type === "REPEAT" ? (
            <SubActionEditor action={action} onChange={onChange} />
          ) : null}
        </div>

        <div className="space-y-3.5">
          <div className="rounded-xl border border-white/[0.07] bg-ink-950/50 p-3">
            <p className="mono-label mb-2">execution preview</p>
            <p className="font-mono text-[0.78rem] leading-relaxed text-signal-200">
              {useUi.getState().settings?.dryRunByDefault ? "[DRY RUN] " : ""}
              {describeAction(action)}
            </p>
            <pre className="mt-2.5 max-h-32 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[0.62rem] leading-relaxed text-mist-500">{JSON.stringify(action.parameters, null, 2)}</pre>
          </div>
          <Field label="Delay before action (ms)">
            <Input type="number" min={0} max={120000} value={action.delay} onChange={(event) => onChange({ ...action, delay: clamp(event.target.value, 0, 120000) })} />
          </Field>
          <Field label="Timeout (ms)">
            <Input type="number" min={500} max={300000} step={500} value={action.timeout} onChange={(event) => onChange({ ...action, timeout: clamp(event.target.value, 500, 300000) })} />
          </Field>
          <Field label="Retries" hint="Re-runs the action when it fails; the engine waits 400ms between attempts.">
            <Select value={String(action.retries)} onChange={(event) => onChange({ ...action, retries: Number(event.target.value) })}>
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="Note">
            <Textarea rows={2} value={action.note ?? ""} onChange={(event) => onChange({ ...action, note: event.target.value.slice(0, 280) })} className="font-body text-[0.8rem]" placeholder="Why does this step exist?" />
          </Field>
          <Toggle checked={action.enabled} onChange={(enabled) => onChange({ ...action, enabled })} label="Enabled" description="Disabled actions stay in the workflow but are skipped by the engine." />
        </div>
      </div>
    </Modal>
  );
}

function FieldControl({ field, action, onPatch }: { field: (typeof ACTION_CATALOG)[ActionType]["fields"][number]; action: WorkflowAction; onPatch: (patch: Partial<WorkflowAction["parameters"]>) => void }) {
  const value = action.parameters[field.key as keyof WorkflowAction["parameters"]];
  if (field.type === "toggle") {
    return <Toggle checked={Boolean(value)} onChange={(next) => onPatch({ [field.key]: next } as never)} label={field.label} description={field.hint} />;
  }
  if (field.type === "select") {
    const options = field.options ?? [];
    const isModifiers = field.key === "modifiers";
    const current = isModifiers ? ((value as string[] | undefined) ?? []).join("+") : String(value ?? options[0]?.value ?? "");
    return (
      <Field label={field.label} hint={field.hint}>
        <Select
          value={current}
          onChange={(event) => {
            if (isModifiers) onPatch({ modifiers: event.target.value ? (event.target.value.split("+") as never) : [] });
            else if (field.key === "value" && action.type === "CLICK_ELEMENT") onPatch({ value: event.target.value, name: action.parameters.name });
            else onPatch({ [field.key]: event.target.value } as never);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.type === "number") {
    return (
      <Field label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`}>
        <Input type="number" min={field.min} max={field.max} step={field.step ?? 1} value={Number(value ?? 0)} onChange={(event) => onPatch({ [field.key]: clamp(event.target.value, field.min ?? 0, field.max ?? 1e9) } as never)} />
      </Field>
    );
  }
  if (field.type === "textarea") {
    return (
      <Field label={field.label} hint={field.hint}>
        <Textarea value={String(value ?? "")} onChange={(event) => onPatch({ [field.key]: event.target.value.slice(0, field.max ?? 4000) } as never)} placeholder={field.placeholder} />
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint}>
      <Input value={String(value ?? "")} onChange={(event) => onPatch({ [field.key]: event.target.value } as never)} placeholder={field.placeholder} className={field.key === "url" || field.key === "selector" ? "font-mono text-[0.78rem]" : undefined} />
    </Field>
  );
}

function SubActionEditor({ action, onChange }: { action: WorkflowAction; onChange: (action: WorkflowAction) => void }) {
  const subActions = action.parameters.subActions ?? [];
  const set = (next: WorkflowAction[]) => onChange({ ...action, parameters: { ...action.parameters, subActions: next } });
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-950/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="mono-label">repeat body</p>
        <Select
          className="ml-auto h-8 w-44 text-[0.72rem]"
          value=""
          onChange={(event) => {
            const type = event.target.value as ActionType;
            if (type) set([...subActions, newAction(type)]);
          }}
        >
          <option value="">+ add sub-action</option>
          {Object.values(ACTION_CATALOG)
            .filter((candidate) => !candidate.control)
            .map((candidate) => (
              <option key={candidate.type} value={candidate.type}>
                {candidate.label} ({candidate.group})
              </option>
            ))}
        </Select>
      </div>
      {subActions.length ? (
        <ol className="space-y-1">
          {subActions.map((sub, index) => (
            <li key={sub.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5">
              <span className="font-mono text-[0.62rem] text-mist-500">{index + 1}</span>
              <ActionIcon name={ACTION_CATALOG[sub.type]?.icon ?? "globe"} />
              <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-mist-300">{describeAction(sub)}</span>
              <IconButton label="Remove sub-action" onClick={() => set(subActions.filter((_, i) => i !== index))}>
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-center text-[0.72rem] text-mist-500">Empty — the loop would do nothing.</p>
      )}
    </div>
  );
}

function clamp(raw: string | number, min: number, max: number) {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw || "0", 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/* ── the full editor surface used by /workflows/[id] ─────────────────────── */
export function WorkflowEditor() {
  const current = useWorkflows((s) => s.current);
  const dirty = useWorkflows((s) => s.dirty);
  const saving = useWorkflows((s) => s.saving);
  const patchActions = useWorkflows((s) => s.patchActions);
  const patchMeta = useWorkflows((s) => s.patchMeta);
  const save = useWorkflows((s) => s.save);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [showIssues, setShowIssues] = React.useState(false);
  const toast = useUi((s) => s.toast);

  const actions = current?.actions ?? [];
  const selected = actions.find((action) => action.id === selectedId) ?? null;

  const issues = React.useMemo(
    () =>
      actions
        .map((action, index) => {
          const def = ACTION_CATALOG[action.type];
          const missing = def?.fields.filter((field) => field.required && !action.parameters[field.key as keyof typeof action.parameters]);
          return missing?.length ? { index, label: def?.label ?? action.type, fields: missing.map((f) => f.label) } : null;
        })
        .filter(Boolean) as { index: number; label: string; fields: string[] }[],
    [actions],
  );

  if (!current) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="panel p-3.5 xl:sticky xl:top-24 xl:h-[calc(100dvh-8rem)]">
        <ActionPalette onAdd={(type) => patchActions((list) => [...list, newAction(type)])} query={query} setQuery={setQuery} />
      </aside>

      <section className="space-y-4">
        <div className="panel p-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Field label="Workflow name">
              <Input value={current.name} onChange={(event) => patchMeta({ name: event.target.value })} className="h-11 font-display text-[1rem]" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status">
                <Select value={current.status} onChange={(event) => patchMeta({ status: event.target.value as never })}>
                  {["DRAFT", "ACTIVE", "ARCHIVED"].map((option) => (
                    <option key={option} value={option}>{option.toLowerCase()}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Toggle checked={current.isDryRun} onChange={(isDryRun) => patchMeta({ isDryRun })} label="Dry run" description="Log every step, commit no clicks" />
              </div>
            </div>
          </div>
          <Field label="Description" className="mt-3">
            <Textarea rows={2} value={current.description} onChange={(event) => patchMeta({ description: event.target.value.slice(0, 600) })} className="font-body text-[0.82rem]" placeholder="What does this workflow achieve?" />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2 hairline-t pt-3">
            <Badge tone="neutral">{actions.length} actions</Badge>
            <Badge tone={actions.filter((a) => a.enabled).length ? "success" : "warn"}>{actions.filter((a) => a.enabled).length} enabled</Badge>
            {issues.length ? (
              <button type="button" onClick={() => setShowIssues(true)} className="inline-flex items-center gap-1.5 rounded-full border border-amber-glow/25 bg-amber-glow/10 px-2 py-0.5 text-[0.68rem] text-amber-glow">
                <AlertTriangle className="size-3" /> {issues.length} with missing parameters
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[0.68rem] text-signal-300">
                <Check className="size-3" /> all actions valid
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button
                variant="subtle"
                size="sm"
                icon={<Wand2 className="size-3.5" />}
                onClick={() => {
                  patchActions((list) => list.map((action, index) => ({ ...action, delay: index === 0 ? 0 : action.delay || 250 })));
                  toast({ tone: "info", title: "Cadence applied", message: "Delays normalised across the sequence" });
                }}
              >
                Auto-space
              </Button>
              <Button variant={dirty ? "primary" : "subtle"} size="sm" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void save(current.id, { name: current.name, description: current.description, actions: current.actions, status: current.status, isDryRun: current.isDryRun }).then(() => toast({ tone: "success", title: "Workflow saved" })).catch((error: Error) => toast({ tone: "error", title: "Save failed", message: error.message }))}>
                {dirty ? "Save changes" : "Saved"}
              </Button>
            </span>
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="size-4 text-mist-500" />
            <p className="text-[0.85rem] font-medium text-mist-100">Action sequence</p>
            <span className="text-[0.7rem] text-mist-500">drag to reorder · click a card to edit parameters</span>
          </div>
          {actions.length ? (
            <ol className="space-y-2">
              <AnimatePresence initial={false}>
                {actions.map((action, index) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    index={index}
                    total={actions.length}
                    selected={action.id === selectedId}
                    onSelect={() => setSelectedId(action.id)}
                    onMove={(direction) =>
                      patchActions((list) => {
                        const next = [...list];
                        const target = index + direction;
                        if (target < 0 || target >= next.length) return list;
                        [next[index], next[target]] = [next[target], next[index]];
                        return next;
                      })
                    }
                    onDuplicate={() =>
                      patchActions((list) => {
                        const next = [...list];
                        next.splice(index + 1, 0, { ...structuredClone(action), id: crypto.randomUUID() });
                        return next;
                      })
                    }
                    onToggle={() => patchActions((list) => list.map((item) => (item.id === action.id ? { ...item, enabled: !item.enabled } : item)))}
                    onDelete={() => {
                      patchActions((list) => list.filter((item) => item.id !== action.id));
                      if (selectedId === action.id) setSelectedId(null);
                    }}
                    onDropBefore={(payload) => {
                      if (payload.type === "new") {
                        const created = newAction(payload.actionType);
                        patchActions((list) => [...list.slice(0, index), created, ...list.slice(index)]);
                        setSelectedId(created.id);
                        return;
                      }
                      patchActions((list) => {
                        if (payload.index === index || payload.index < 0 || payload.index >= list.length) return list;
                        const next = [...list];
                        const [moved] = next.splice(payload.index, 1);
                        const target = payload.index < index ? index : index;
                        next.splice(target, 0, moved);
                        return next;
                      });
                    }}
                  />
                ))}
              </AnimatePresence>
            </ol>
          ) : (
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const type = event.dataTransfer.getData("application/x-autopilot-action") as ActionType;
                if (type) patchActions((list) => [...list, newAction(type)]);
              }}
              className="rounded-xl border border-dashed border-white/12 px-6 py-14 text-center"
            >
              <p className="text-[0.85rem] text-mist-300">Empty workflow</p>
              <p className="mx-auto mt-1 max-w-md text-[0.74rem] leading-relaxed text-mist-500">Drag actions here from the palette, or click one to append it. Start with Open application → Open URL → Wait for page.</p>
            </div>
          )}
        </div>
      </section>

      <ActionEditor
        action={selected}
        onChange={(next) => patchActions((list) => list.map((item) => (item.id === next.id ? next : item)))}
        onClose={() => setSelectedId(null)}
      />

      <Modal open={showIssues} onClose={() => setShowIssues(false)} title="Validation report" subtitle="Required parameters that are still empty">
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.index} className="rounded-lg border border-amber-glow/20 bg-amber-glow/[0.05] p-2.5 text-[0.78rem] text-mist-300">
              Step {issue.index + 1} · {issue.label} — missing {issue.fields.join(", ")}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
