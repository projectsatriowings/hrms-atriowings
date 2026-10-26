"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/lib/api";

/**
 * MFA challenge step: reached only via AuthContext.login(), which navigates
 * here itself on an mfa_required response (see the login-page constraint
 * comment in AuthContext). Accepts a TOTP code from the authenticator app,
 * or — via the fallback link — one of the one-time recovery codes issued at
 * setup. A recovery code works once; reuse is rejected by the API.
 */
export default function MfaPage() {
  const { pendingMfaToken, completeMfaLogin } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const mustChangePassword = await completeMfaLogin(code.trim());
      router.push(mustChangePassword ? "/change-password" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!pendingMfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <Card className="w-full max-w-md p-6 sm:p-8">
          <h1 className="text-xl font-bold text-ink">MFA session expired</h1>
          <p className="mt-2 text-sm text-muted">Your verification session has expired. Please sign in again.</p>
          <Button className="mt-6 w-full" onClick={() => router.push("/login")}>Back to sign-in</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold text-ink">Two-factor verification</h1>
        <p className="mt-1 text-sm text-muted">
          {useRecovery
            ? "Enter one of your one-time recovery codes. Each code works only once."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label htmlFor="mfa-code" className="mb-1.5 block text-sm font-medium text-inksoft">
              {useRecovery ? "Recovery code" : "Authenticator code"}
            </label>
            <Input
              id="mfa-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useRecovery ? "XXXXX-XXXXX" : "123456"}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          <Button className="w-full" loading={submitting} type="submit">Verify and sign in</Button>
          <button
            type="button"
            className="w-full text-center text-sm text-accent hover:underline"
            onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(null); }}
          >
            {useRecovery ? "Use an authenticator code instead" : "Use a recovery code instead"}
          </button>
        </form>
      </Card>
    </div>
  );
}
