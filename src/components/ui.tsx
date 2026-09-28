"use client";

import * as React from "react";
import { AnimatePresence, motion, type MotionProps } from "framer-motion";
import {
  AlertTriangle,
  AppWindow,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Command,
  CornerDownLeft,
  Crosshair,
  FormInput,
  GitBranch,
  Globe,
  Hand,
  Keyboard,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  MousePointerClick,
  Move,
  OctagonX,
  PanelsTopLeft,
  Repeat,
  Rocket,
  RotateCw,
  Search,
  Timer,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { useUi } from "@/lib/client";

export function cn(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

/* ── buttons ─────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "subtle";
const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-signal-400 text-ink-950 hover:bg-signal-300 shadow-[0_10px_30px_-14px_rgba(63,220,182,0.75)] font-semibold disabled:bg-signal-500/40 disabled:text-mist-300",
  outline: "border border-white/12 bg-white/[0.03] text-mist-100 hover:border-signal-400/50 hover:bg-signal-400/10",
  ghost: "text-mist-300 hover:bg-white/[0.06] hover:text-mist-100",
  danger: "bg-alert-500 text-white hover:bg-alert-400 font-semibold shadow-[0_12px_34px_-16px_rgba(226,59,65,0.8)]",
  subtle: "bg-ink-800 text-mist-300 hover:bg-ink-700 hover:text-mist-100 border border-white/[0.06]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ variant = "outline", size = "md", loading, icon, className, children, ...rest }: ButtonProps) {
  const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[0.95rem] gap-2.5" };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size],
        buttonStyles[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-md border border-white/[0.07] bg-white/[0.03] text-mist-300 transition hover:border-signal-400/40 hover:text-mist-100 disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── surfaces ────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  interactive,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "panel p-5",
        interactive && "transition duration-200 hover:-translate-y-0.5 hover:border-signal-400/25",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ title, subtitle, action, icon }: { title: string; subtitle?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon ? <div className="mt-0.5 grid size-8 place-items-center rounded-lg bg-white/[0.04] text-signal-300">{icon}</div> : null}
        <div>
          <h2 className="text-[0.95rem] font-semibold text-mist-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-mist-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mono-label", className)}>{children}</div>;
}

/* ── atoms ───────────────────────────────────────────────────────────────── */

const badgeTones = {
  neutral: "bg-white/[0.05] text-mist-300 border-white/[0.08]",
  success: "bg-signal-400/12 text-signal-200 border-signal-400/25",
  warn: "bg-amber-glow/12 text-amber-glow border-amber-glow/25",
  error: "bg-alert-500/14 text-[#ffb4b7] border-alert-500/30",
  info: "bg-violet-soft/12 text-violet-soft border-violet-soft/25",
};

export function Badge({ children, tone = "neutral", className, dot }: { children: React.ReactNode; tone?: keyof typeof badgeTones; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium tracking-wide", badgeTones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ state, pulse = true, size = 8 }: { state: "online" | "offline" | "busy" | "warn"; pulse?: boolean; size?: number }) {
  const color =
    state === "online" ? "bg-signal-400" : state === "busy" ? "bg-amber-glow" : state === "warn" ? "bg-alert-400" : "bg-ink-500";
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", color, pulse && state !== "offline" && (state === "warn" || state === "busy" ? "animate-alert-ring" : "animate-pulse-ring"))}
      style={{ width: size, height: size }}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/12 bg-ink-800 px-1.5 py-0.5 font-mono text-[0.68rem] text-mist-300">{children}</kbd>;
}

export function ProgressBar({ value, tone = "signal", className }: { value: number; tone?: "signal" | "warn" | "error"; className?: string }) {
  const bg = tone === "signal" ? "bg-signal-400" : tone === "warn" ? "bg-amber-glow" : "bg-alert-400";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className={cn("h-full rounded-full", bg)} initial={false} animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
    </div>
  );
}

/* ── form controls ───────────────────────────────────────────────────────── */

export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="mb-1.5 block text-[0.72rem] font-medium tracking-wide text-mist-300">{label}</span> : null}
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-[0.72rem] text-[#ffb4b7]">
          <TriangleAlert className="size-3" /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[0.72rem] leading-relaxed text-mist-500">{hint}</span>
      ) : null}
    </label>
  );
}

const controlBase =
  "w-full rounded-lg border border-white/[0.08] bg-ink-900/70 px-3 py-2 text-sm text-mist-100 placeholder:text-mist-500/70 transition focus:border-signal-400/50 focus:bg-ink-900 focus:outline-none";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlBase, "min-h-24 resize-y font-mono text-[0.8rem] leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(controlBase, "h-10 appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label?: string; description?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition hover:border-white/12"
    >
      <span>
        {label ? <span className="block text-sm text-mist-100">{label}</span> : null}
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-mist-500">{description}</span> : null}
      </span>
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-signal-400" : "bg-ink-600")}>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-ink-950 transition-all", checked ? "left-4.5" : "left-0.5")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (value: T) => void; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-white/[0.07] bg-ink-900/60 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md font-medium transition",
              size === "sm" ? "px-2.5 py-1 text-[0.72rem]" : "px-3 py-1.5 text-xs",
              active ? "text-ink-950" : "text-mist-300 hover:text-mist-100",
            )}
          >
            {active ? (
              <motion.span layoutId={`seg-${size}`} className="absolute inset-0 rounded-md bg-signal-400" transition={{ type: "spring", stiffness: 320, damping: 26 }} />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── overlays ────────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, subtitle, children, footer, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-70 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className={cn("panel relative w-full p-5", width)}
          >
            <div className="mb-4 flex items-start justify-between gap-6">
              <div>
                <h2 className="text-base font-semibold">{title}</h2>
                {subtitle ? <p className="mt-1 text-xs leading-relaxed text-mist-500">{subtitle}</p> : null}
              </div>
              <IconButton label="Close dialog" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="max-h-[62vh] overflow-y-auto pr-1">{children}</div>
            {footer ? <div className="mt-5 flex items-center justify-end gap-2 hairline-t pt-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-sm leading-relaxed text-mist-300">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-glow" />
        <div>{message}</div>
      </div>
    </Modal>
  );
}

export function Tooltip({ content, children, side = "top" }: { content: string; children: React.ReactNode; side?: "top" | "bottom" }) {
  const [show, setShow] = React.useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      {children}
      <AnimatePresence>
        {show ? (
          <motion.span
            initial={{ opacity: 0, y: side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="tooltip"
            className={cn(
              "pointer-events-none absolute left-1/2 z-80 w-max max-w-60 -translate-x-1/2 rounded-md border border-white/10 bg-ink-850 px-2.5 py-1.5 text-[0.7rem] leading-snug text-mist-300 shadow-xl",
              side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            {content}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

export function Dropdown({ trigger, children, align = "right" }: { trigger: React.ReactNode; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="block" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {trigger}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn("panel absolute z-60 mt-2 min-w-56 overflow-hidden p-1.5", align === "right" ? "right-0" : "left-0")}
          >
            <div onClick={() => setOpen(false)}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({ icon, children, onClick, tone = "default", disabled }: { icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; tone?: "default" | "danger"; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.82rem] transition disabled:opacity-40",
        tone === "danger" ? "text-[#ffb4b7] hover:bg-alert-500/12" : "text-mist-300 hover:bg-white/[0.06] hover:text-mist-100",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── toaster ─────────────────────────────────────────────────────────────── */

const toastIcons = {
  info: <Globe className="size-4 text-violet-soft" />,
  success: <Check className="size-4 text-signal-300" />,
  warn: <TriangleAlert className="size-4 text-amber-glow" />,
  error: <XCircle className="size-4 text-alert-400" />,
};

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-90 flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="panel pointer-events-auto flex items-start gap-3 p-3.5"
          >
            <span className="mt-0.5">{toastIcons[toast.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.82rem] font-medium text-mist-100">{toast.title}</p>
              {toast.message ? <p className="mt-0.5 break-words text-[0.75rem] leading-relaxed text-mist-500">{toast.message}</p> : null}
            </div>
            <button type="button" aria-label="Dismiss notification" className="text-mist-500 transition hover:text-mist-100" onClick={() => dismiss(toast.id)}>
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── misc ────────────────────────────────────────────────────────────────── */

export function EmptyState({ icon, title, message, action }: { icon?: React.ReactNode; title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.09] bg-white/[0.015] px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-white/[0.04] text-mist-500">{icon ?? <Search className="size-5" />}</div>
      <p className="text-sm font-medium text-mist-100">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-mist-500">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, tone, hint, icon }: { label: string; value: React.ReactNode; tone?: "signal" | "warn" | "error"; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="panel-flat p-4">
      <div className="flex items-center justify-between">
        <span className="mono-label">{label}</span>
        <span className={cn("text-mist-500", tone === "signal" && "text-signal-300", tone === "warn" && "text-amber-glow", tone === "error" && "text-alert-400")}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-mist-100">{value}</p>
      {hint ? <p className="mt-1 text-[0.7rem] text-mist-500">{hint}</p> : null}
    </div>
  );
}

const iconMap: Record<string, React.ReactNode> = {
  "mouse-pointer": <MousePointer2 className="size-4" />,
  "mouse-pointer-click": <MousePointerClick className="size-4" />,
  "mouse-pointer-2": <MousePointer2 className="size-4" />,
  keyboard: <Keyboard className="size-4" />,
  globe: <Globe className="size-4" />,
  "app-window": <AppWindow className="size-4" />,
  "git-branch": <GitBranch className="size-4" />,
  move: <Move className="size-4" />,
  "arrows-up-down": <ArrowDownUp className="size-4" />,
  hand: <Hand className="size-4" />,
  "text-cursor-input": <FormInput className="size-4" />,
  "corner-down-left": <CornerDownLeft className="size-4" />,
  command: <Command className="size-4" />,
  link: <Link2 className="size-4" />,
  plus: <ArrowUpRight className="size-4" />,
  "panels-top-left": <PanelsTopLeft className="size-4" />,
  "rotate-cw": <RotateCw className="size-4" />,
  loader: <Loader2 className="size-4" />,
  crosshair: <Crosshair className="size-4" />,
  "form-input": <FormInput className="size-4" />,
  rocket: <Rocket className="size-4" />,
  minus: <Minimize2 className="size-4" />,
  maximize: <Maximize2 className="size-4" />,
  "square-x": <OctagonX className="size-4" />,
  timer: <Timer className="size-4" />,
  repeat: <Repeat className="size-4" />,
  "octagon-x": <OctagonX className="size-4" />,
  x: <X className="size-4" />,
};

export function ActionIcon({ name, className }: { name: string; className?: string }) {
  return <span className={cn("inline-flex", className)}>{iconMap[name] ?? <Globe className="size-4" />}</span>;
}

export function Code({ title, body, className }: { title?: string; body: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/70", className)}>
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-1.5">
        <span className="mono-label">{title ?? "shell"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(body);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="ml-auto rounded-md border border-white/[0.08] px-2 py-0.5 font-mono text-[0.62rem] text-mist-500 transition hover:text-mist-100"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[0.72rem] leading-relaxed text-mist-300">{body}</pre>
    </div>
  );
}

export const groupAccent: Record<string, string> = {
  mouse: "text-signal-300 bg-signal-400/10 border-signal-400/20",
  keyboard: "text-violet-soft bg-violet-soft/10 border-violet-soft/20",
  browser: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  desktop: "text-amber-glow bg-amber-glow/10 border-amber-glow/20",
  control: "text-[#ffb4b7] bg-alert-500/10 border-alert-500/20",
};
