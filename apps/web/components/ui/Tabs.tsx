"use client";

import { cn } from "@/lib/cn";

export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} role="tablist">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "text-accent-ink" : "text-muted hover:text-inksoft",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-xs",
                  active ? "bg-accent-soft text-accent-ink" : "bg-soft text-muted",
                )}
              >
                {t.count}
              </span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}
