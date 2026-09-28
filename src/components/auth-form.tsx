"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Eye, EyeOff, Lock, Mail, ShieldCheck, User as UserIcon, Zap } from "lucide-react";
import { ApiClientError, useAuth } from "@/lib/client";
import { Button, Field, Input, StatusDot } from "@/components/ui";
import { loginSchema, registerSchema } from "@autopilot/shared";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const [values, setValues] = React.useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const schema = mode === "login" ? loginSchema : registerSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await login(values.email, values.password);
      else await register(values.name, values.email, values.password);
      router.replace(params.get("next") || "/dashboard");
    } catch (error) {
      setFormError(error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink-950 px-4 py-10">
      <div className="pointer-events-none absolute inset-0 grid-field opacity-40 radial-fade" aria-hidden />
      <div className="pointer-events-none absolute -left-32 top-10 h-80 w-80 rounded-full bg-signal-500/12 blur-[120px]" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-violet-soft/12 blur-[120px]" aria-hidden />

      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <motion.div initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-signal-400/12 ring-1 ring-signal-400/25">
              <Activity className="size-4.5 text-signal-300" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-[0.95rem] font-semibold">AutoPilot</span>
              <span className="block font-mono text-[0.6rem] uppercase tracking-[0.2em] text-mist-500">control center</span>
            </span>
          </Link>
          <h1 className="font-display text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-balance sm:text-[2.6rem]">
            {mode === "login" ? "Back at the console." : "Your workspace, on autopilot."}
          </h1>
          <p className="mt-3 max-w-md text-[0.92rem] leading-relaxed text-mist-300">
            Sign in to reach the dashboard that drives mouse, keyboard, browser and desktop automation through a local agent on your own computer.
          </p>
          <ul className="mt-7 space-y-2.5">
            {[
              { icon: <ShieldCheck className="size-4" />, title: "Allowlisted commands only", body: "No shell, no PowerShell, no arbitrary executables — the agent rejects anything outside the schema." },
              { icon: <Zap className="size-4" />, title: "Pause, resume, emergency stop", body: "Cooperative cancellation between every action, with an OS-level shortcut handled by the agent." },
              { icon: <Lock className="size-4" />, title: "Local-first credentials", body: "bcrypt password hashing, JWT sessions in httpOnly cookies, device tokens stored only as digests." },
            ].map((item) => (
              <li key={item.title} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-signal-400/10 text-signal-300">{item.icon}</span>
                <span>
                  <span className="block text-[0.83rem] text-mist-100">{item.title}</span>
                  <span className="block text-[0.74rem] leading-relaxed text-mist-500">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="panel p-6">
          <div className="mb-5 flex items-center gap-2">
            <StatusDot state="online" size={7} />
            <span className="mono-label">{mode === "login" ? "operator sign in" : "create operator account"}</span>
          </div>
          <form onSubmit={submit} className="space-y-3.5" noValidate>
            {mode === "register" ? (
              <Field label="Name" error={errors.name}>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
                  <Input
                    autoComplete="name"
                    value={values.name}
                    onChange={(event) => setValues({ ...values, name: event.target.value })}
                    placeholder="Ada Lovelace"
                    className="pl-9"
                  />
                </div>
              </Field>
            ) : null}
            <Field label="Email" error={errors.email}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
                <Input
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(event) => setValues({ ...values, email: event.target.value })}
                  placeholder="you@studio.dev"
                  className="pl-9"
                />
              </div>
            </Field>
            <Field
              label="Password"
              error={errors.password}
              hint={mode === "register" ? "At least 8 characters with a letter and a number." : undefined}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={values.password}
                  onChange={(event) => setValues({ ...values, password: event.target.value })}
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mist-500 transition hover:text-mist-100"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {formError ? (
              <p role="alert" className="rounded-lg border border-alert-500/30 bg-alert-500/10 px-3 py-2 text-[0.78rem] text-[#ffb4b7]">
                {formError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {mode === "login" ? "Enter control center" : "Create account & seed workspace"}
            </Button>
          </form>

          <p className="mt-4 text-center text-[0.78rem] text-mist-500">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link href="/register" className="text-signal-300 underline-offset-4 hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already paired?{" "}
                <Link href="/login" className="text-signal-300 underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.7rem] leading-relaxed text-mist-500">
            New accounts receive a simulated workstation so every engine feature is testable immediately. Pair a Windows PC for real OS control.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
