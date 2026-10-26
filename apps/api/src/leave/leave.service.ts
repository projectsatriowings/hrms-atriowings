import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { LeaveRequestStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { NotificationService } from "../notifications/notification.service";
import { dateOnly, pageParams, pageResult, todayInTz, ymdOf } from "../common/utils";
import { RequestUser } from "../common/decorators";
import type { ApplyLeaveInput, DecideLeaveInput, LeaveAdjustmentInput, LeaveTypeInput } from "@hrms/shared";
import { proratedLeaveAllocation, rolloverCarry, splitDatesByYear } from "@hrms/shared";

/** PrismaService or a $transaction client — both expose the same delegates. */
type LeaveLedgerClient = PrismaService | Prisma.TransactionClient;

/**
 * Create pro-rated allocations for a newly joined employee: one allocation
 * ledger entry per ACTIVE leave type with defaultDays > 0, for the joining
 * year. Idempotent: an existing allocation entry for (employee, type, year)
 * is never duplicated. Used by employee creation and the backfill script
 * (via LeaveService.createAllocationsForEmployee).
 */
async function createAllocations(
  client: LeaveLedgerClient,
  companyId: string,
  employeeId: string,
  joiningDateYmd: string,
  createdById?: string,
): Promise<number> {
  const year = Number(joiningDateYmd.slice(0, 4));
  const types = await client.leaveType.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" } });
  let created = 0;
  for (const t of types) {
    const defaultDays = Number(t.defaultDays);
    if (!(defaultDays > 0)) continue;
    const existing = await client.leaveLedger.findFirst({
      where: { companyId, employeeId, leaveTypeId: t.id, year, entryType: "allocation" },
    });
    if (existing) continue;
    // Rounding rule (see proratedLeaveAllocation): 2 decimals, half-up.
    const deltaDays = proratedLeaveAllocation(defaultDays, joiningDateYmd);
    if (!(deltaDays > 0)) continue;
    await client.leaveLedger.create({
      data: {
        companyId, employeeId, leaveTypeId: t.id, year,
        deltaDays, entryType: "allocation",
        note: `Joining-year allocation (pro-rated, joined ${joiningDateYmd})`,
        createdById: createdById ?? null,
      },
    });
    created++;
  }
  return created;
}

/** Working days between two YYYY-MM-DD dates, excluding weekly offs and holidays. */
async function workingDays(prisma: PrismaService, companyId: string, from: string, to: string): Promise<{ days: number; dates: string[] }> {
  const policy = await prisma.attendancePolicy.findFirst({ where: { companyId, isDefault: true } });
  const weeklyOffs = policy?.weeklyOffs ?? [0];
  const holidays = await prisma.holiday.findMany({
    where: { companyId, date: { gte: dateOnly(from), lte: dateOnly(to) } },
  });
  const holidaySet = new Set(holidays.map((h) => ymdOf(h.date)));
  const dates: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    const ymd = ymdOf(cur);
    const dow = cur.getUTCDay();
    if (!weeklyOffs.includes(dow) && !holidaySet.has(ymd)) dates.push(ymd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return { days: dates.length, dates };
}

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    // Optional so existing `new LeaveService(prisma, audit)` construction
    // keeps working; Nest injects the global NotificationService in prod.
    @Optional() private notifications?: NotificationService,
  ) {}

  // ── Leave types ──────────────────────────────────────────────

  async listTypes(user: RequestUser) {
    return this.prisma.leaveType.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } });
  }

  async createType(user: RequestUser, input: LeaveTypeInput) {
    const dup = await this.prisma.leaveType.findFirst({ where: { companyId: user.companyId, code: input.code.toUpperCase() } });
    if (dup) throw new ConflictException({ code: "duplicate_code", message: "Leave type code already exists" });
    const created = await this.prisma.leaveType.create({ data: { companyId: user.companyId, ...input, code: input.code.toUpperCase() } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.type_created", entityType: "leave_type", entityId: created.id, after: input });
    return created;
  }

  async updateType(user: RequestUser, id: string, input: Partial<LeaveTypeInput>) {
    const existing = await this.prisma.leaveType.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Leave type not found" });
    const updated = await this.prisma.leaveType.update({ where: { id }, data: input });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.type_updated", entityType: "leave_type", entityId: id, before: existing, after: updated });
    return updated;
  }

  // ── Balances (ledger-based) ──────────────────────────────────

  async balancesFor(user: RequestUser, employeeId: string, year: number) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId } });
    if (!emp) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    const types = await this.prisma.leaveType.findMany({ where: { companyId: user.companyId, isActive: true }, orderBy: { name: "asc" } });
    const entries = await this.prisma.leaveLedger.findMany({
      where: { employeeId, year },
      include: { leaveType: { select: { code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return types.map((t) => {
      const ledger = entries.filter((e) => e.leaveTypeId === t.id);
      const sum = (et: string) => ledger.filter((e) => e.entryType === et).reduce((s, e) => s + Number(e.deltaDays), 0);
      return {
        leaveType: { id: t.id, code: t.code, name: t.name },
        allocated: sum("allocation"),
        used: -sum("usage"),
        adjustments: sum("adjustment"),
        carryForward: sum("carry_forward"),
        balance: sum("allocation") + sum("usage") + sum("adjustment") + sum("carry_forward"),
        ledger: ledger.map((e) => ({ id: e.id, deltaDays: Number(e.deltaDays), entryType: e.entryType, note: e.note, createdAt: e.createdAt })),
      };
    });
  }

  async myBalances(user: RequestUser, year: number) {
    if (!user.employeeId) throw new BadRequestException({ code: "no_employee", message: "Your login is not linked to an employee record" });
    return this.balancesFor(user, user.employeeId, year);
  }

  async adjustBalance(user: RequestUser, employeeId: string, input: LeaveAdjustmentInput) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId } });
    if (!emp) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: user.companyId } });
    if (!type) throw new NotFoundException({ code: "not_found", message: "Leave type not found" });
    const entry = await this.prisma.leaveLedger.create({
      data: {
        companyId: user.companyId, employeeId, leaveTypeId: type.id, year: input.year,
        deltaDays: input.deltaDays, entryType: input.entryType, note: input.note, createdById: user.userId,
      },
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.balance_adjusted", entityType: "employee", entityId: employeeId, after: input });
    return entry;
  }

  /** Pro-rated joining-year allocations for one employee (idempotent). */
  async createAllocationsForEmployee(companyId: string, employeeId: string, joiningDateYmd: string, createdById?: string) {
    return createAllocations(this.prisma, companyId, employeeId, joiningDateYmd, createdById);
  }

  /**
   * Annual rollover, run by @Cron every Jan 1 at 00:00 (requires
   * ScheduleModule, wired by another workstream). For each ACTIVE employee
   * and each leave type with carryForward=true, the unused prior-year
   * balance — min(unused, maxCarryDays when set, else unused) — is posted
   * as a `carry_forward` entry for the new year. The entry type already
   * exists in LeaveLedgerEntryType, so no new mechanism was needed.
   * Idempotent: a run that finds an existing carry_forward entry for
   * (employee, type, new year) skips that pair, so a duplicate run is safe.
   * Fresh-year allocations: the same run also posts the new year's FULL
   * defaultDays allocation for every active type (not pro-rated — pro-rating
   * applies only to the joining year), idempotently skipped when an
   * allocation entry already exists. Without this, January approvals beyond
   * the carried amount would fail for lack of balance.
   */
  @Cron("0 0 0 1 1 *")
  async rolloverLeaveBalances(targetYear?: number) {
    const newYear = targetYear ?? new Date().getFullYear();
    const priorYear = newYear - 1;
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let carried = 0;
    let allocated = 0;
    for (const company of companies) {
      let companyCarried = 0;
      const [employees, types] = await Promise.all([
        this.prisma.employee.findMany({ where: { companyId: company.id, employmentStatus: "active" }, select: { id: true } }),
        this.prisma.leaveType.findMany({ where: { companyId: company.id, carryForward: true, isActive: true } }),
      ]);
      for (const emp of employees) {
        for (const type of types) {
          const prior = await this.prisma.leaveLedger.findMany({
            where: { companyId: company.id, employeeId: emp.id, leaveTypeId: type.id, year: priorYear },
            select: { deltaDays: true },
          });
          const unused = prior.reduce((s, e) => s + Number(e.deltaDays), 0);
          const carry = rolloverCarry(unused, type.maxCarryDays == null ? null : Number(type.maxCarryDays));
          if (!(carry > 0)) continue;
          const existing = await this.prisma.leaveLedger.findFirst({
            where: { companyId: company.id, employeeId: emp.id, leaveTypeId: type.id, year: newYear, entryType: "carry_forward" },
          });
          if (existing) continue;
          await this.prisma.leaveLedger.create({
            data: {
              companyId: company.id, employeeId: emp.id, leaveTypeId: type.id, year: newYear,
              deltaDays: carry, entryType: "carry_forward",
              note: `Annual rollover: unused ${priorYear} balance carried forward (capped at ${type.maxCarryDays == null ? "uncapped" : Number(type.maxCarryDays)})`,
              createdById: null,
            },
          });
          carried++;
          companyCarried++;
        }
      }
      // Fresh-year default allocations (coordinator gate addition): without
      // these, January approvals beyond the carried amount would fail for
      // lack of balance. Continuing employees get the FULL defaultDays (not
      // pro-rated — pro-rating applies only to the joining year). Idempotent:
      // skipped when an allocation entry for the new year already exists.
      let companyAllocated = 0;
      const allocTypes = await this.prisma.leaveType.findMany({ where: { companyId: company.id, isActive: true } });
      for (const emp of employees) {
        for (const type of allocTypes) {
          if (!(Number(type.defaultDays) > 0)) continue;
          const existingAlloc = await this.prisma.leaveLedger.findFirst({
            where: { companyId: company.id, employeeId: emp.id, leaveTypeId: type.id, year: newYear, entryType: "allocation" },
          });
          if (existingAlloc) continue;
          await this.prisma.leaveLedger.create({
            data: {
              companyId: company.id, employeeId: emp.id, leaveTypeId: type.id, year: newYear,
              deltaDays: type.defaultDays, entryType: "allocation",
              note: `Annual allocation for ${newYear}`, createdById: null,
            },
          });
          companyAllocated++;
        }
      }
      if (companyCarried > 0 || companyAllocated > 0) {
        await this.audit.log({ companyId: company.id, action: "leave.rollover", entityType: "leave_ledger", after: { newYear, priorYear, carried: companyCarried, allocated: companyAllocated } });
      }
      allocated += companyAllocated;
    }
    return { newYear, priorYear, carried, allocated };
  }

  // ── Requests ─────────────────────────────────────────────────

  private async canReview(user: RequestUser): Promise<boolean> {
    return user.role === "hr" || user.role === "md";
  }

  async apply(user: RequestUser, input: ApplyLeaveInput) {
    if (!user.employeeId) throw new BadRequestException({ code: "no_employee", message: "Your login is not linked to an employee record" });
    const employee = await this.prisma.employee.findFirst({ where: { id: user.employeeId, companyId: user.companyId } });
    if (!employee || employee.employmentStatus !== "active") throw new BadRequestException({ code: "inactive", message: "Only active employees can apply for leave" });
    if (input.fromDate > input.toDate) throw new BadRequestException({ code: "invalid_dates", message: "From date must be on or before To date" });

    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: user.companyId, isActive: true } });
    if (!type) throw new NotFoundException({ code: "not_found", message: "Leave type not found" });

    const { days, dates } = await workingDays(this.prisma, user.companyId, input.fromDate, input.toDate);
    if (days === 0) throw new BadRequestException({ code: "no_working_days", message: "The selected range has no working days" });

    // Overlapping request (pending/approved) for the same employee?
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        companyId: user.companyId, employeeId: user.employeeId,
        status: { in: ["pending", "approved"] },
        fromDate: { lte: dateOnly(input.toDate) }, toDate: { gte: dateOnly(input.fromDate) },
      },
    });
    if (overlap) throw new ConflictException({ code: "overlapping_leave", message: "You already have a leave request overlapping these dates" });

    // Balance check (pending requests are NOT deducted, so only check against ledger balance)
    const year = Number(input.fromDate.slice(0, 4));
    const balances = await this.balancesFor(user, user.employeeId, year);
    const bal = balances.find((b) => b.leaveType.id === type.id);
    if (type.code !== "UNPAID" && (bal?.balance ?? 0) < days) {
      throw new BadRequestException({ code: "insufficient_balance", message: `Insufficient ${type.name} balance (${bal?.balance ?? 0} available, ${days} needed)` });
    }

    // "Who else is off" — colleagues on approved leave in this range (same department)
    const others = await this.prisma.leaveRequest.findMany({
      where: {
        companyId: user.companyId, status: "approved",
        employeeId: { not: user.employeeId },
        employee: { departmentId: employee.departmentId },
        fromDate: { lte: dateOnly(input.toDate) }, toDate: { gte: dateOnly(input.fromDate) },
      },
      select: { employee: { select: { fullName: true } }, fromDate: true, toDate: true },
      take: 10,
    });

    const created = await this.prisma.leaveRequest.create({
      data: {
        companyId: user.companyId, employeeId: user.employeeId, leaveTypeId: type.id,
        fromDate: dateOnly(input.fromDate), toDate: dateOnly(input.toDate),
        days, reason: input.reason, status: "pending",
      },
      include: { leaveType: { select: { code: true, name: true } } },
    });
    return {
      request: created,
      workingDates: dates,
      overlappingLeaves: others.map((o) => ({ employeeName: o.employee.fullName, fromDate: ymdOf(o.fromDate), toDate: ymdOf(o.toDate) })),
    };
  }

  async myRequests(user: RequestUser, status?: string, page = 1, pageSize = 20) {
    if (!user.employeeId) return pageResult([], 0, page, pageSize);
    const { skip, take, page: p, pageSize: ps } = pageParams(page, pageSize);
    const where = { employeeId: user.employeeId, ...(status ? { status: status as LeaveRequestStatus } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where, include: { leaveType: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" }, skip, take,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return pageResult(data, total, p, ps);
  }

  async pendingInbox(user: RequestUser, page = 1, pageSize = 20) {
    const { skip, take, page: p, pageSize: ps } = pageParams(page, pageSize);
    const where: Record<string, unknown> = { companyId: user.companyId, status: "pending" };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: {
          leaveType: { select: { code: true, name: true } },
          employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" }, skip, take,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return pageResult(data, total, p, ps);
  }

  async decide(user: RequestUser, id: string, input: DecideLeaveInput) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId: user.companyId },
      include: { employee: { select: { id: true, fullName: true, workEmail: true } }, leaveType: { select: { code: true, name: true } } },
    });
    if (!request) throw new NotFoundException({ code: "not_found", message: "Leave request not found" });
    if (request.status !== "pending") throw new ConflictException({ code: "already_decided", message: `Request is already ${request.status}` });
    if (!(await this.canReview(user))) {
      throw new ForbiddenException({ code: "forbidden", message: "You cannot decide this request" });
    }
    // Self-approval is blocked: an approver whose login is linked to the
    // requester's employee record cannot decide their own request (either
    // decision). Logins with no linked employee record are unaffected.
    if (user.employeeId && user.employeeId === request.employeeId) {
      throw new ForbiddenException({ code: "self_approval", message: "You cannot decide your own leave request" });
    }

    if (input.decision === "rejected") {
      const updated = await this.prisma.leaveRequest.update({
        where: { id }, data: { status: "rejected", reviewerId: user.userId, reviewerComment: input.comment, decidedAt: new Date() },
      });
      await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.rejected", entityType: "leave_request", entityId: id, after: { comment: input.comment } });
      // ── BEGIN NOTIFICATION (mailer workstream) ─────────────────────
      // Best-effort: a notification failure must never fail the decision.
      try {
        await this.notifications?.notifyLeaveDecided({
          companyId: user.companyId,
          employeeEmail: request.employee.workEmail,
          employeeName: request.employee.fullName,
          leaveTypeName: request.leaveType.name,
          fromDate: ymdOf(request.fromDate),
          toDate: ymdOf(request.toDate),
          decision: "rejected",
          comment: input.comment,
        });
      } catch (err) {
        console.warn("[leave] leave-rejected notification failed:", err instanceof Error ? err.message : err);
      }
      // ── END NOTIFICATION (mailer workstream) ───────────────────────
      return updated;
    }

    // Approve: claim the request, re-check balance, check attendance
    // conflicts, then post ledger usage + mark attendance — all atomically.
    // The creation-time balance check is deliberately NOT repeated here as
    // the only check: pending requests are not deducted at creation, so
    // the balance must be re-checked at approval time, inside this
    // transaction, or two overlapping pendings could both approve and drive
    // the balance negative.
    const { dates } = await workingDays(this.prisma, user.companyId, ymdOf(request.fromDate), ymdOf(request.toDate));
    const segments = splitDatesByYear(dates);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: a concurrent decide() that already flipped the status
      // finds zero rows here and fails instead of double-posting usage.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", reviewerId: user.userId, reviewerComment: input.comment, decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({ code: "already_decided", message: "Request was already decided" });
      }

      // Attendance conflict: never overwrite a day that already has a
      // check-in record (checkInAt present). Refuse, listing the dates.
      if (dates.length > 0) {
        const conflicts = await tx.attendanceRecord.findMany({
          where: {
            employeeId: request.employeeId,
            workDate: { in: dates.map((d) => dateOnly(d)) },
            checkInAt: { not: null },
          },
          select: { workDate: true },
          orderBy: { workDate: "asc" },
        });
        if (conflicts.length > 0) {
          const conflictingDates = conflicts.map((c) => ymdOf(c.workDate));
          throw new ConflictException({
            code: "attendance_conflict",
            message: `Cannot approve: attendance already recorded on ${conflictingDates.join(", ")}`,
            conflictingDates,
          });
        }
      }

      // Approval-time balance re-check, per calendar-year segment: ledger
      // balance for that year (allocation + adjustment + carry_forward +
      // usage, where usage entries are negative) must cover this segment.
      // UNPAID mirrors the creation-time exemption in apply().
      if (request.leaveType.code !== "UNPAID") {
        for (const seg of segments) {
          const entries = await tx.leaveLedger.findMany({
            where: { companyId: user.companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year: seg.year },
            select: { deltaDays: true },
          });
          const available = entries.reduce((s, e) => s + Number(e.deltaDays), 0);
          if (available < seg.dates.length) {
            throw new ConflictException({
              code: "insufficient_balance",
              message: `Insufficient ${request.leaveType.name} balance for ${seg.year} (${available} available, ${seg.dates.length} needed)`,
            });
          }
        }
      }

      // Usage is split per calendar-year segment: a Dec 30 – Jan 2 request
      // deducts its December working days from the old year and its January
      // working days from the new year, instead of posting everything to
      // the start year.
      for (const seg of segments) {
        await tx.leaveLedger.create({
          data: {
            companyId: user.companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId,
            year: seg.year, deltaDays: -seg.dates.length, entryType: "usage", refRequestId: id,
            note: `Approved leave ${ymdOf(request.fromDate)} → ${ymdOf(request.toDate)} (${seg.year} segment)`, createdById: user.userId,
          },
        });
      }
      for (const d of dates) {
        await tx.attendanceRecord.upsert({
          where: { employeeId_workDate: { employeeId: request.employeeId, workDate: dateOnly(d) } },
          update: { status: "on_leave", source: "correction", note: `Approved leave` },
          create: {
            companyId: user.companyId, employeeId: request.employeeId, workDate: dateOnly(d),
            status: "on_leave", source: "correction", note: "Approved leave",
          },
        });
      }
      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.approved", entityType: "leave_request", entityId: id, after: { days: Number(request.days) } });
    // ── BEGIN NOTIFICATION (mailer workstream) ─────────────────────
    // Best-effort: a notification failure must never fail the decision.
    try {
      await this.notifications?.notifyLeaveDecided({
        companyId: user.companyId,
        employeeEmail: request.employee.workEmail,
        employeeName: request.employee.fullName,
        leaveTypeName: request.leaveType.name,
        fromDate: ymdOf(request.fromDate),
        toDate: ymdOf(request.toDate),
        decision: "approved",
        comment: input.comment,
      });
    } catch (err) {
      console.warn("[leave] leave-approved notification failed:", err instanceof Error ? err.message : err);
    }
    // ── END NOTIFICATION (mailer workstream) ───────────────────────
    return updated;
  }

  async cancel(user: RequestUser, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, companyId: user.companyId } });
    if (!request) throw new NotFoundException({ code: "not_found", message: "Leave request not found" });
    const isOwner = user.employeeId === request.employeeId;
    const isHr = user.role === "hr" || user.role === "md";
    if (!isOwner && !isHr) throw new ForbiddenException({ code: "forbidden", message: "You cannot cancel this request" });
    if (request.status === "cancelled") throw new ConflictException({ code: "already_cancelled", message: "Request is already cancelled" });
    if (request.status === "rejected") throw new ConflictException({ code: "already_decided", message: "Request was already rejected" });

    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const today = todayInTz(company?.timezone ?? "Asia/Kolkata");

    if (request.status === "approved") {
      // Reverse ledger usage + clear attendance marks (only future dates)
      if (ymdOf(request.fromDate) <= today) {
        throw new BadRequestException({ code: "already_started", message: "Leave has already started; ask HR to adjust the balance" });
      }
      const { dates } = await workingDays(this.prisma, user.companyId, ymdOf(request.fromDate), ymdOf(request.toDate));
      await this.prisma.$transaction(async (tx) => {
        await tx.leaveRequest.update({ where: { id }, data: { status: "cancelled" } });
        // Mirror the approval-time year split: reverse each year's usage
        // segment in its own year, not the whole amount in the start year.
        for (const seg of splitDatesByYear(dates)) {
          await tx.leaveLedger.create({
            data: {
              companyId: user.companyId, employeeId: request.employeeId, leaveTypeId: request.leaveTypeId,
              year: seg.year, deltaDays: seg.dates.length, entryType: "adjustment", refRequestId: id,
              note: "Cancellation of approved leave", createdById: user.userId,
            },
          });
        }
        for (const d of dates) {
          await tx.attendanceRecord.deleteMany({
            where: { employeeId: request.employeeId, workDate: dateOnly(d), status: "on_leave", source: "correction" },
          });
        }
      });
    } else {
      await this.prisma.leaveRequest.update({ where: { id }, data: { status: "cancelled" } });
    }
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "leave.cancelled", entityType: "leave_request", entityId: id });
    return { ok: true };
  }

  async calendar(user: RequestUser, year: number, month: number, departmentId?: string) {
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const where: Prisma.LeaveRequestWhereInput = {
      companyId: user.companyId,
      status: { in: ["approved", "pending"] },
      fromDate: { lte: dateOnly(to) },
      toDate: { gte: dateOnly(from) },
    };
    if (departmentId) where.employee = { departmentId };
    // employees see all approved; pending only their own (hr/md see all pending)
    if (user.role === "employee" && user.employeeId) {
      where.OR = [{ status: "approved" }, { employeeId: user.employeeId }];
    }
    const requests = await this.prisma.leaveRequest.findMany({
      where,
      select: {
        id: true, status: true, fromDate: true, toDate: true,
        employee: { select: { id: true, fullName: true } },
        leaveType: { select: { code: true, name: true } },
      },
      orderBy: { fromDate: "asc" },
    });
    return requests.map((r) => ({
      id: r.id, status: r.status,
      employeeName: r.employee.fullName,
      leaveType: r.leaveType.code,
      fromDate: ymdOf(r.fromDate), toDate: ymdOf(r.toDate),
    }));
  }
}
