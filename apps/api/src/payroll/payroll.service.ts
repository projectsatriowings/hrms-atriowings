import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PayrollPeriodStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { NotificationService, type PayrollTransitionStatus } from "../notifications/notification.service";
import { dateOnly, round2, toCsv, ymdOf } from "../common/utils";
import { computePayroll, type SalaryComponents, type TaxDeclaration, type TaxRegime } from "./payroll.calc";
import { buildPayslipPdf } from "./payslip.pdf";
import { decryptBankDetails } from "../common/bank-crypto";
import { RequestUser } from "../common/decorators";
import { resolveStatutory } from "@hrms/shared";
import type { PayrollAdjustmentCreateInput, PayrollAdjustmentInput, PayrollPeriodInput } from "@hrms/shared";

// Transaction client passed to $transaction callbacks (kept loose to avoid
// coupling to Prisma's overloaded $transaction signature).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/** Component label suffix marking components that came from PayrollAdjustment. */
const ADJUSTMENT_SUFFIX = " (adjustment)";

interface DayCounts {
  present: number; halfDay: number; absent: number;
  onLeavePaid: number; onLeaveUnpaid: number;
  weeklyOff: number; holiday: number; missingCheckout: number;
  paidDays: number; lopDays: number;
  /** Working days (not a weekly off / holiday) in the counted window. */
  expectedDays: number;
  /** Expected days with NO attendance record and no approved leave — silently treated as LOP. */
  noRecordDays: number;
}

interface AttendanceCoverage {
  expectedDays: number;
  daysWithoutRecord: number;
  /** Days with a check-in but no check-out (unpaid, see A5). */
  missingCheckoutDays: number;
  coveragePercent: number;
}

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    // Optional so existing `new PayrollService(prisma, audit)` construction
    // keeps working; Nest injects the global NotificationService in prod.
    @Optional() private notifications?: NotificationService,
  ) {}

  private periodRange(year: number, month: number) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    return { first: `${year}-${pad(month)}-01`, last: `${year}-${pad(month)}-${pad(lastDay)}`, daysInMonth: lastDay };
  }

  private async getPeriodOrThrow(user: RequestUser, id: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id, companyId: user.companyId } });
    if (!period) throw new NotFoundException({ code: "not_found", message: "Payroll period not found" });
    return period;
  }

  private assertMutable(period: { status: string }) {
    if (period.status === "finalized") {
      throw new ConflictException({ code: "period_locked", message: "This payroll period is finalized and locked" });
    }
  }

  /** Adjustments are only editable while the period is draft or in_review. */
  private assertAdjustable(period: { status: string }) {
    if (period.status !== "draft" && period.status !== "in_review") {
      throw new ConflictException({ code: "period_locked", message: "Adjustments are only allowed while a payroll period is draft or in review" });
    }
  }

  // ── Periods ────────────────────────────────────────────────────

  async listPeriods(user: RequestUser) {
    return this.prisma.payrollPeriod.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { _count: { select: { records: true } } },
    });
  }

  async createPeriod(user: RequestUser, input: PayrollPeriodInput) {
    const dup = await this.prisma.payrollPeriod.findFirst({ where: { companyId: user.companyId, year: input.year, month: input.month } });
    if (dup) throw new ConflictException({ code: "duplicate_period", message: "Payroll period already exists" });
    const created = await this.prisma.payrollPeriod.create({ data: { companyId: user.companyId, year: input.year, month: input.month, status: "draft" } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.period_created", entityType: "payroll_period", entityId: created.id, after: input });
    return created;
  }

  async getPeriod(user: RequestUser, id: string) {
    const period = await this.getPeriodOrThrow(user, id);
    const records = await this.prisma.payrollRecord.findMany({
      where: { periodId: id },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } },
        components: true,
      },
      orderBy: { employee: { fullName: "asc" } },
    });
    const totals = {
      headcount: records.length,
      gross: round2(records.reduce((s, r) => s + Number(r.gross), 0)),
      totalDeductions: round2(records.reduce((s, r) => s + Number(r.totalDeductions), 0)),
      netPay: round2(records.reduce((s, r) => s + Number(r.netPay), 0)),
    };
    // Month-on-month comparison
    const prevMonth = period.month === 1 ? 12 : period.month - 1;
    const prevYear = period.month === 1 ? period.year - 1 : period.year;
    const prev = await this.prisma.payrollPeriod.findFirst({
      where: { companyId: user.companyId, year: prevYear, month: prevMonth, status: "finalized" },
      include: { records: { select: { netPay: true } } },
    });
    const prevTotals = prev
      ? { year: prevYear, month: prevMonth, headcount: prev.records.length, netPay: round2(prev.records.reduce((s, r) => s + Number(r.netPay), 0)) }
      : null;
    // Attendance coverage for the computed register — recomputed from source
    // data so the LOP warning survives page reloads, not just the compute call.
    let attendanceCoverage: AttendanceCoverage | null = null;
    if (records.length > 0) {
      const company = await this.prisma.company.findUnique({ where: { id: user.companyId }, select: { timezone: true } });
      const tz = company?.timezone ?? "Asia/Kolkata";
      const { last } = this.periodRange(period.year, period.month);
      const emps = await this.prisma.employee.findMany({
        where: { id: { in: records.map((r) => r.employeeId) } },
        select: { id: true, dateOfExit: true, joiningDate: true },
      });
      const empById = new Map(emps.map((e) => [e.id, e]));
      // B10: one policy fetch for the whole period, not one per employee.
      const policy = await this.prisma.attendancePolicy.findFirst({ where: { companyId: user.companyId, isDefault: true } });
      const countsList: DayCounts[] = [];
      for (const r of records) {
        const emp = empById.get(r.employeeId);
        const exit = emp?.dateOfExit;
        const effectiveEnd = exit && ymdOf(exit) < last ? ymdOf(exit) : last;
        countsList.push(await this.monthDayCounts(user.companyId, tz, r.employeeId, period.year, period.month, effectiveEnd, {
          joiningDate: emp?.joiningDate ? ymdOf(emp.joiningDate) : null,
          policy,
        }));
      }
      attendanceCoverage = this.summarizeCoverage(countsList);
    }
    return { period, records, totals, prevTotals, attendanceCoverage, warnings: attendanceCoverage ? this.coverageWarnings(attendanceCoverage) : [] };
  }

  // ── Day counting ───────────────────────────────────────────────

  private async monthDayCounts(
    companyId: string, tz: string, employeeId: string, year: number, month: number, effectiveEnd: string,
    opts: { joiningDate?: string | null; policy?: { weeklyOffs: number[] } | null } = {},
  ): Promise<DayCounts> {
    const { first } = this.periodRange(year, month);
    // A1: clamp the window at the joining date — days before joining are not
    // the employee's days at all, so they must not count as absent/LOP.
    const start = opts.joiningDate && opts.joiningDate > first ? opts.joiningDate : first;
    const last = effectiveEnd;
    const policy = opts.policy ?? await this.prisma.attendancePolicy.findFirst({ where: { companyId, isDefault: true } });
    const weeklyOffs = policy?.weeklyOffs ?? [0];
    const [holidays, leaves, records] = await Promise.all([
      this.prisma.holiday.findMany({ where: { companyId, date: { gte: dateOnly(start), lte: dateOnly(last) } } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId, employeeId, status: "approved", fromDate: { lte: dateOnly(last) }, toDate: { gte: dateOnly(start) } },
        include: { leaveType: { select: { code: true } } },
      }),
      this.prisma.attendanceRecord.findMany({ where: { companyId, employeeId, workDate: { gte: dateOnly(start), lte: dateOnly(last) } } }),
    ]);
    const holidaySet = new Set(holidays.map((h) => ymdOf(h.date)));
    const leaveByDay = new Map<string, string>(); // ymd -> "paid" | "unpaid"
    for (const l of leaves) {
      const paid = l.leaveType.code === "UNPAID" ? "unpaid" : "paid";
      const from = ymdOf(l.fromDate), to = ymdOf(l.toDate);
      const cur = new Date(`${from}T00:00:00Z`);
      const end = new Date(`${to}T00:00:00Z`);
      while (cur <= end) {
        const ymd = ymdOf(cur);
        if (ymd >= start && ymd <= last) leaveByDay.set(ymd, paid);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    const recordByDay = new Map(records.map((r) => [ymdOf(r.workDate), r]));

    const counts: DayCounts = { present: 0, halfDay: 0, absent: 0, onLeavePaid: 0, onLeaveUnpaid: 0, weeklyOff: 0, holiday: 0, missingCheckout: 0, paidDays: 0, lopDays: 0, expectedDays: 0, noRecordDays: 0 };
    const cur = new Date(`${start}T00:00:00Z`);
    const end = new Date(`${last}T00:00:00Z`);
    let windowDays = 0;
    while (cur <= end) {
      windowDays++;
      const ymd = ymdOf(cur);
      const dow = cur.getUTCDay();
      const rec = recordByDay.get(ymd);
      // A day the employee was expected to work (not a weekly off or holiday).
      if (!holidaySet.has(ymd) && !weeklyOffs.includes(dow)) counts.expectedDays++;
      let paidValue: number;
      if (rec) {
        // A5: a check-in with no check-out pays 0 for that day. It is NOT
        // counted as present/half-day (no completed day exists to pay for);
        // it counts inside lopDays via the window invariant below, and is
        // flagged separately in missingCheckout / exceptions / warnings.
        // weekly_off / holiday records carry no checkout expectation, so
        // they keep their paid value.
        const openDay = !!rec.checkInAt && !rec.checkOutAt && ["present", "half_day", "absent", "on_leave"].includes(rec.status);
        if (openDay) { counts.missingCheckout++; paidValue = 0; }
        else if (rec.status === "present") { counts.present++; paidValue = 1; }
        else if (rec.status === "half_day") { counts.halfDay++; paidValue = 0.5; }
        else if (rec.status === "on_leave") {
          const lp = leaveByDay.get(ymd) ?? "paid";
          if (lp === "paid") { counts.onLeavePaid++; paidValue = 1; } else { counts.onLeaveUnpaid++; paidValue = 0; }
        }
        else if (rec.status === "absent") { counts.absent++; paidValue = 0; }
        else { paidValue = 1; } // weekly_off / holiday recorded
      } else if (holidaySet.has(ymd)) { counts.holiday++; paidValue = 1; }
      else if (weeklyOffs.includes(dow)) { counts.weeklyOff++; paidValue = 1; }
      else if (leaveByDay.has(ymd)) {
        if (leaveByDay.get(ymd) === "paid") { counts.onLeavePaid++; paidValue = 1; }
        else { counts.onLeaveUnpaid++; paidValue = 0; }
      } else { counts.absent++; counts.noRecordDays++; paidValue = 0; }
      counts.paidDays = round2(counts.paidDays + paidValue);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    // Invariant: paidDays + lopDays == days in the considered window
    // (joining-clamped start .. exit-clamped end). The old formula used
    // day-of-month(effectiveEnd), which overcounted LOP for joiners.
    counts.lopDays = round2(Math.max(0, windowDays - counts.paidDays));
    return counts;
  }

  /** Aggregate per-employee day counts into a period-level attendance coverage summary. */
  private summarizeCoverage(list: DayCounts[]): AttendanceCoverage {
    const expectedDays = list.reduce((s, c) => s + c.expectedDays, 0);
    const daysWithoutRecord = list.reduce((s, c) => s + c.noRecordDays, 0);
    const missingCheckoutDays = list.reduce((s, c) => s + c.missingCheckout, 0);
    const coveragePercent = expectedDays > 0 ? round2((100 * (expectedDays - daysWithoutRecord)) / expectedDays) : 100;
    return { expectedDays, daysWithoutRecord, missingCheckoutDays, coveragePercent };
  }

  private coverageWarnings(coverage: AttendanceCoverage): string[] {
    const warnings: string[] = [];
    if (coverage.daysWithoutRecord > 0) {
      warnings.push(
        `No attendance records for ${coverage.daysWithoutRecord} of ${coverage.expectedDays} working days — those days were treated as LOP (unpaid). Verify attendance before finalising.`,
      );
    }
    if (coverage.missingCheckoutDays > 0) {
      warnings.push(
        `${coverage.missingCheckoutDays} day(s) with a check-in but no check-out were paid 0 for that day. Resolve the missing check-outs before finalising.`,
      );
    }
    return warnings;
  }

  // ── Compute ────────────────────────────────────────────────────

  async compute(user: RequestUser, id: string) {
    const period = await this.getPeriodOrThrow(user, id);
    this.assertMutable(period);
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const tz = company?.timezone ?? "Asia/Kolkata";
    const { first, last, daysInMonth } = this.periodRange(period.year, period.month);

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: user.companyId,
        joiningDate: { lte: dateOnly(last) },
        OR: [{ employmentStatus: { not: "exited" } }, { dateOfExit: { gte: dateOnly(first) } }],
      },
      select: { id: true, fullName: true, employeeCode: true, dateOfExit: true, joiningDate: true, employmentStatus: true, pfApplicable: true, esiApplicable: true, tdsDeductedYtd: true, taxRegime: true },
      orderBy: { fullName: "asc" },
    });

    const exceptions: { employeeId: string; employeeName: string; reason: string }[] = [];
    const computed: { employeeId: string; counts: DayCounts; result: ReturnType<typeof computePayroll>; structureId: string; structureEffectiveFrom: Date }[] = [];
    // B10: fetch the attendance policy ONCE for the whole compute run.
    const policy = await this.prisma.attendancePolicy.findFirst({ where: { companyId: user.companyId, isDefault: true } });
    // TDS regime resolution (statutory round): per-employee taxRegime field
    // beats the employee's FY tax-declaration record, which beats the
    // company default (Company.settings.statutory.tdsRegime), else "new".
    // FY runs April–March, so a Jan–Mar period belongs to the prior FY.
    // The payrollTaxDeclaration guard keeps older unit-test mocks (which
    // lack the model) working; real Prisma always has it post-migration.
    const fyStartYear = period.month >= 4 ? period.year : period.year - 1;
    const declModel = (this.prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<Record<string, unknown>[]> } | undefined>).payrollTaxDeclaration;
    const declarations = declModel ? await declModel.findMany({ where: { financialYear: fyStartYear } }) : [];
    const declByEmployee = new Map(declarations.map((d) => [String(d.employeeId), d]));
    const companyStatutory = (company?.settings as unknown as { statutory?: { tdsRegime?: unknown } } | null)?.statutory;
    const companyTdsRegime: TaxRegime = companyStatutory?.tdsRegime === "old" ? "old" : "new";
    // Other per-employee queries still inside the loop (noted, not refactored
    // per scope): one salaryStructure lookup per employee. The holiday /
    // leave / attendance queries are batched per employee inside
    // monthDayCounts (3 queries each) — a further optimisation would fetch
    // them once per period and slice per employee in memory.

    for (const emp of employees) {
      const structure = await this.prisma.salaryStructure.findFirst({
        where: { employeeId: emp.id, effectiveFrom: { lte: dateOnly(last) } },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!structure) {
        exceptions.push({ employeeId: emp.id, employeeName: emp.fullName, reason: "No salary structure defined" });
        continue;
      }
      const effectiveEnd = emp.dateOfExit && ymdOf(emp.dateOfExit) < last ? ymdOf(emp.dateOfExit) : last;
      const counts = await this.monthDayCounts(user.companyId, tz, emp.id, period.year, period.month, effectiveEnd, {
        joiningDate: ymdOf(emp.joiningDate),
        policy,
      });
      if (counts.missingCheckout > 0) {
        exceptions.push({
          employeeId: emp.id, employeeName: emp.fullName,
          reason: `${counts.missingCheckout} day(s) with a check-in but no check-out — paid 0 for those days (counted in LOP). Resolve the check-outs before finalising.`,
        });
      }
      const comp = structure.components as unknown as SalaryComponents;
      // A3/A4: company statutory defaults overridden by employee flags; TDS
      // nets off what was already deducted this financial year.
      const decl = declByEmployee.get(emp.id);
      const empRegime = (emp as { taxRegime?: unknown }).taxRegime;
      const declRegime = decl?.regime;
      const tdsRegime: TaxRegime =
        empRegime === "old" || empRegime === "new" ? empRegime
        : declRegime === "old" || declRegime === "new" ? declRegime
        : companyTdsRegime;
      const taxDeclaration: TaxDeclaration | undefined = decl ? {
        section80C: Number(decl.section80C ?? 0),
        section80D: Number(decl.section80D ?? 0),
        hraExemption: Number(decl.hraExemption ?? 0),
      } : undefined;
      const result = computePayroll({
        components: comp,
        paidDays: counts.paidDays,
        lopDays: counts.lopDays,
        daysInMonth,
        statutory: { ...resolveStatutory(company?.settings, emp), tdsRegime, taxDeclaration },
        tdsDeductedYtd: Number(emp.tdsDeductedYtd ?? 0),
      });
      computed.push({ employeeId: emp.id, counts, result, structureId: structure.id, structureEffectiveFrom: structure.effectiveFrom });
    }

    // Replace draft records atomically. A per-period advisory lock (held until
    // this transaction commits) makes a concurrent compute fail fast with a
    // clean 409 instead of colliding mid-replace with a 500.
    await this.prisma.$transaction(
      async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${"payroll-compute:" + id})) AS locked`;
      if (!lock[0]?.locked) {
        throw new ConflictException({ code: "compute_in_progress", message: "A payroll computation is already running for this period — please retry in a moment" });
      }
      // A2 migration: legacy adjustment components (label ends with
      // " (adjustment)") that were never persisted to PayrollAdjustment are
      // rescued into the table BEFORE the component wipe, so recompute no
      // longer silently drops manual adjustments.
      const existingRecords = await tx.payrollRecord.findMany({
        where: { periodId: id },
        select: { id: true, employeeId: true, components: true },
      });
      const existingAdjustments = await tx.payrollAdjustment.findMany({ where: { periodId: id } });
      const seen = new Set(existingAdjustments.map((a) => [a.employeeId, a.componentKey, a.label, String(a.amount), a.kind].join("|")));
      for (const rec of existingRecords) {
        for (const comp of rec.components) {
          if (!comp.label.endsWith(ADJUSTMENT_SUFFIX)) continue;
          const label = comp.label.slice(0, -ADJUSTMENT_SUFFIX.length);
          const key = [rec.employeeId, comp.componentKey, label, String(comp.amount), comp.kind].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          await tx.payrollAdjustment.create({
            data: {
              periodId: id, employeeId: rec.employeeId, componentKey: comp.componentKey,
              label, amount: comp.amount, kind: comp.kind,
              note: "Migrated from a legacy adjustment component on recompute",
            },
          });
        }
      }
      const adjustments = await tx.payrollAdjustment.findMany({ where: { periodId: id } });
      const adjustmentsByEmployee = new Map<string, typeof adjustments>();
      for (const a of adjustments) {
        const list = adjustmentsByEmployee.get(a.employeeId) ?? [];
        list.push(a);
        adjustmentsByEmployee.set(a.employeeId, list);
      }
      const existing = existingRecords.map((r) => ({ id: r.id }));
      await tx.payrollComponent.deleteMany({ where: { payrollRecordId: { in: existing.map((r) => r.id) } } });
      await tx.payrollRecord.deleteMany({ where: { periodId: id } });
      for (const c of computed) {
        // A2: re-apply the period's adjustments on top of the regenerated
        // components, then retotal — adjustments survive recompute.
        const adjComponents = (adjustmentsByEmployee.get(c.employeeId) ?? []).map((a) => ({
          componentKey: a.componentKey, label: `${a.label}${ADJUSTMENT_SUFFIX}`, amount: Number(a.amount), kind: a.kind as "earning" | "deduction",
        }));
        const allComponents = [...c.result.components, ...adjComponents];
        const gross = round2(allComponents.filter((x) => x.kind === "earning").reduce((s, x) => s + x.amount, 0));
        const totalDeductions = round2(allComponents.filter((x) => x.kind === "deduction").reduce((s, x) => s + x.amount, 0));
        const rec = await tx.payrollRecord.create({
          data: {
            periodId: id, employeeId: c.employeeId,
            gross, totalDeductions, netPay: round2(gross - totalDeductions),
            lopDays: c.counts.lopDays, paidDays: c.counts.paidDays, status: "draft",
            // A6: salary snapshot — which structure priced this record.
            salaryStructureId: c.structureId, structureEffectiveFrom: c.structureEffectiveFrom,
          },
        });
        await tx.payrollComponent.createMany({
          data: allComponents.map((x) => ({
            payrollRecordId: rec.id, componentKey: x.componentKey, label: x.label, amount: x.amount, kind: x.kind,
          })),
        });
      }
    }, { maxWait: 10000, timeout: 60000 });

    const attendanceCoverage = this.summarizeCoverage(computed.map((c) => c.counts));
    const warnings = this.coverageWarnings(attendanceCoverage);
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.computed", entityType: "payroll_period", entityId: id, after: { computed: computed.length, exceptions: exceptions.length, attendanceCoverage } });
    return { computed: computed.length, exceptions, attendanceCoverage, warnings };
  }

  // ── Review / approval workflow ─────────────────────────────────

  /** An actor may not adjust their own payroll record unless they are md. */
  private assertNotSelfAdjustment(user: RequestUser, employeeId: string) {
    if (user.role !== "md" && user.employeeId && user.employeeId === employeeId) {
      throw new ForbiddenException({ code: "self_adjustment", message: "You cannot add an adjustment to your own payroll record — ask the MD" });
    }
  }

  /** Retotal a record from its current components (signed amounts). */
  private async retotalRecord(tx: Tx, recordId: string) {
    const components = await tx.payrollComponent.findMany({ where: { payrollRecordId: recordId } });
    const gross = round2(components.filter((c: { kind: string }) => c.kind === "earning").reduce((s: number, c: { amount: unknown }) => s + Number(c.amount), 0));
    const totalDeductions = round2(components.filter((c: { kind: string }) => c.kind === "deduction").reduce((s: number, c: { amount: unknown }) => s + Number(c.amount), 0));
    return tx.payrollRecord.update({
      where: { id: recordId },
      data: { gross, totalDeductions, netPay: round2(gross - totalDeductions) },
    });
  }

  /**
   * Rebuild a record's adjustment components from the PayrollAdjustment table
   * (the single source of truth) and retotal. Rebuilding — rather than
   * deleting one matching component — stays correct when two adjustments
   * share a key/label/amount.
   */
  private async syncAdjustmentComponents(tx: Tx, periodId: string, recordId: string, employeeId: string) {
    await tx.payrollComponent.deleteMany({
      where: { payrollRecordId: recordId, label: { endsWith: ADJUSTMENT_SUFFIX } },
    });
    const adjustments = await tx.payrollAdjustment.findMany({ where: { periodId, employeeId }, orderBy: { createdAt: "asc" } });
    if (adjustments.length > 0) {
      await tx.payrollComponent.createMany({
        data: adjustments.map((a: { componentKey: string; label: string; amount: unknown; kind: string }) => ({
          payrollRecordId: recordId, componentKey: a.componentKey,
          label: `${a.label}${ADJUSTMENT_SUFFIX}`, amount: a.amount, kind: a.kind,
        })),
      });
    }
    return this.retotalRecord(tx, recordId);
  }

  async adjust(user: RequestUser, periodId: string, input: PayrollAdjustmentInput) {
    const period = await this.getPeriodOrThrow(user, periodId);
    this.assertAdjustable(period);
    const record = await this.prisma.payrollRecord.findFirst({ where: { id: input.payrollRecordId, periodId } });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Payroll record not found" });
    this.assertNotSelfAdjustment(user, record.employeeId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // A2: persist to PayrollAdjustment first, so the next compute() keeps it.
      await tx.payrollAdjustment.create({
        data: {
          periodId, employeeId: record.employeeId, componentKey: input.componentKey,
          label: input.label, amount: input.amount, kind: input.kind,
          note: input.reason, createdById: user.userId,
        },
      });
      return this.syncAdjustmentComponents(tx, periodId, record.id, record.employeeId);
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.adjusted", entityType: "payroll_record", entityId: record.id, after: input });
    return updated;
  }

  // ── Adjustments (PayrollAdjustment table; survive recompute) ──────

  async listAdjustments(user: RequestUser, periodId: string) {
    const period = await this.getPeriodOrThrow(user, periodId);
    void period;
    return this.prisma.payrollAdjustment.findMany({
      where: { periodId },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addAdjustment(user: RequestUser, periodId: string, input: PayrollAdjustmentCreateInput) {
    const period = await this.getPeriodOrThrow(user, periodId);
    this.assertAdjustable(period);
    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, companyId: user.companyId } });
    if (!employee) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    this.assertNotSelfAdjustment(user, input.employeeId);
    const created = await this.prisma.$transaction(async (tx) => {
      const adj = await tx.payrollAdjustment.create({
        data: {
          periodId, employeeId: input.employeeId, componentKey: input.componentKey,
          label: input.label, amount: input.amount, kind: input.kind,
          note: input.note, createdById: user.userId,
        },
      });
      // If a record already exists for this employee, reflect it immediately;
      // otherwise compute() picks it up when the record is created.
      const record = await tx.payrollRecord.findFirst({ where: { periodId, employeeId: input.employeeId } });
      if (record) await this.syncAdjustmentComponents(tx, periodId, record.id, input.employeeId);
      return adj;
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.adjustment_added", entityType: "payroll_period", entityId: periodId, after: input });
    return created;
  }

  async removeAdjustment(user: RequestUser, periodId: string, adjustmentId: string) {
    const period = await this.getPeriodOrThrow(user, periodId);
    this.assertAdjustable(period);
    const adj = await this.prisma.payrollAdjustment.findFirst({ where: { id: adjustmentId, periodId } });
    if (!adj) throw new NotFoundException({ code: "not_found", message: "Adjustment not found" });
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollAdjustment.delete({ where: { id: adjustmentId } });
      const record = await tx.payrollRecord.findFirst({ where: { periodId, employeeId: adj.employeeId } });
      if (record) await this.syncAdjustmentComponents(tx, periodId, record.id, adj.employeeId);
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.adjustment_removed", entityType: "payroll_period", entityId: periodId, before: { adjustmentId } });
    return { ok: true };
  }

  private async transition(user: RequestUser, id: string, from: PayrollPeriodStatus[], to: PayrollPeriodStatus, action: string) {
    const period = await this.getPeriodOrThrow(user, id);
    // Atomic claim: the status condition is part of the UPDATE, so exactly one
    // of two concurrent transitions can move the period; the loser updates 0
    // rows and gets a clean 409 instead of both succeeding.
    const claim = await this.prisma.payrollPeriod.updateMany({
      where: { id, companyId: user.companyId, status: { in: from } },
      data: { status: to, ...(to === "finalized" ? { lockedAt: new Date(), approvedBy: user.userId } : {}) },
    });
    if (claim.count === 0) {
      const current = await this.getPeriodOrThrow(user, id);
      throw new ConflictException({ code: "invalid_transition", message: `Cannot move payroll from ${current.status} to ${to}` });
    }
    await this.prisma.payrollRecord.updateMany({ where: { periodId: id }, data: { status: to } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action, entityType: "payroll_period", entityId: id, before: { status: period.status }, after: { status: to } });
    // ── BEGIN NOTIFICATION (mailer workstream) ─────────────────────
    // submit() → in_review, approve() → approved, finalize() → finalized:
    // all three funnel through this transition, so one hook covers them.
    // Best-effort: a notification failure must never fail the transition.
    const notifyStatus: Record<string, PayrollTransitionStatus> = {
      in_review: "submitted",
      approved: "approved",
      finalized: "finalized",
    };
    const transitionStatus = notifyStatus[to];
    if (transitionStatus) {
      try {
        await this.notifications?.notifyPayrollTransition({
          companyId: user.companyId,
          year: period.year,
          month: period.month,
          status: transitionStatus,
        });
      } catch (err) {
        console.warn(`[payroll] payroll-${transitionStatus} notification failed:`, err instanceof Error ? err.message : err);
      }
    }
    // ── END NOTIFICATION (mailer workstream) ───────────────────────
    return this.getPeriodOrThrow(user, id);
  }

  submit(user: RequestUser, id: string) { return this.transition(user, id, ["draft"], "in_review", "payroll.submitted"); }
  approve(user: RequestUser, id: string) { return this.transition(user, id, ["in_review"], "approved", "payroll.approved"); }
  finalize(user: RequestUser, id: string) { return this.transition(user, id, ["approved"], "finalized", "payroll.finalized"); }

  // ── Outputs ────────────────────────────────────────────────────

  async registerRows(user: RequestUser, id: string) {
    const { records } = await this.getPeriod(user, id);
    return records.map((r) => {
      const comp = (key: string) => r.components.find((c) => c.componentKey === key)?.amount ?? 0;
      const allowances = r.components.filter((c) => c.componentKey.startsWith("allowance:")).reduce((s, c) => s + Number(c.amount), 0);
      return {
        employeeCode: r.employee.employeeCode, fullName: r.employee.fullName,
        department: r.employee.department?.name ?? "",
        paidDays: Number(r.paidDays), lopDays: Number(r.lopDays),
        basic: Number(comp("basic")), hra: Number(comp("hra")), allowances: round2(allowances),
        gross: Number(r.gross),
        pf: Number(comp("pf_employee")), esi: Number(comp("esi_employee")),
        professionalTax: Number(comp("pt")), tds: Number(comp("tds")), lop: Number(comp("lop")),
        otherDeductions: round2(r.components.filter((c) => c.kind === "deduction" && !["pf_employee", "esi_employee", "pt", "tds", "lop"].includes(c.componentKey)).reduce((s, c) => s + Number(c.amount), 0)),
        totalDeductions: Number(r.totalDeductions), netPay: Number(r.netPay),
      };
    });
  }

  async registerCsv(user: RequestUser, id: string): Promise<string> {
    return toCsv(await this.registerRows(user, id));
  }

  async myPayslip(user: RequestUser, year: number, month: number) {
    if (!user.employeeId) throw new BadRequestException({ code: "no_employee", message: "Your login is not linked to an employee record" });
    const period = await this.prisma.payrollPeriod.findFirst({ where: { companyId: user.companyId, year, month, status: "finalized" } });
    if (!period) throw new NotFoundException({ code: "not_found", message: "Finalized payslip not available for this month" });
    const record = await this.prisma.payrollRecord.findFirst({
      where: { periodId: period.id, employeeId: user.employeeId },
      include: {
        components: true,
        employee: { select: { fullName: true, employeeCode: true, department: { select: { name: true } }, designation: { select: { title: true } } } },
      },
    });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Payslip not found" });
    return { period: { year: period.year, month: period.month }, record };
  }

  /**
   * Payslip PDF for one payroll record. Company-scoped (the record's period
   * must belong to the caller's company). HR/MD may download any record;
   * an employee may download only their own record from a FINALIZED period
   * (mirroring myPayslip); anyone else gets 403, cross-company gets 404.
   */
  async payslipPdf(user: RequestUser, recordId: string): Promise<Buffer> {
    const record = await this.prisma.payrollRecord.findFirst({
      where: { id: recordId },
      include: {
        period: true,
        components: true,
        employee: { select: { fullName: true, employeeCode: true, department: { select: { name: true } }, designation: { select: { title: true } } } },
      },
    });
    if (!record || record.period.companyId !== user.companyId) {
      throw new NotFoundException({ code: "not_found", message: "Payslip not found" });
    }
    const isStaff = user.role === "hr" || user.role === "md";
    if (!isStaff) {
      if (!user.employeeId || user.employeeId !== record.employeeId) {
        throw new ForbiddenException({ code: "forbidden", message: "You can only download your own payslip" });
      }
      if (record.period.status !== "finalized") {
        throw new NotFoundException({ code: "not_found", message: "Finalized payslip not available for this month" });
      }
    }
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return buildPayslipPdf({
      companyName: company?.name ?? "Company",
      employeeName: record.employee.fullName,
      employeeCode: record.employee.employeeCode,
      department: record.employee.department?.name,
      designation: record.employee.designation?.title,
      periodLabel: `${monthNames[record.period.month - 1]} ${record.period.year}`,
      paidDays: Number(record.paidDays),
      lopDays: Number(record.lopDays),
      components: record.components.map((c) => ({
        label: c.label, amount: Number(c.amount),
        kind: (c.kind === "employer" ? "employer" : c.kind === "earning" ? "earning" : "deduction") as "earning" | "deduction" | "employer",
      })),
      gross: Number(record.gross),
      totalDeductions: Number(record.totalDeductions),
      netPay: Number(record.netPay),
    });
  }

  /**
   * NEFT bank-transfer file for a FINALIZED period only (non-finalized
   * periods are rejected with 409). Company-scoped via getPeriodOrThrow.
   * Rows carry beneficiary name, account number, IFSC, amount and the
   * period reference. Records without usable bank details, or with
   * non-positive net pay, are skipped and reported — never silently paid
   * with a blank account. Bank details are decrypted per employee; a
   * decryption failure skips that employee rather than failing the file.
   */
  async bankTransferCsv(user: RequestUser, periodId: string) {
    const period = await this.getPeriodOrThrow(user, periodId);
    if (period.status !== "finalized") {
      throw new ConflictException({ code: "period_not_finalized", message: "Bank transfer files are only available for finalized payroll periods" });
    }
    const records = await this.prisma.payrollRecord.findMany({
      where: { periodId },
      include: { employee: { select: { fullName: true, employeeCode: true, bankDetails: true } } },
      orderBy: { employee: { fullName: "asc" } },
    });
    const periodLabel = `${period.year}-${String(period.month).padStart(2, "0")}`;
    const rows: Record<string, unknown>[] = [];
    const skipped: { employeeCode: string; fullName: string; reason: string }[] = [];
    for (const r of records) {
      const emp = r.employee;
      type BankLike = { accountHolder?: unknown; accountNumber?: unknown; ifsc?: unknown };
      let bank: BankLike | null = null;
      try {
        const decoded = decryptBankDetails(emp.bankDetails) as BankLike | null;
        bank = decoded && typeof decoded === "object" ? decoded : null;
      } catch {
        // keep null: bank details unavailable, handled by the skip below
      }
      if (!bank?.accountNumber || !bank?.ifsc) {
        skipped.push({ employeeCode: emp.employeeCode, fullName: emp.fullName, reason: bank ? "Missing account number or IFSC in bank details" : "Bank details unavailable" });
        continue;
      }
      if (Number(r.netPay) <= 0) {
        skipped.push({ employeeCode: emp.employeeCode, fullName: emp.fullName, reason: "Non-positive net pay" });
        continue;
      }
      rows.push({
        "Beneficiary Name": bank.accountHolder ?? emp.fullName,
        "Employee Code": emp.employeeCode,
        "Account Number": bank.accountNumber,
        IFSC: bank.ifsc,
        Amount: Number(r.netPay).toFixed(2),
        Period: periodLabel,
      });
    }
    const csv = rows.length > 0
      ? toCsv(rows)
      : "Beneficiary Name,Employee Code,Account Number,IFSC,Amount,Period\n";
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "payroll.bank_file_exported", entityType: "payroll_period", entityId: periodId, after: { rows: rows.length, skipped: skipped.length, period: periodLabel } });
    return { csv, period: periodLabel, rows: rows.length, skipped };
  }

  async costByDepartment(user: RequestUser, id: string) {
    const { records } = await this.getPeriod(user, id);
    const byDept = new Map<string, { department: string; headcount: number; gross: number; netPay: number }>();
    for (const r of records) {
      const name = r.employee.department?.name ?? "Unassigned";
      const cur = byDept.get(name) ?? { department: name, headcount: 0, gross: 0, netPay: 0 };
      cur.headcount++;
      cur.gross = round2(cur.gross + Number(r.gross));
      cur.netPay = round2(cur.netPay + Number(r.netPay));
      byDept.set(name, cur);
    }
    return [...byDept.values()].sort((a, b) => b.gross - a.gross);
  }
}
