"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-[96px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink",
          "placeholder:text-faint",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
          "disabled:cursor-not-allowed disabled:bg-soft",
          className,
        )}
        {...rest}
      />
    );
  },
);
