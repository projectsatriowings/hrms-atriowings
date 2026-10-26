"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiPost, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

/**
 * Forced password-change step: reached via AuthContext.login() when the
 * login response carries mustChangePassword (temporary/auto-created
 * passwords, or after an admin reset). The API also enforces this: until
 * this form succeeds, the session may only call auth endpoints.
 */
export default function ChangePasswordPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      await apiPost("/auth/change-password", { currentPassword, newPassword });
      await refreshUser();
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Password change failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold text-ink">Change your password</h1>
        <p className="mt-1 text-sm text-muted">
          {user ? `Signed in as ${user.email}. ` : ""}You are using a temporary password — set a new one to continue.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-inksoft">Current (temporary) password</label>
            <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-inksoft">New password (min 8 characters)</label>
            <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-inksoft">Confirm new password</label>
            <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <Button className="w-full" loading={submitting} type="submit">Change password and continue</Button>
        </form>
      </Card>
    </div>
  );
}
