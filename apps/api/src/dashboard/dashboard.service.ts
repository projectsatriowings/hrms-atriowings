import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { dateOnly, round2, todayInTz } from "../common/utils";
import { RequestUser } from "../common/decorators";

/**
 * UTC instant of HH:mm on a YYYY-MM-DD in the given IANA zone (same
 * fixed-point iteration as attendance's zonedTimeToUtc, kept local here so
 * the dashboard does not import the attendance service module).
 */
function zonedTimeToUtc(ymd: string, hm: string, tz: string): Date {
  const [Y, M, D] = ymd.split("-").map(Number);
  const [h, m] = hm.split(":").map(Number);
  const base = Date.UTC(Y, M - 1, D, h, m);
  let guess = base;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    const asUtc = Date.UTC(+get("year"), +get("month") - 1, +get("day"), (+get("hour")) % 24, +get("minute"), +get("second"));
    guess = base - (asUtc - guess);
  }
  return new Date(guess);
}

/** Late from check-in time vs workStart + grace, independent of check-out. */
function isLateFromCheckIn(checkInAt: Date | null, workDate: string, workStart: string, graceMinutes: number, tz: string): boolean {
  if (!checkInAt) return false;
  const deadline = zonedTimeToUtc(workDate, workStart, tz).getTime() + graceMinutes * 60000;
  return checkInAt.getTime() > deadline;
}

export interface DashboardException {
  kind: string;
  label: string;
  count: number;
  link: string;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async get(user: RequestUser) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const tz = company?.timezone ?? "Asia/Kolkata";
    const today = todayInTz(tz);
    const companyId = user.companyId;
    const isHr = user.role === "hr" || user.role === "md";

    const [activeCount, onNoticeCount] = await Promise.all([
      this.prisma.employee.count({ where: { companyId, employmentStatus: "active" } }),
      this.prisma.employee.count({ where: { companyId, employmentStatus: "on_notice" } }),
    ]);

    // Today's attendance snapshot
    const [dayRecords, leavesToday, policy] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { companyId, workDate: dateOnly(today) }, select: { status: true, lateMinutes: true, checkInAt: true, checkOutAt: true, employeeId: true } }),
      this.prisma.leaveRequest.count({ where: { companyId, status: "approved", fromDate: { lte: dateOnly(today) }, toDate: { gte: dateOnly(today) } } }),
      this.prisma.attendancePolicy.findFirst({ where: { companyId, isDefault: true } }),
    ]);
    // Verified bug: lateMinutes is only written at check-out (attendance
    // computeDerived runs on checkout), so the old `lateMinutes > 0` filter
    // missed every employee who had checked in late but not yet checked out.
    // Derive lateness from checkInAt vs workStart + grace instead, falling
    // back to the stored lateMinutes when there is no check-in time.
    const workStart = policy?.workStart ?? "09:30";
    const graceMinutes = policy?.graceMinutes ?? 10;
    const todayStats = {
      present: dayRecords.filter((r) => r.status === "present").length,
      halfDay: dayRecords.filter((r) => r.status === "half_day").length,
      absent: dayRecords.filter((r) => r.status === "absent").length,
      onLeave: leavesToday,
      late: dayRecords.filter((r) =>
        r.checkInAt
          ? isLateFromCheckIn(r.checkInAt, today, workStart, graceMinutes, tz)
          : r.lateMinutes > 0,
      ).length,
      missingCheckout: dayRecords.filter((r) => !r.checkOutAt).length,
      weeklyOff: (policy?.weeklyOffs ?? [0]).includes(new Date(`${today}T00:00:00Z`).getUTCDay()),
    };

    const pendingLeaves = await this.prisma.leaveRequest.count({
      where: { companyId, status: "pending" },
    });

    // Exceptions needing attention
    const exceptions: DashboardException[] = [];
    if (todayStats.missingCheckout > 0) {
      exceptions.push({ kind: "missing_checkout", label: `${todayStats.missingCheckout} missing check-out${todayStats.missingCheckout > 1 ? "s" : ""}`, count: todayStats.missingCheckout, link: "/attendance?filter=missing_checkout" });
    }
    if (pendingLeaves > 0) {
      exceptions.push({ kind: "pending_leaves", label: `${pendingLeaves} leave request${pendingLeaves > 1 ? "s" : ""} awaiting decision`, count: pendingLeaves, link: "/leave/approvals" });
    }
    if (isHr) {
      const incomplete = await this.prisma.employee.count({ where: { companyId, employmentStatus: "active", departmentId: null } });
      if (incomplete > 0) exceptions.push({ kind: "incomplete_records", label: `${incomplete} employee record${incomplete > 1 ? "s" : ""} missing department`, count: incomplete, link: "/employees" });
      const payrollPending = await this.prisma.payrollPeriod.count({ where: { companyId, status: { in: ["draft", "in_review"] } } });
      if (payrollPending > 0) exceptions.push({ kind: "payroll_pending", label: `${payrollPending} payroll period${payrollPending > 1 ? "s" : ""} awaiting review/approval`, count: payrollPending, link: "/payroll" });
      const overdueInvoices = await this.prisma.invoice.count({ where: { companyId, status: { in: ["issued", "partially_paid"] }, dueDate: { lt: dateOnly(today) } } });
      if (overdueInvoices > 0) exceptions.push({ kind: "overdue_invoices", label: `${overdueInvoices} overdue invoice${overdueInvoices > 1 ? "s" : ""}`, count: overdueInvoices, link: "/billing?status=overdue" });
    }

    // Current payroll period
    const payrollPeriod = await this.prisma.payrollPeriod.findFirst({
      where: { companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { records: { select: { netPay: true } } },
    });
    const payroll = payrollPeriod
      ? {
          year: payrollPeriod.year, month: payrollPeriod.month, status: payrollPeriod.status,
          headcount: payrollPeriod.records.length,
          total: round2(payrollPeriod.records.reduce((s, r) => s + Number(r.netPay), 0)),
        }
      : null;

    // Outstanding invoices (hr/md)
    let outstanding: { count: number; total: number } | null = null;
    if (isHr) {
      const invoices = await this.prisma.invoice.findMany({ where: { companyId, status: { in: ["issued", "partially_paid"] } }, select: { total: true, amountPaid: true } });
      const open = invoices.filter((i) => Number(i.total) - Number(i.amountPaid) > 0.01);
      outstanding = { count: open.length, total: round2(open.reduce((s, i) => s + (Number(i.total) - Number(i.amountPaid)), 0)) };
    }

    // Recent activity (sanitized)
    const activity = await this.prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { action: true, entityType: true, createdAt: true },
    });

    return {
      headcount: { active: activeCount, onNotice: onNoticeCount },
      today: todayStats,
      pendingLeaves,
      exceptions,
      payroll,
      outstandingInvoices: outstanding,
      recentActivity: activity.map((a) => ({ action: a.action, entityType: a.entityType, at: a.createdAt })),
      serverTime: new Date().toISOString(),
      timezone: tz,
    };
  }
}
