"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { loginSchema, type LoginInput } from "@hrms/shared";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LogoMark } from "@/components/brand/Logo";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const onSubmit = async (data: LoginInput) => {
    setServerError(null);
    try {
      await login(data.email, data.password);
      router.push("/dashboard");
    } catch (e) {
      setServerError(
        e instanceof ApiError
          ? e.status === 401
            ? "Invalid email or password. Please try again."
            : e.message
          : "Sign-in failed. Please try again.",
      );
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      {/* Animated aurora backdrop */}
      <div
        aria-hidden
        className="animate-drift no-print pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/25 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-drift-slow no-print pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent-2/25 blur-3xl"
      />
      <div
        aria-hidden
        className="no-print pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="animate-rise relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-16 w-16 drop-shadow-md" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Attenza</h1>
          <p className="mt-1 text-sm text-muted">HR without the follow-up</p>
        </div>

        <Card className="glass-card p-6 shadow-xl sm:p-8">
          <p className="mb-5 text-sm font-medium text-inksoft">Sign in to your workspace</p>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {serverError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}
            <FormField label="Work email" error={errors.email?.message} required>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@company.in"
                {...register("email")}
              />
            </FormField>
            <FormField label="Password" error={errors.password?.message} required>
              <Input type="password" autoComplete="current-password" placeholder="••••••••" {...register("password")} />
            </FormField>
            <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
              Sign in
            </Button>
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="text-accent hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-faint">
          Protected workspace. Contact HR for access.
        </p>
      </div>
    </div>
  );
}
