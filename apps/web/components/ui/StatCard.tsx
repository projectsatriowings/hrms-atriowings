"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/useCountUp";

/** Counts 0 → value on mount for integer stats; renders en-IN grouping. */
function CountUpValue({ value }: { value: number }) {
  const current = useCountUp(value);
  return <>{new Intl.NumberFormat("en-IN").format(current)}</>;
}

export function StatCard({
  label,
  value,
  sub,
  href,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const inner = (
    <Card className={cn("p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">
            {typeof value === "number" ? <CountUpValue value={value} /> : value}
          </p>
          {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
        </div>
        {Icon && (
          <div className="bg-brand-gradient rounded-lg p-2.5 text-white shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
