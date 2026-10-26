"use client";

import { cn } from "@/lib/cn";

export interface PillOption {
  value: string;
  label: string;
  count?: number;
}

export function FilterPills({
  options,
  value,
  onChange,
  className,
}: {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
              active
                ? "border-accent bg-accent text-white shadow-sm"
                : "border-line bg-white text-muted hover:border-faint hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  active ? "bg-white/20 text-white" : "bg-soft text-muted",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
