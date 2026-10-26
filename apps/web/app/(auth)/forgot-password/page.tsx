"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";

/**
 * Forgot-password entry page: sends the reset email via the API. The API
 * response is enumeration-safe (same message whether or not the account
 * exists); when no mailer is configured it returns 503 and we say so.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_not_configured") {
        setError("Password reset email is not configured — ask HR to reset your password.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not send the reset email. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold text-ink">Forgot password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your work email and we will send you a link to reset your password.
        </p>
        {sent ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>If an account exists for this email, a reset link has been sent. It expires in 1 hour.</span>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-5" noValidate>
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <FormField label="Work email" required>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@company.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <Button type="submit" loading={submitting} className="w-full" size="lg">
              Send reset link
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
