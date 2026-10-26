"use client";

import { Search } from "lucide-react";
import { Input } from "./Input";
import { cn } from "@/lib/cn";

export function SearchInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <Input className="pl-9" {...rest} />
    </div>
  );
}
