"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { navFor } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { InstallButton } from "@/components/pwa/InstallButton";
import { LogoMark } from "@/components/brand/Logo";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { user } = useAuth();
  const pathname = usePathname();
  if (!user) return null;
  const sections = navFor(user.role);

  const nav = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <LogoMark className="h-9 w-9 shrink-0 drop-shadow-sm" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-ink">Attenza</p>
            <p className="truncate text-[11px] text-faint">{user.companyName}</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            {!collapsed && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onCloseMobile}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all duration-150",
                        collapsed && "justify-center px-0",
                        !collapsed && "hover:translate-x-0.5",
                        active
                          ? "bg-accent-soft font-semibold text-accent-ink"
                          : "text-muted hover:bg-soft hover:text-ink",
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="bg-brand-gradient absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                        />
                      )}
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Install + collapse (desktop) */}
      <div className="hidden shrink-0 space-y-1 border-t border-line p-2.5 lg:block">
        <InstallButton collapsed={collapsed} />
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-xs text-faint transition-colors duration-150 hover:bg-soft hover:text-ink"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          "theme-fade fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface transition-all duration-200 lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/45" onClick={onCloseMobile} aria-hidden />
          <aside className="theme-fade absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface shadow-xl">
            <button
              onClick={onCloseMobile}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-faint transition-colors duration-150 hover:bg-soft hover:text-ink"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
