"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Ban,
  Boxes,
  Check,
  CircleDot,
  Cpu,
  GitBranch,
  Globe,
  Hand,
  Keyboard,
  Lock,
  MousePointer2,
  Radio,
  Scan,
  ShieldCheck,
  SquareTerminal,
  Timer,
  Waves,
  Zap,
} from "lucide-react";

/* ── shared bits ──────────────────────────────────────────────────────────── */

function Reveal({ children, delay = 0, y = 18, className = "" }: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-mist-300">
      {icon ?? <Waves className="size-3 text-signal-300" />}
      {children}
    </span>
  );
}

function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`relative mx-auto w-full max-w-[78rem] px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  );
}

function Head({ eyebrow, title, lead }: { eyebrow: string; title: React.ReactNode; lead: string }) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-display text-[1.9rem] font-semibold leading-[1.12] tracking-tight sm:text-[2.35rem] text-balance-tight">{title}</h2>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-mist-300 sm:text-[1.02rem]">{lead}</p>
    </div>
  );
}

/* ── landing ──────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-ink-950 text-mist-100">
      <div className="pointer-events-none fixed inset-0 -z-10 grid-field opacity-[0.42] radial-fade" aria-hidden />
      <div className="pointer-events-none fixed left-1/2 top-[-24rem] -z-10 h-[42rem] w-[64rem] -translate-x-1/2 rounded-full bg-signal-500/[0.13] blur-[150px]" aria-hidden />
      <div className="pointer-events-none fixed right-[-14rem] top-[52rem] -z-10 h-[34rem] w-[34rem] rounded-full bg-violet-soft/[0.10] blur-[150px]" aria-hidden />

      <header className="sticky top-0 z-50 border-b border-white/[0.05] bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[78rem] items-center gap-4 px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-signal-400/12 ring-1 ring-signal-400/25">
              <Activity className="size-4.5 text-signal-300" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-[0.95rem] font-semibold tracking-tight">AutoPilot</span>
              <span className="block font-mono text-[0.58rem] uppercase tracking-[0.22em] text-mist-500">control center</span>
            </span>
          </Link>
          <nav aria-label="Sections" className="ml-4 hidden items-center gap-1 lg:flex">
            {[
              ["features", "Features"],
              ["how", "How it works"],
              ["workflows", "Workflows"],
              ["browser", "Browser"],
              ["desktop", "Desktop"],
              ["security", "Security"],
            ].map(([href, label]) => (
              <a key={href} href={`#${href}`} className="rounded-md px-3 py-1.5 text-[0.8rem] text-mist-500 transition hover:bg-white/[0.05] hover:text-mist-100">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="hidden rounded-lg px-3 py-2 text-[0.8rem] text-mist-300 transition hover:text-mist-100 sm:block">
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-signal-400 px-3.5 py-2 text-[0.8rem] font-semibold text-ink-950 transition hover:bg-signal-300"
            >
              Launch Dashboard <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <Section className="pt-16 pb-20 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <Reveal>
              <Eyebrow icon={<Radio className="size-3 text-signal-300" />}>local-first · agent-driven · audited</Eyebrow>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[3.6rem] lg:text-[4.1rem]">
                Control Your
                <span className="block text-mist-300">Digital Workspace</span>
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-5 max-w-xl text-[1.02rem] leading-relaxed text-mist-300">
                Automate your browser, desktop and repetitive workflows from one intelligent control center.
              </p>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-3 max-w-xl text-[0.86rem] leading-relaxed text-mist-500">
                A browser tab cannot touch your operating system — so it doesn&apos;t pretend to. The React dashboard sends allowlisted commands to
                the <span className="text-mist-300">AutoPilot agent</span>, which executes them on your own Windows machine and streams the results back live.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-xl bg-signal-400 px-5 py-3 font-semibold text-ink-950 shadow-[0_18px_44px_-20px_rgba(63,220,182,0.85)] transition hover:bg-signal-300"
                >
                  Launch Dashboard
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </Link>
                <Link href="/devices" className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3 text-[0.92rem] text-mist-100 transition hover:border-signal-400/40">
                  <Boxes className="size-4 text-signal-300" />
                  Connect Device
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.22}>
              <dl className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[
                  ["27", "allowlisted actions"],
                  ["0", "shell endpoints"],
                  ["250ms", "pointer telemetry"],
                  ["1 click", "emergency stop"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="font-display text-[1.5rem] font-semibold tabular-nums">{value}</dt>
                    <dd className="mt-0.5 text-[0.72rem] leading-snug text-mist-500">{label}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* architecture pipeline */}
          <Reveal delay={0.1} y={26}>
            <div className="panel relative overflow-hidden p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="mono-label">execution path</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-400/25 bg-signal-400/[0.07] px-2 py-0.5 text-[0.66rem] text-signal-200">
                  <span className="size-1.5 animate-pulse rounded-full bg-signal-400" /> handshake ok
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { icon: <Globe className="size-4" />, title: "React dashboard", body: "Vite-class SPA · Zustand · Framer Motion", meta: "/dashboard" },
                  { icon: <SquareTerminal className="size-4" />, title: "Node control plane", body: "REST + realtime stream · JWT · Zod · Postgres", meta: "api / stream" },
                  { icon: <Cpu className="size-4" />, title: "Local Windows agent", body: "Mouse · Keyboard · Windows · Playwright", meta: "device token" },
                  { icon: <MousePointer2 className="size-4" />, title: "Windows & browser", body: "Real input, real tabs, real focus changes", meta: "result ⇄ telemetry" },
                ].map((node, index) => (
                  <React.Fragment key={node.title}>
                    <div className="relative flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                      <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-signal-400/10 text-signal-300">{node.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.85rem] font-medium text-mist-100">{node.title}</span>
                        <span className="block text-[0.72rem] text-mist-500">{node.body}</span>
                      </span>
                      <span className="font-mono text-[0.62rem] text-mist-500">{node.meta}</span>
                    </div>
                    {index < 3 ? (
                      <div className="relative ml-6 h-6 w-px overflow-hidden bg-white/10">
                        <span className="absolute inset-x-0 top-0 h-2 rounded-full bg-signal-400 animate-scanline" style={{ animationDelay: `${index * 0.35}s` }} />
                      </div>
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
              <svg viewBox="0 0 400 60" className="mt-4 h-14 w-full" role="img" aria-label="Command and telemetry flow diagram">
                <path d="M4 40 C 90 4 150 56 200 30 S 320 6 396 26" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
                <path d="M4 40 C 90 4 150 56 200 30 S 320 6 396 26" fill="none" stroke="#3fdcb6" strokeWidth="1.6" className="animate-dash-flow" />
                <circle r="3.5" fill="#3fdcb6">
                  <animateMotion dur="3.4s" repeatCount="indefinite" path="M4 40 C 90 4 150 56 200 30 S 320 6 396 26" />
                </circle>
                <circle r="2.5" fill="#a78bfa">
                  <animateMotion dur="4.2s" begin="0.8s" repeatCount="indefinite" path="M396 26 C 320 6 200 30 150 56 S 90 4 4 40" />
                </circle>
                <text x="4" y="56" fill="rgba(179,193,209,0.55)" fontSize="8" fontFamily="monospace">commands →</text>
                <text x="330" y="14" fill="rgba(179,193,209,0.55)" fontSize="8" fontFamily="monospace">← results</text>
              </svg>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* how it works */}
      <Section id="how" className="py-16">
        <Reveal>
          <Head eyebrow="how it works" title="Four layers, one honest boundary" lead="The web app decides what should happen. The agent decides what is allowed. Your operating system does the work." />
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { n: "01", t: "Pair the device", b: "Generate PAIR-XXXX-XXXX in the dashboard, then run the agent with that code. It exchanges the code for a device token; only the token digest is stored.", i: <Boxes className="size-4" /> },
            { n: "02", t: "Compose the intent", b: "Build a workflow visually, drive the mouse/keyboard panels, or hit record. Every step is validated against the shared command schema.", i: <GitBranch className="size-4" /> },
            { n: "03", t: "Execute on the machine", b: "Commands stream to the agent, which moves the real pointer, sends real keystrokes and drives a Playwright Chromium session.", i: <Cpu className="size-4" /> },
            { n: "04", t: "Watch and intervene", b: "Live logs, pointer telemetry and window/tab updates stream back. Pause, resume, stop or emergency-stop at any moment.", i: <SquareTerminal className="size-4" /> },
          ].map((step, index) => (
            <Reveal key={step.n} delay={index * 0.06}>
              <div className="group panel h-full p-5 transition hover:border-signal-400/25">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[0.7rem] text-signal-300">{step.n}</span>
                  <span className="grid size-8 place-items-center rounded-lg bg-white/[0.04] text-mist-300 transition group-hover:text-signal-300">{step.i}</span>
                </div>
                <h3 className="mt-3 font-display text-[1.06rem] font-semibold">{step.t}</h3>
                <p className="mt-2 text-[0.8rem] leading-relaxed text-mist-500">{step.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* features bento */}
      <Section id="features" className="py-16">
        <Reveal>
          <Head eyebrow="capabilities" title="Everything a real automation stack needs" lead="Not a to-do list of mock buttons: each card below maps to an endpoint, a command type and an agent capability." />
        </Reveal>
        <div className="mt-10 grid gap-4 lg:grid-cols-6">
          <Reveal className="lg:col-span-4">
            <FeatureCard
              icon={<Keyboard className="size-4" />}
              title="Mouse, keyboard and window control"
              body="Absolute pointer moves with easing, clicks, drags, scroll notches, allowlisted keys and hotkeys (CTRL+ALT+TAB, CTRL+SHIFT+ESC), window focus, minimise and maximise. Coordinates are validated against the agent's display resolution."
              code={`MOVE_MOUSE  { x: 820, y: 430, durationMs: 900 }
CLICK_MOUSE   { button: "left" }
HOTKEY        { modifiers: ["CTRL","SHIFT"], key: "ESC" }
FOCUS_WINDOW  { windowId: "win-chrome" }`}
            />
          </Reveal>
          <Reveal delay={0.05} className="lg:col-span-2">
            <FeatureCard
              icon={<Ban className="size-4 text-alert-400" />}
              title="Emergency stop"
              body="One button and one configurable OS shortcut cancel running executions, flush the queued commands and mark the history entry stopped."
              tone="danger"
            />
          </Reveal>
          <Reveal delay={0.08} className="lg:col-span-2">
            <FeatureCard
              icon={<Scan className="size-4" />}
              title="Recorder → editable workflow"
              body="Capture routed actions (and OS input hooks from the agent), stop, and get a draft workflow you edit before replay. Password-looking input is masked, never stored."
            />
          </Reveal>
          <Reveal delay={0.11} className="lg:col-span-4">
            <FeatureCard
              icon={<Timer className="size-4" />}
              title="Scheduler that respects the device"
              body="Run once, daily, weekly, interval or cron. Each schedule is bound to one device: when that agent is offline the run is skipped or queued per policy — it is never silently executed on another machine."
              code={`Daily Research Routine
  device  My Windows PC
  when    every day 09:00
  offline SKIP  (logged, not relocated)`}
            />
          </Reveal>
        </div>
      </Section>

      {/* workflows */}
      <Section id="workflows" className="py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-center">
          <Reveal>
            <Head
              eyebrow="workflow automation"
              title="A visual builder over a real execution engine"
              lead="Drag actions into a sequence, tune delay, timeout and retries per step, disable a step without deleting it, and run it in dry-run first."
            />
            <ul className="mt-7 space-y-2.5">
              {[
                "Five action groups: mouse, keyboard, browser, desktop, control flow",
                "Delay · Repeat (with sub-actions) · Condition · Stop interpreted by the engine",
                "Sequential execution with a per-device lock — no conflicting runs",
                "Pause between actions, resume in place, stop mid-run, cancel on disconnect",
                "Every step writes a timeline entry, log line and duration",
              ].map((item) => (
                <li key={item} className="flex gap-2.5 text-[0.86rem] text-mist-300">
                  <Check className="mt-0.5 size-4 shrink-0 text-signal-300" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
                <GitBranch className="size-3.5 text-signal-300" />
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-mist-500">Daily Research Routine</span>
                <span className="ml-auto rounded-full border border-amber-glow/25 bg-amber-glow/10 px-2 py-0.5 text-[0.62rem] text-amber-glow">dry run</span>
              </div>
              <ol className="divide-y divide-white/[0.05]">
                {[
                  { icon: <Zap className="size-3.5" />, label: "Open application", detail: "Chrome", tone: "text-amber-glow" },
                  { icon: <Globe className="size-3.5" />, label: "Open URL", detail: "youtube.com", tone: "text-emerald-300" },
                  { icon: <Timer className="size-3.5" />, label: "Wait for page", detail: "load", tone: "text-mist-300" },
                  { icon: <MousePointer2 className="size-3.5" />, label: "Click element", detail: "role=button name=Search", tone: "text-signal-300" },
                  { icon: <Keyboard className="size-3.5" />, label: "Type text", detail: "“automation tutorials”", tone: "text-violet-soft" },
                  { icon: <Hand className="size-3.5" />, label: "Scroll", detail: "down ×4", tone: "text-signal-300" },
                ].map((row, index) => (
                  <motion.li
                    key={row.label}
                    initial={{ opacity: 0.45, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.07 }}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="w-4 font-mono text-[0.66rem] text-mist-500">{index + 1}</span>
                    <span className={row.tone}>{row.icon}</span>
                    <span className="text-[0.82rem] text-mist-100">{row.label}</span>
                    <span className={`ml-auto truncate font-mono text-[0.7rem] ${row.tone}`}>{row.detail}</span>
                  </motion.li>
                ))}
              </ol>
              <div className="flex items-center gap-3 border-t border-white/[0.06] bg-ink-950/50 px-4 py-2.5 font-mono text-[0.68rem] text-mist-500">
                <span className="text-signal-300">6/6 completed</span>
                <span>·</span>
                <span>avg 412ms/step</span>
                <span className="ml-auto">retry 1 · timeout 15000ms</span>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* browser */}
      <Section id="browser" className="py-16">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <Reveal>
            <Head
              eyebrow="browser automation"
              title="DOM locators first, pixels only as a last resort"
              lead={'Playwright drives a Chromium-based browser through the agent. Prefer button[data-testid="login"] over x=830 y=420 so your workflow survives a layout change.'}
            />
            <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {[
                ["css", 'button[data-testid="login"]'],
                ["text", '"Continue with SSO"'],
                ["role", 'role=button name="Submit"'],
                ["label", 'label="Search"'],
                ["placeholder", 'placeholder="Type here"'],
                ["waits", "page lifecycle + selector"],
              ].map(([kind, sample]) => (
                <div key={kind} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="mono-label">{kind}</p>
                  <p className="mt-1 truncate font-mono text-[0.74rem] text-emerald-300">{sample}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.07}>
            <div className="panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <CircleDot className="size-3.5 text-emerald-300" />
                <p className="mono-label">tabs · chromium (playwright)</p>
                <span className="ml-auto text-[0.66rem] text-mist-500">3 open</span>
              </div>
              <div className="space-y-2">
                {[
                  { title: "YouTube", url: "https://www.youtube.com/watch?v=…", active: true },
                  { title: "Inbox — AutoPilot", url: "https://autopilot.dev/inbox", active: false },
                  { title: "GitHub", url: "https://github.com/login", active: false },
                ].map((tab) => (
                  <div key={tab.title} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${tab.active ? "border-emerald-400/30 bg-emerald-400/[0.06]" : "border-white/[0.07] bg-white/[0.02]"}`}>
                    <span className="grid size-6 place-items-center rounded bg-white/[0.05] font-mono text-[0.62rem] text-mist-500">{tab.active ? "▶" : "○"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8rem] text-mist-100">{tab.title}</span>
                      <span className="block truncate font-mono text-[0.66rem] text-mist-500">{tab.url}</span>
                    </span>
                    {tab.active ? <span className="rounded-full border border-emerald-400/25 px-1.5 py-0.5 text-[0.6rem] text-emerald-300">active</span> : null}
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-ink-950/60 p-3 font-mono text-[0.7rem] leading-relaxed text-mist-500">
                <p>
                  <span className="text-emerald-300">await</span>
                  {" page.getByRole("}
                  <span className="text-amber-glow">{"\"button\""}</span>
                  {", { name: "}
                  <span className="text-amber-glow">{"\"Submit\""}</span>
                  {" }).click()"}
                </p>
                <p className="mt-1 text-signal-300">→ action:completed · 218ms</p>
              </div>
              <p className="mt-3 text-[0.72rem] leading-relaxed text-mist-500">
                Open, switch, create, close and reload tabs; wait for a page or selector; click and fill through locators with timeout and retry. Attaching to
                your existing Chrome uses a CDP endpoint you explicitly enable — never a silent profile grab.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* desktop control */}
      <Section id="desktop" className="py-16">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <div className="panel h-full p-5">
              <Head eyebrow="desktop control" title="Windows apps, launched from profiles you configure" lead="No hardcoded paths and no arbitrary executables. The agent only accepts an applicationId that maps to a profile you created, and disruptive actions need confirmation." />
              <div className="mt-6 space-y-2">
                {[
                  { app: "Chrome", path: "chrome.exe", state: "focused" },
                  { app: "Visual Studio Code", path: "code.exe", state: "normal" },
                  { app: "Windows Terminal", path: "wt.exe", state: "maximized" },
                  { app: "Notepad", path: "notepad.exe", state: "minimized" },
                ].map((win) => (
                  <div key={win.app} className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <span className="grid size-7 place-items-center rounded bg-amber-glow/10 text-amber-glow"><Cpu className="size-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8rem] text-mist-100">{win.app}</span>
                      <span className="block font-mono text-[0.64rem] text-mist-500">{win.path}</span>
                    </span>
                    <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[0.62rem] text-mist-300">{win.state}</span>
                    <span className="flex gap-1">
                      {["focus", "min", "max"].map((action) => (
                        <span key={action} className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[0.6rem] text-mist-500">{action}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.07}>
            <div className="panel flex h-full flex-col gap-4 p-5">
              <div>
                <p className="mono-label mb-2">live pointer · 1920×1080</p>
                <div className="relative aspect-[16/9] overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950 grid-field">
                  <motion.span
                    className="absolute"
                    animate={{ left: ["18%", "62%", "38%", "74%", "18%"], top: ["70%", "26%", "52%", "68%", "70%"] }}
                    transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <MousePointer2 className="size-5 fill-signal-400 text-signal-200 drop-shadow-[0_0_10px_rgba(63,220,182,0.8)]" />
                  </motion.span>
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/[0.06] bg-ink-950/80 px-3 py-1.5 font-mono text-[0.62rem] text-mist-500">
                    <span>drag · scroll · right-click · double-click</span>
                    <span className="text-signal-300">x 1240 · y 320</span>
                  </span>
                </div>
              </div>
              <div>
                <p className="mono-label mb-2">keyboard allowlist</p>
                <div className="flex flex-wrap gap-1.5">
                  {["ENTER", "TAB", "ESC", "CTRL+C", "CTRL+V", "ALT+TAB", "CTRL+SHIFT+ESC", "WIN+D", "F5", "PAGEUP"].map((key) => (
                    <span key={key} className="rounded-md border border-violet-soft/25 bg-violet-soft/[0.07] px-2 py-1 font-mono text-[0.66rem] text-violet-soft">{key}</span>
                  ))}
                </div>
                <p className="mt-2.5 text-[0.72rem] leading-relaxed text-mist-500">
                  Raw key codes, scanned codes and injected driver payloads are rejected at the API edge and again inside the agent.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* monitoring + security */}
      <Section id="security" className="py-16">
        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal>
            <div className="panel h-full overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
                <SquareTerminal className="size-3.5 text-signal-300" />
                <span className="mono-label">live console</span>
                <span className="ml-auto flex gap-1">
                  {["clear", "pause", "stop"].map((action) => (
                    <span key={action} className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[0.6rem] text-mist-500">{action}</span>
                  ))}
                </span>
              </div>
              <div className="space-y-1.5 bg-ink-950/70 p-4 font-mono text-[0.72rem] leading-relaxed">
                {[
                  ["15:40:02", "Workflow started — Daily Browser Routine", "text-mist-300"],
                  ["15:40:03", "Opening Chrome", "text-mist-300"],
                  ["15:40:05", "Chrome connected · Playwright 1.49", "text-signal-300"],
                  ["15:40:06", "[MOVE_MOUSE] Moving mouse → 800,500 (600ms)", "text-mist-300"],
                  ["15:40:07", "[CLICK_MOUSE] Clicking left", "text-mist-300"],
                  ["15:40:10", "[SWITCH_BROWSER_TAB] Switching tab → YouTube", "text-violet-soft"],
                  ["15:40:13", "⚠ element not found · retry 1/2", "text-amber-glow"],
                  ["15:40:15", "Workflow completed · 3.1s · 11 actions", "text-signal-300"],
                ].map(([time, message, tone], index) => (
                  <motion.p
                    key={String(time) + String(message)}
                    initial={{ opacity: 0, x: -6 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.06 }}
                    className={tone}
                  >
                    <span className="text-mist-500">{time}</span> {message}
                  </motion.p>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] p-4 sm:grid-cols-4">
                {[
                  ["Backend", "Connected", true],
                  ["Socket", "Live", true],
                  ["Agent", "Connected", true],
                  ["Chrome", "Connected", true],
                ].map(([label, value, ok]) => (
                  <div key={String(label)} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
                    <p className="mono-label">{label}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[0.76rem] text-mist-100">
                      <span className={`size-1.5 rounded-full ${ok ? "bg-signal-400" : "bg-amber-glow"}`} />
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="panel h-full p-5">
              <Eyebrow icon={<ShieldCheck className="size-3 text-signal-300" />}>security model</Eyebrow>
              <h3 className="mt-4 font-display text-[1.5rem] font-semibold leading-tight tracking-tight">Hard limits, not soft suggestions</h3>
              <div className="mt-5 space-y-2.5">
                {[
                  { i: <Lock className="size-4" />, t: "Allowlist, twice", b: "Every command is parsed by a Zod schema in the control plane and re-validated in the agent. Unknown types are dropped and audited." },
                  { i: <ShieldCheck className="size-4" />, t: "No shell surface", b: "There is no /execute-shell endpoint, no PowerShell bridge and no arbitrary executable launch anywhere in the codebase." },
                  { i: <KeyIcon />, t: "Device tokens", b: "Pairing codes are single-use and expire in 10 minutes. The agent token is returned once and stored only as a SHA-256 digest." },
                  { i: <Zap className="size-4" />, t: "Rate limits & hardening", b: "Helmet headers, CORS allowlist, request size caps, per-bucket rate limits and authenticated realtime channels." },
                  { i: <Scan className="size-4" />, t: "Audit trail", b: "User, device, workflow, action, timestamp and result are written for every action and stored with the execution." },
                ].map((row) => (
                  <div key={row.t} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-signal-400/10 text-signal-300">{row.i}</span>
                    <span>
                      <span className="block text-[0.85rem] text-mist-100">{row.t}</span>
                      <span className="block text-[0.75rem] leading-relaxed text-mist-500">{row.b}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-alert-500/25 bg-alert-500/[0.06] p-3">
                <p className="text-[0.78rem] leading-relaxed text-[#ffb4b7]">
                  <span className="font-semibold">Explicitly impossible:</span> reading your other tabs' passwords, installing software, editing the registry,
                  or running a command the platform didn&apos;t define. If a Windows API needs elevation, the agent reports it instead of retrying silently.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* CTA */}
      <Section className="py-16 pb-24">
        <Reveal>
          <div className="panel relative overflow-hidden p-8 sm:p-12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(63,220,182,0.14),transparent_55%)]" aria-hidden />
            <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div>
                <h2 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight sm:text-[2.3rem] text-balance-tight">
                  Run your first workflow in the next five minutes
                </h2>
                <p className="mt-3 max-w-xl text-[0.92rem] leading-relaxed text-mist-300">
                  Clone, install, start the control plane, pair the agent. The dashboard ships with a simulated workstation so you can rehearse the entire
                  engine — then point the same commands at your real Windows PC.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-signal-400 px-5 py-3 font-semibold text-ink-950 transition hover:bg-signal-300">
                    Launch Dashboard <ArrowRight className="size-4" />
                  </Link>
                  <Link href="/devices" className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3 text-[0.92rem] transition hover:border-signal-400/40">
                    <Boxes className="size-4 text-signal-300" /> Connect Device
                  </Link>
                  <Link href="/recorder" className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-[0.9rem] text-mist-300 transition hover:text-mist-100">
                    <Scan className="size-4" /> Try the recorder
                  </Link>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-ink-950/70 p-4 font-mono text-[0.74rem] leading-relaxed">
                <p className="text-mist-500"># three terminals</p>
                <p className="mt-2 text-mist-100"><span className="text-signal-300">$</span> npm install</p>
                <p className="mt-1 text-mist-100"><span className="text-signal-300">$</span> npm run dev:server   <span className="text-mist-500"># :4000</span></p>
                <p className="mt-1 text-mist-100"><span className="text-signal-300">$</span> npm run dev:client  <span className="text-mist-500"># :5173</span></p>
                <p className="mt-1 text-mist-100"><span className="text-signal-300">$</span> cd agent && npm.cmd start -- --pair PAIR-7QK2-M4XZ</p>
                <p className="mt-3 border-t border-white/[0.06] pt-3 text-mist-500">
                  agent 1.0.0 · windows 11 · capability=mouse,keyboard,windows,browser,recorder
                  <br />
                  <span className="text-signal-300">paired</span> → dashboard shows <span className="text-mist-100">My Windows PC · online</span>
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>

      <footer className="border-t border-white/[0.06] py-8">
        <Section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.76rem] text-mist-500">
            AutoPilot Control Center · the local agent executes desktop actions on your own computer · MIT-licensed reference implementation
          </p>
          <p className="flex items-center gap-3 font-mono text-[0.68rem] text-mist-500">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-signal-400" /> engine ok</span>
            <span>docs/ · architecture · agent · workflows · security · api</span>
          </p>
        </Section>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  code,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  code?: string;
  tone?: "danger";
}) {
  return (
    <div className={`panel h-full p-5 transition hover:-translate-y-0.5 ${tone === "danger" ? "border-alert-500/25" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid size-8 place-items-center rounded-lg ${tone === "danger" ? "bg-alert-500/12 text-alert-400" : "bg-signal-400/10 text-signal-300"}`}>{icon}</span>
        <h3 className="font-display text-[1.05rem] font-semibold">{title}</h3>
      </div>
      <p className="mt-2.5 text-[0.82rem] leading-relaxed text-mist-500">{body}</p>
      {code ? (
        <pre className="mt-3.5 overflow-x-auto rounded-lg border border-white/[0.06] bg-ink-950/70 p-3 font-mono text-[0.7rem] leading-relaxed text-mist-300">
          {code}
        </pre>
      ) : null}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8M16 16l2-2M19 19l2-2" />
    </svg>
  );
}
