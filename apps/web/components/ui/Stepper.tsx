"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Horizontal wizard stepper. `current` is the 0-based active step. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-0 overflow-x-auto">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-accent text-white",
                  active && "bg-accent text-white ring-4 ring-accent/15",
                  !done && !active && "bg-soft text-muted",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium",
                  active ? "text-ink" : "text-muted",
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && <span className="mx-3 h-px min-w-6 flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Alias used by the payroll workspace guided flow. */
export const ProgressSteps = Stepper;
