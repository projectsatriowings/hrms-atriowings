"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarOff,
  CalendarPlus,
  FileText,
  Inbox,
  LogOut,
  Plus,
  Upload,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import { decideLeaveSchema } from "@hrms/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { formatDate, formatDateTime, formatINR, monthLabel, prettify, DEFAULT_TZ } from "@/lib/format";

interface DashboardData {
  headcount: { active: number; onNotice: number };
  today: {
    present: number;
    halfDay: number;
    absent: number;
    onLeave: number;
    late: number;
    missingCheckout: number;
    weeklyOff: number;
  };
  pendingLeaves: number;
  exceptions: Array<{ kind: string; label: string; count: number; link: string }>;
  payroll: { year: number; month: number; status: string; headcount: number; total: number } | null;
  outstandingInvoices: { count: number; total: number } | null;
  recentActivity: Array<{ action: string; entityType: string; at: string }>;
}

interface PendingLeave {
  id: string;
  employee: { fullName: string; employeeCode: string; department: { name: string } | null };
  leaveType: { code: string; name: string };
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
}

interface InboxResponse {
  data: PendingLeave[];
  total: number;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const tz = user?.companyTimezone || DEFAULT_TZ;
  // The pending-leave endpoint is hr/md-only — employees must not call it at all.
  const canApprove = user?.role === "hr" || user?.role === "md";

  const [data, setData] = useState<DashboardData | null>(null);
  const [inbox, setInbox] = useState<PendingLeave[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [decideTarget, setDecideTarget] = useState<{
    leave: PendingLeave;
    decision: "approved" | "rejected";
  } | null>(null);
  const [comment, setComment] = useState("");
  const [deciding, setDeciding] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const d = await apiGet<DashboardData>("/dashboard");
      setData(d);
    } catch (e) {
      toast(errMsg(e, "Failed to load dashboard"), "error");
    }
  }, [toast]);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const r = await apiGet<InboxResponse>("/leave/requests/pending", { pageSize: 5 });
      setInbox(r.data ?? []);
      setInboxTotal(r.total ?? 0);
    } catch (e) {
      toast(errMsg(e, "Failed to load leave inbox"), "error");
    } finally {
      setInboxLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDashboard();
    if (canApprove) loadInbox();
    else setInboxLoading(false);
  }, [loadDashboard, loadInbox, canApprove]);

  const decide = async () => {
    if (!decideTarget) return;
    setDeciding(true);
    try {
      const body = decideLeaveSchema.parse({
        decision: decideTarget.decision,
        comment: comment.trim() ? comment.trim() : undefined,
      });
      await apiPost(`/leave/requests/${decideTarget.leave.id}/decide`, body);
      toast(
        `Leave request ${decideTarget.decision === "approved" ? "approved" : "rejected"} for ${decideTarget.leave.employee.fullName}`,
        "success",
      );
      setDecideTarget(null);
      setComment("");
      await Promise.all([loadInbox(), loadDashboard()]);
    } catch (e) {
      toast(errMsg(e, "Failed to update leave request"), "error");
    } finally {
      setDeciding(false);
    }
  };

  if (!data) return <PageSkeleton />;

  const dateLine = new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const summaryParts = [
    `${data.today.present} present`,
    `${data.today.onLeave} on leave`,
    `${data.today.absent} absent`,
  ];
  if (data.pendingLeaves > 0) {
    summaryParts.push(`${data.pendingLeaves} leave ${data.pendingLeaves === 1 ? "request" : "requests"} awaiting review`);
  }
  const summaryLine = summaryParts.join(" · ");

  const stats = [
    { label: "Active employees", value: data.headcount.active, href: "/employees", icon: Users, sub: data.headcount.onNotice ? `${data.headcount.onNotice} on notice` : undefined },
    { label: "Present today", value: data.today.present, href: "/attendance", icon: UserCheck },
    { label: "Absent", value: data.today.absent, href: "/attendance", icon: UserX },
    { label: "On leave", value: data.today.onLeave, href: "/attendance", icon: CalendarOff },
    { label: "Missing check-outs", value: data.today.missingCheckout, href: "/attendance", icon: LogOut },
    { label: "Pending leaves", value: data.pendingLeaves, href: "/leave/approvals", icon: Inbox },
  ];

  const quickActions = [
    { label: "Add employee", href: "/employees/new", icon: Plus },
    { label: "Import employees", href: "/employees/import", icon: Upload },
    { label: "New payroll period", href: "/payroll", icon: Wallet },
    { label: "Apply leave", href: "/leave/apply", icon: CalendarPlus },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome band */}
      <div className="animate-rise relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "linear-gradient(120deg, rgb(var(--accent-soft)), transparent 55%)" }}
        />
        <div
          aria-hidden
          className="no-print pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-[28px]">
            Good day{user?.employeeName ? `, ${user.employeeName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {dateLine} · {summaryLine}
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="animate-stagger grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} href={s.href} icon={s.icon} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Needs attention */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold tracking-tight text-ink">Needs attention</h2>
            {canApprove && (
              <Link href="/leave/approvals" className="text-sm font-medium text-accent-ink hover:text-accent-ink">
                View all approvals
              </Link>
            )}
          </div>

          {data.exceptions.length > 0 && (
            <div className="mb-5 space-y-2">
              {data.exceptions.map((ex) => (
                <Link
                  key={ex.kind}
                  href={ex.link}
                  className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm hover:bg-warning-soft/70"
                >
                  <span className="flex items-center gap-2 font-medium text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    {ex.label}
                  </span>
                  <Badge variant="amber">{ex.count}</Badge>
                </Link>
              ))}
            </div>
          )}

          {canApprove && (
            <>
          <h3 className="mb-3 text-sm font-semibold text-inksoft">Leave inbox</h3>
          {inboxLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : inbox.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Inbox clear"
              description="No pending leave requests. New requests from your team will appear here."
            />
          ) : (
            <div className="space-y-2">
              {inbox.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {l.employee.fullName}{" "}
                      <span className="font-normal text-muted">({l.employee.employeeCode})</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {l.leaveType.name} · {formatDate(l.fromDate)} → {formatDate(l.toDate)} · {l.days}{" "}
                      {l.days === 1 ? "day" : "days"}
                      {l.employee.department ? ` · ${l.employee.department.name}` : ""}
                    </p>
                    {l.reason && <p className="mt-0.5 truncate text-xs text-faint">“{l.reason}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDecideTarget({ leave: l, decision: "rejected" })}
                    >
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => setDecideTarget({ leave: l, decision: "approved" })}>
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
              {inboxTotal > inbox.length && (
                <Link
                  href="/leave/approvals"
                  className="block pt-1 text-center text-sm font-medium text-accent-ink hover:text-accent-ink"
                >
                  + {inboxTotal - inbox.length} more pending
                </Link>
              )}
            </div>
          )}
            </>
          )}
        </Card>

        {/* Right column */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-base font-bold tracking-tight text-ink">Payroll</h2>
            {data.payroll ? (
              <Link href="/payroll" className="block">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-inksoft">
                    {monthLabel(data.payroll.year, data.payroll.month)}
                  </p>
                  <StatusBadge status={data.payroll.status} />
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                  {formatINR(data.payroll.total)}
                </p>
                <p className="mt-1 text-xs text-muted">{data.payroll.headcount} employees</p>
              </Link>
            ) : (
              <div>
                <p className="text-sm text-muted">No payroll period yet.</p>
                <Link href="/payroll">
                  <Button size="sm" className="mt-3">
                    New payroll period
                  </Button>
                </Link>
              </div>
            )}
          </Card>

          {data.outstandingInvoices && (
            <Card className="p-5">
              <h2 className="mb-3 text-base font-bold tracking-tight text-ink">Outstanding invoices</h2>
              <Link href="/billing/invoices" className="block">
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {formatINR(data.outstandingInvoices.total)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {data.outstandingInvoices.count} unpaid{" "}
                  {data.outstandingInvoices.count === 1 ? "invoice" : "invoices"}
                </p>
              </Link>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-base font-bold tracking-tight text-ink">Quick actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((a) => (
                <Link key={a.label} href={a.href}>
                  <Button variant="outline" className="h-auto w-full flex-col gap-1.5 py-3.5">
                    <a.icon className="h-5 w-5 text-accent" />
                    <span className="text-xs">{a.label}</span>
                  </Button>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Recent activity */}
      <Card className="p-5">
        <h2 className="mb-4 text-base font-bold tracking-tight text-ink">Recent activity</h2>
        {data.recentActivity.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No recent activity"
            description="Actions taken across the workspace will show up here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.recentActivity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <p className="text-inksoft">
                  {prettify(a.action)}
                  <span className="text-faint"> · {prettify(a.entityType)}</span>
                </p>
                <p className="shrink-0 text-xs text-muted">{formatDateTime(a.at, tz)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Approve / reject dialog */}
      <Dialog
        open={!!decideTarget}
        onClose={() => {
          setDecideTarget(null);
          setComment("");
        }}
        title={decideTarget?.decision === "approved" ? "Approve leave request" : "Reject leave request"}
        description={
          decideTarget
            ? `${decideTarget.leave.employee.fullName} · ${decideTarget.leave.leaveType.name} · ${formatDate(decideTarget.leave.fromDate)} → ${formatDate(decideTarget.leave.toDate)}`
            : undefined
        }
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDecideTarget(null);
                setComment("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant={decideTarget?.decision === "approved" ? "primary" : "destructive"}
              loading={deciding}
              onClick={decide}
            >
              {decideTarget?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <label className="block text-sm font-medium text-inksoft">
          Comment <span className="font-normal text-faint">(optional)</span>
        </label>
        <Textarea
          className="mt-1.5"
          placeholder="Add a note for the employee…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
        />
      </Dialog>
    </div>
  );
}
