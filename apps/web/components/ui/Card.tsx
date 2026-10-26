import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("theme-fade rounded-2xl border border-line bg-surface shadow-sm", className)}>
      {children}
    </div>
  );
}
