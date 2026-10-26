import { cn } from "@/lib/cn";
import { prettify } from "@/lib/format";

type BadgeVariant = "emerald" | "rose" | "amber" | "orange" | "slate" | "navy" | "blue" | "accent";

const VARIANTS: Record<BadgeVariant, string> = {
  emerald: "bg-success-soft text-success ring-success/25",
  rose: "bg-danger-soft text-danger ring-danger/25",
  amber: "bg-warning-soft text-warning ring-warning/25",
  orange: "bg-warning-soft text-warning ring-warning/25",
  slate: "bg-soft text-muted ring-line",
  navy: "bg-ink text-canvas ring-ink/20",
  blue: "bg-info-soft text-info ring-info/25",
  accent: "bg-accent-soft text-accent-ink ring-accent/25",
};

export function Badge({
  variant = "slate",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  present: "emerald",
  approved: "emerald",
  paid: "emerald",
  active: "emerald",
  accepted: "emerald",
  sent: "blue",
  converted: "accent",
  issued: "navy",
  finalized: "navy",
  absent: "rose",
  rejected: "rose",
  overdue: "rose",
  exited: "rose",
  on_leave: "amber",
  pending: "amber",
  on_notice: "amber",
  in_review: "amber",
  partially_paid: "amber",
  expired: "amber",
  missing_checkout: "orange",
  half_day: "orange",
  draft: "slate",
  weekly_off: "slate",
  holiday: "slate",
  cancelled: "slate",
};

/** Status pill following the design-system color map. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = status.toLowerCase().replace(/[-\s]+/g, "_");
  return <Badge variant={STATUS_VARIANT[key] ?? "slate"}>{label ?? prettify(status)}</Badge>;
}
