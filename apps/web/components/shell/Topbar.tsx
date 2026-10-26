"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { SearchInput } from "@/components/ui/SearchInput";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { apiGet, ApiError } from "@/lib/api";
import { titleFor } from "@/lib/nav";
import { roleLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const canSearchEmployees = !!user && ["hr", "md"].includes(user.role);
  const isApprover = !!user && ["hr", "md"].includes(user.role);

  // Pending approvals badge
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        if (isApprover) {
          const r = await apiGet<{ total: number }>("/leave/requests/pending", { pageSize: 1 });
          if (!cancelled) setPending(r.total);
        } else {
          const r = await apiGet<{ total: number }>("/leave/requests/me", { status: "pending", pageSize: 1 });
          if (!cancelled) setPending(r.total);
        }
      } catch {
        if (!cancelled) setPending(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isApprover, pathname]);

  // Close user menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const runSearch = async () => {
    const q = search.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const r = await apiGet<{ data: Array<{ id: string; fullName: string }> }>("/employees", {
        search: q,
        pageSize: 5,
      });
      if (r.data.length > 0) {
        router.push(`/employees/${r.data[0]!.id}`);
        setSearch("");
      } else {
        toast(`No employee found for "${q}"`, "info");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Search failed", "error");
    } finally {
      setSearching(false);
    }
  };

  return (
    <header className="theme-fade no-print sticky top-0 z-30 border-b border-line bg-surface/70 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-soft lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-ink sm:text-lg">
          {titleFor(pathname)}
        </h1>

        {canSearchEmployees && (
          <form
            className="hidden w-64 md:block"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <SearchInput
              placeholder="Search employees…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        )}

        <button
          onClick={() => router.push(isApprover ? "/leave/approvals" : "/leave/my")}
          className="relative rounded-lg p-2.5 text-muted transition-colors duration-150 hover:bg-soft hover:text-inksoft"
          aria-label="Notifications"
          title={isApprover ? "Pending leave approvals" : "My pending leave requests"}
        >
          <Bell className="h-5 w-5" />
          {pending !== null && pending > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {pending > 99 ? "99+" : pending}
            </span>
          )}
        </button>

        <ThemeToggle />

        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg p-1.5 transition-colors duration-150 hover:bg-soft"
              aria-label="User menu"
            >
              <Avatar name={user.employeeName || user.email} size="sm" />
              <ChevronDown className={cn("hidden h-4 w-4 text-faint sm:block", menuOpen && "rotate-180")} />
            </button>
            {menuOpen && (
              <div className="animate-pop absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-surface/90 p-2 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar name={user.employeeName || user.email} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tracking-tight text-ink">
                      {user.employeeName || user.email}
                    </p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                    <Badge variant="slate" className="mt-1">
                      {roleLabel(user.role)}
                    </Badge>
                  </div>
                </div>
                <div className="border-t border-line pt-1">
                  {user.employeeId && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        router.push(`/employees/${user.employeeId}`);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-soft"
                    >
                      <UserIcon className="h-4 w-4" /> My profile
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger transition-colors duration-150 hover:bg-danger-soft"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
