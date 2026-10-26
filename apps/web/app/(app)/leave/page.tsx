"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Role-based landing: employees see their requests, approvers see the inbox. */
export default function LeaveLandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    const approver = ["hr", "md"].includes(user.role);
    router.replace(approver ? "/leave/approvals" : "/leave/my");
  }, [loading, user, router]);

  return <PageSkeleton />;
}
