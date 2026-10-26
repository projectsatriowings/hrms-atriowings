import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-lg", className)}
      style={{
        backgroundImage: "linear-gradient(100deg, rgb(var(--soft)) 40%, rgb(var(--line)) 50%, rgb(var(--soft)) 60%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
      }}
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
