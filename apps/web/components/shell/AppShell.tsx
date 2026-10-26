"use client";

import { useState } from "react";
import { useRequireAuth } from "@/context/AuthContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

function ShellLoading() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-64 shrink-0 border-r border-line bg-surface p-4 lg:block">
        <Skeleton className="mb-6 h-10 bg-soft" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-9 bg-soft" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="mb-6 h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="mt-4 h-64" />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useRequireAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return <ShellLoading />;

  return (
    <div className="theme-fade min-h-screen bg-canvas text-ink">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={cn("transition-all duration-200", collapsed ? "lg:pl-16" : "lg:pl-64")}>
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="animate-rise mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
