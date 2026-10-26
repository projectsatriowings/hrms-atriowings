"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";

/**
 * Reset-password page reached from the email link
 * (/reset-password?token=...). The token is single-use and expires in
 * 1 hour; the API enforces both.
 */
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is missing its token. Please request a new link.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/reset-password", { token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Password reset failed. The link may have expired — please request a new one.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">Choose a new password for your account.</p>
        {done ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Password reset. <Link href="/login" className="underline">Sign in</Link> with your new password.
            </span>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-5" noValidate>
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <FormField label="New password" required>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </FormField>
            <FormField label="Confirm new password" required>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </FormField>
            <Button type="submit" loading={submitting} className="w-full" size="lg">
              Reset password
            </Button>
          </form>
        )}
        <p className="mt-5 text-center text-sm">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
