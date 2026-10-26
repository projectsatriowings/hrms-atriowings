"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageSkeleton } from "@/components/ui/Skeleton";

export default function BillingLandingPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/billing/invoices");
  }, [router]);
  return <PageSkeleton />;
}
