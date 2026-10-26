import { computePayroll, annualTdsOn } from "./payroll.calc";
import { PayrollService } from "./payroll.service";

const HIGH_EARNER = {
  daysInMonth: 30,
  statutory: { pf: true, esi: true, pt: true, tds: true, ptState: "TN" },
  components: { basic: 150000, hra: 60000, allowances: [{ label: "Special", amount: 10000 }], deductions: [] },
  paidDays: 30, lopDays: 0,
};

function mockService(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    attendancePolicy: { findFirst: jest.fn().mockResolvedValue({ weeklyOffs: [0] }) },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Kolkata", settings: {} }) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    salaryStructure: { findFirst: jest.fn() },
    payrollPeriod: { findFirst: jest.fn() },
    payrollRecord: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), deleteMany: jest.fn() },
    payrollComponent: { deleteMany: jest.fn(), createMany: jest.fn() },
    payrollAdjustment: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    ...overrides,
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new PayrollService(prisma, audit as never), prisma };
}

describe("payroll review fixes", () => {
  test("TDS YTD subtraction: monthly TDS nets off tax already deducted", () => {
    const annualTax = annualTdsOn(220000 * 12);
    const ytd = 120000;
    const r = computePayroll({ ...HIGH_EARNER, tdsDeductedYtd: ytd });
    const expected = Math.round(Math.max(0, annualTax - ytd) / 12 * 100) / 100;
    expect(r.components.find((c) => c.componentKey === "tds")?.amount).toBe(expected);
    expect(r.components.find((c) => c.componentKey === "tds")?.label).toBe("TDS (estimate)");
  });

  test("TDS floors at 0 when YTD already covers the annual tax", () => {
    const r = computePayroll({ ...HIGH_EARNER, tdsDeductedYtd: 999_999_999 });
    expect(r.components.find((c) => c.componentKey === "tds")).toBeUndefined();
  });

  test("joiner mid-month: pre-joining days are not LOP (paid + lop == window)", async () => {
    const { service } = mockService();
    // October 2026: 31 days, Sundays 4/11/18/25. Joined Fri 16 Oct.
    const c = await (service as any).monthDayCounts("co", "Asia/Kolkata", "e1", 2026, 10, "2026-10-31", {
      joiningDate: "2026-10-16", policy: { weeklyOffs: [0] },
    });
    expect(c.paidDays).toBe(2); // Sundays 18 + 25 only
    expect(c.lopDays).toBe(14); // 16-day window (16..31) minus 2 paid
    expect(c.paidDays + c.lopDays).toBe(16);
  });

  test("leaver mid-month: window ends at exit date", async () => {
    const { service } = mockService();
    const c = await (service as any).monthDayCounts("co", "Asia/Kolkata", "e1", 2026, 10, "2026-10-15", {
      joiningDate: "2026-10-01", policy: { weeklyOffs: [0] },
    });
    expect(c.paidDays).toBe(2); // Sundays 4 + 11
    expect(c.lopDays).toBe(13); // 15-day window minus 2 paid
    expect(c.paidDays + c.lopDays).toBe(15);
  });

  test("full-month employee: paid + lop == days in month", async () => {
    const { service } = mockService();
    const c = await (service as any).monthDayCounts("co", "Asia/Kolkata", "e1", 2026, 10, "2026-10-31", {
      joiningDate: "2026-10-01", policy: { weeklyOffs: [0] },
    });
    expect(c.paidDays).toBe(4);
    expect(c.lopDays).toBe(27);
    expect(c.paidDays + c.lopDays).toBe(31);
  });

  test("open check-in day pays 0, is flagged, and keeps the window invariant", async () => {
    const { service, prisma } = mockService();
    prisma.attendanceRecord.findMany.mockResolvedValue([
      // Mon 5 Oct: checked in, never checked out -> unpaid, not "present".
      { workDate: new Date("2026-10-05T00:00:00Z"), status: "present", checkInAt: new Date("2026-10-05T04:00:00Z"), checkOutAt: null },
      // Tue 6 Oct: completed present day -> paid.
      { workDate: new Date("2026-10-06T00:00:00Z"), status: "present", checkInAt: new Date("2026-10-06T04:00:00Z"), checkOutAt: new Date("2026-10-06T12:30:00Z") },
      // Sun 4 Oct: weekly_off record without checkout still pays (no checkout expected).
      { workDate: new Date("2026-10-04T00:00:00Z"), status: "weekly_off", checkInAt: null, checkOutAt: null },
    ]);
    const c = await (service as any).monthDayCounts("co", "Asia/Kolkata", "e1", 2026, 10, "2026-10-31", {
      joiningDate: "2026-10-01", policy: { weeklyOffs: [0] },
    });
    expect(c.missingCheckout).toBe(1);
    expect(c.present).toBe(1); // only the completed 6 Oct day
    expect(c.paidDays).toBe(5); // Sundays 4/11/18/25 (4) + 6 Oct (1); 5 Oct = 0
    expect(c.lopDays).toBe(26);
    expect(c.paidDays + c.lopDays).toBe(31);
  });

  test("adjustments survive recompute: compute() re-applies them and retotals", async () => {
    const createdRecords: any[] = [];
    const createdComponents: any[] = [];
    const fakeTx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      payrollRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => { createdRecords.push(data); return { id: "rec1", ...data }; }),
        deleteMany: jest.fn(),
      },
      payrollComponent: {
        deleteMany: jest.fn(),
        createMany: jest.fn(async ({ data }: any) => { createdComponents.push(...data); return { count: data.length }; }),
      },
      payrollAdjustment: {
        findMany: jest.fn().mockResolvedValue([
          { employeeId: "e1", componentKey: "bonus", label: "Bonus", amount: 5000, kind: "earning" },
        ]),
        create: jest.fn(),
      },
    };
    const { service, prisma } = mockService({
      $transaction: jest.fn(async (cb: any) => cb(fakeTx)),
    });
    prisma.payrollPeriod.findFirst.mockResolvedValue({ id: "p1", companyId: "co", year: 2026, month: 10, status: "draft" });
    prisma.employee.findMany.mockResolvedValue([{
      id: "e1", fullName: "Test One", employeeCode: "E1", dateOfExit: null,
      joiningDate: new Date("2026-01-01T00:00:00Z"), employmentStatus: "active",
      pfApplicable: null, esiApplicable: null, tdsDeductedYtd: 0,
    }]);
    prisma.salaryStructure.findFirst.mockResolvedValue({
      id: "struct1", effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      components: { basic: 30000, hra: 12000, allowances: [], deductions: [] },
    });
    const out = await service.compute({ userId: "u1", companyId: "co", role: "hr", email: "hr@x", employeeId: null } as never, "p1");
    expect(out.computed).toBe(1);
    const adj = createdComponents.find((c) => c.componentKey === "bonus");
    expect(adj).toBeDefined();
    expect(adj.label).toBe("Bonus (adjustment)");
    expect(adj.amount).toBe(5000);
    // Base gross is the full-month 42000; the adjustment lifts it to 47000.
    expect(createdRecords[0].gross).toBe(47000);
    expect(createdRecords[0].salaryStructureId).toBe("struct1");
    // B10: the attendance policy is fetched once per compute, not per employee.
    expect(prisma.attendancePolicy.findFirst).toHaveBeenCalledTimes(1);
  });

  test("self-adjustment is forbidden for non-md actors", async () => {
    const { service, prisma } = mockService();
    prisma.payrollPeriod.findFirst.mockResolvedValue({ id: "p1", companyId: "co", year: 2026, month: 10, status: "draft" });
    prisma.payrollRecord.findFirst = jest.fn().mockResolvedValue({ id: "r1", periodId: "p1", employeeId: "e-self" });
    let err: any;
    try {
      await service.adjust(
        { userId: "u1", companyId: "co", role: "hr", email: "hr@x", employeeId: "e-self" } as never,
        "p1",
        { payrollRecordId: "r1", componentKey: "bonus", label: "Bonus", amount: 100, kind: "earning", reason: "test reason" },
      );
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(typeof err.getStatus === "function" ? err.getStatus() : err.status).toBe(403);
  });
});
