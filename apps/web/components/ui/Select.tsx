"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "h-10 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-9 text-sm text-ink",
            "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
            "disabled:cursor-not-allowed disabled:bg-soft disabled:text-muted",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      </div>
    );
  },
);
