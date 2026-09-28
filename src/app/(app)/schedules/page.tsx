"use client";

import * as React from "react";
import { CalendarClock, Plus, Zap } from "lucide-react";
import { api, endpoints, useDevices, useUi, useWorkflows } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, PanelHeader, SectionLabel, Select, Toggle, cn } from "@/components/ui";
import { ScheduleCard } from "@/components/panels";
import type { Schedule } from "@autopilot/shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function SchedulesPage() {
  const schedules = useUi((s) => s.schedules);
  const loadSchedules = useUi((s) => s.loadSchedules);
  const busy = useUi((s) => s.scheduleBusy);
  const setBusy = useUi((s) => s.setScheduleBusy);
  const workflows = useWorkflows((s) => s.workflows);
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    workflowId: "",
    deviceId: activeId ?? "",
    frequency: "DAILY" as Schedule["frequency"],
    timeOfDay: "09:00",
    dayOfWeek: 1,
    intervalMinutes: 60,
    cron: "*/30 * * * *",
    runAt: "",
    misfirePolicy: "SKIP" as Schedule["misfirePolicy"],
    dryRun: true,
  });

  React.useEffect(() => {
    void loadSchedules();
    void useWorkflows.getState().load();
    void useDevices.getState().load();
  }, [loadSchedules]);

  React.useEffect(() => {
    if (activeId && !form.deviceId) setForm((f) => ({ ...f, deviceId: activeId }));
  }, [activeId, form.deviceId]);

  const create = async () => {
    setBusy("new", true);
    try {
      await api.post(endpoints.schedules, {
        name: form.name || `${workflows.find((w) => w.id === form.workflowId)?.name ?? "Workflow"} run`,
        workflowId: form.workflowId || workflows[0]?.id,
        deviceId: form.deviceId || activeId,
        frequency: form.frequency,
        timeOfDay: form.timeOfDay,
        dayOfWeek: form.frequency === "WEEKLY" ? form.dayOfWeek : null,
        intervalMinutes: form.frequency === "INTERVAL" ? form.intervalMinutes : null,
        cron: form.frequency === "CRON" ? form.cron : null,
        runAt: form.frequency === "ONCE" && form.runAt ? new Date(form.runAt).toISOString() : null,
        misfirePolicy: form.misfirePolicy,
        dryRun: form.dryRun,
        enabled: true,
      });
      await loadSchedules();
      setOpen(false);
      toast({ tone: "success", title: "Schedule created", message: "The scheduler checks every 20 seconds" });
    } catch (error) {
      toast({ tone: "error", title: "Could not save schedule", message: (error as Error).message });
    } finally {
      setBusy("new", false);
    }
  };

  const toggle = async (schedule: Schedule) => {
    try {
      await api.patch(`${endpoints.schedules}/${schedule.id}`, { enabled: !schedule.enabled });
      await loadSchedules();
    } catch (error) {
      toast({ tone: "error", title: "Update failed", message: (error as Error).message });
    }
  };

  const remove = async (schedule: Schedule) => {
    await api.del(`${endpoints.schedules}/${schedule.id}`);
    await loadSchedules();
    toast({ tone: "info", title: "Schedule removed" });
  };

  const runNow = async (schedule: Schedule) => {
    setBusy(schedule.id, true);
    try {
      await api.post(`${endpoints.schedules}/${schedule.id}/run-now`);
      toast({ tone: "info", title: "Triggered", message: `${schedule.name} started now` });
    } catch (error) {
      toast({ tone: "error", title: "Cannot trigger", message: (error as Error).message });
    } finally {
      setBusy(schedule.id, false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <PanelHeader
          title="Schedules"
          subtitle="Each schedule is pinned to one device. Offline devices never get their work moved elsewhere."
          icon={<CalendarClock className="size-4" />}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              New schedule
            </Button>
          }
        />
        {schedules.length ? (
          <div className="space-y-2">
            {schedules.map((schedule) => (
              <div key={schedule.id} className={cn("relative", busy[schedule.id] && "opacity-60")}>
                <ScheduleCard schedule={schedule} onToggle={() => void toggle(schedule)} onDelete={() => void remove(schedule)} onRunNow={() => void runNow(schedule)} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title="No schedules yet"
            message="Schedule a published workflow to run daily, weekly, on an interval, at a specific datetime, or with a cron expression."
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New schedule</Button>}
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <SectionLabel>Misfire policies</SectionLabel>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-mist-500">
            <Badge tone="warn">SKIP</Badge> logs a skipped run and reschedules. <Badge tone="info">QUEUE</Badge> keeps the slot and retries on the next
            tick while the device is offline.
          </p>
        </Card>
        <Card className="p-4">
          <SectionLabel>Engine cadence</SectionLabel>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-mist-500">The scheduler ticks every 20 seconds. One execution per device at a time — a due
            trigger while busy logs the conflict instead of interleaving input.</p>
        </Card>
        <Card className="p-4">
          <SectionLabel>Safety default</SectionLabel>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-mist-500">Scheduled runs inherit the workflow&apos;s dry-run flag, and unattended runs default to
            dry-run so nothing fires unattended on your desktop by accident.</p>
        </Card>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule a workflow"
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy.new} onClick={() => void create()}>Create schedule</Button>
          </>
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Workflow">
            <Select value={form.workflowId} onChange={(event) => setForm({ ...form, workflowId: event.target.value })}>
              <option value="">Select…</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Device">
            <Select value={form.deviceId} onChange={(event) => setForm({ ...form, deviceId: event.target.value })}>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>{device.name}{device.connected ? "" : " (offline)"}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Weekday research" />
          </Field>
          <Field label="Frequency">
            <Select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as Schedule["frequency"] })}>
              {["DAILY", "WEEKLY", "INTERVAL", "ONCE", "CRON"].map((option) => (
                <option key={option} value={option}>{option.toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          {form.frequency === "DAILY" || form.frequency === "WEEKLY" ? (
            <Field label="Time of day">
              <Input type="time" value={form.timeOfDay} onChange={(event) => setForm({ ...form, timeOfDay: event.target.value })} />
            </Field>
          ) : null}
          {form.frequency === "WEEKLY" ? (
            <Field label="Weekday">
              <Select value={String(form.dayOfWeek)} onChange={(event) => setForm({ ...form, dayOfWeek: Number(event.target.value) })}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {form.frequency === "INTERVAL" ? (
            <Field label="Every N minutes">
              <Input type="number" min={1} max={10080} value={form.intervalMinutes} onChange={(event) => setForm({ ...form, intervalMinutes: Number(event.target.value) })} />
            </Field>
          ) : null}
          {form.frequency === "CRON" ? (
            <Field label="Cron expression" hint="5 fields: minute hour day-of-month month day-of-week">
              <Input value={form.cron} onChange={(event) => setForm({ ...form, cron: event.target.value })} className="font-mono text-[0.78rem]" />
            </Field>
          ) : null}
          {form.frequency === "ONCE" ? (
            <Field label="Run at">
              <Input type="datetime-local" value={form.runAt} onChange={(event) => setForm({ ...form, runAt: event.target.value })} />
            </Field>
          ) : null}
          <Field label="If the device is offline">
            <Select value={form.misfirePolicy} onChange={(event) => setForm({ ...form, misfirePolicy: event.target.value as Schedule["misfirePolicy"] })}>
              <option value="SKIP">Skip and log</option>
              <option value="QUEUE">Queue and retry</option>
            </Select>
          </Field>
          <Toggle checked={form.dryRun} onChange={(dryRun) => setForm({ ...form, dryRun })} label="Dry run" description="Advance the engine without committing input" />
        </div>
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.72rem] text-mist-500">
          <Zap className="size-3.5 text-amber-glow" /> “Run now” on any schedule triggers the same engine path as a timed fire, including the device check.
        </p>
      </Modal>
    </div>
  );
}
