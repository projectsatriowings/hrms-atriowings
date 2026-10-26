import { proratedLeaveAllocation, rolloverCarry, splitDatesByYear } from "@hrms/shared";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { LeaveService } from "./leave.service";

// @nestjs/schedule ships ESM in its dist entry, which Jest's CommonJS
// transform cannot parse. The service only uses it for the @Cron decorator,
// so stub it: the decorator factory returns a no-op decorator.
jest.mock("@nestjs/schedule", () => ({ Cron: () => () => undefined }));

/** Service-level rollover tests (A7 gate addition): the Jan 1 job posts a
 * capped carry_forward AND the new year's full default allocation,
 * idempotently. Prisma is mocked; the audit log is a jest.fn. */
type LedgerCreate = { entryType: string; year?: number; deltaDays?: number; [key: string]: unknown };

function makeRolloverService(opts: { prior: { deltaDays: number }[]; existing: Record<string, object | null> }) {
  const creates: LedgerCreate[] = [];
  const auditLog = jest.fn().mockResolvedValue(undefined);
  const findFirst = jest.fn(async (args: { where: { entryType: string } }) => {
    const key = `${args.where.entryType}`;
    return opts.existing[key] ?? null;
  });
  const prisma = {
    company: { findMany: jest.fn(async () => [{ id: "c1" }]) },
    employee: { findMany: jest.fn(async () => [{ id: "e1" }]) },
    leaveType: {
      findMany: jest.fn(async () => [
        { id: "t1", carryForward: true, isActive: true, defaultDays: 12, maxCarryDays: 5 },
      ]),
    },
    leaveLedger: {
      findMany: jest.fn(async () => opts.prior),
      findFirst,
      create: jest.fn(async (args: { data: LedgerCreate }) => { creates.push(args.data); return args.data; }),
    },
  };
  const svc = new LeaveService(prisma as unknown as PrismaService, { log: auditLog } as unknown as AuditService);
  return { svc, creates, auditLog };
}

describe("rollover posting incl. fresh-year allocation (A7)", () => {
  test("carry capped at maxCarryDays + full default allocation created", async () => {
    const { svc, creates, auditLog } = makeRolloverService({
      prior: [{ deltaDays: 12 }, { deltaDays: -2 }], // unused 10, cap 5
      existing: {},
    });
    const res = await svc.rolloverLeaveBalances(2027);
    expect(res).toEqual({ newYear: 2027, priorYear: 2026, carried: 1, allocated: 1 });
    const carry = creates.find((c) => c.entryType === "carry_forward");
    const alloc = creates.find((c) => c.entryType === "allocation");
    expect(carry).toMatchObject({ year: 2027, deltaDays: 5 });
    expect(alloc).toMatchObject({ year: 2027, deltaDays: 12 });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "leave.rollover",
      after: expect.objectContaining({ carried: 1, allocated: 1 }),
    }));
  });

  test("idempotent: existing carry + allocation are skipped, no audit", async () => {
    const { svc, creates, auditLog } = makeRolloverService({
      prior: [{ deltaDays: 10 }],
      existing: { carry_forward: { id: "x" }, allocation: { id: "y" } },
    });
    const res = await svc.rolloverLeaveBalances(2027);
    expect(res).toEqual({ newYear: 2027, priorYear: 2026, carried: 0, allocated: 0 });
    expect(creates).toEqual([]);
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("zero unused balance still creates the fresh-year allocation", async () => {
    const { svc, creates } = makeRolloverService({ prior: [], existing: {} });
    const res = await svc.rolloverLeaveBalances(2027);
    expect(res.carried).toBe(0);
    expect(res.allocated).toBe(1);
    expect(creates).toHaveLength(1);
    expect(creates[0].entryType).toBe("allocation");
  });
});

/**
 * Pure-logic tests for the leave-review fixes. Service-level behaviour
 * (decide() balance re-check, self-approval, attendance conflicts,
 * year-split ledger entries, rollover posting) is covered by the live
 * probe scripts in /tmp/leave-probes/, which the coordinator runs against
 * the restarted stack — the running API must not be restarted mid-task.
 */
describe("leave allocation pro-rating (A7)", () => {
  test("joining in January gets the full year", () => {
    expect(proratedLeaveAllocation(12, "2026-01-15")).toBe(12);
  });
  test("joining month counts: March join → 10/12 of the year", () => {
    expect(proratedLeaveAllocation(12, "2026-03-01")).toBe(10);
  });
  test("December join → 1/12, rounded to 2 decimals", () => {
    expect(proratedLeaveAllocation(12, "2026-12-20")).toBe(1);
    expect(proratedLeaveAllocation(10, "2026-12-01")).toBe(0.83);
  });
  test("rounding is 2-decimal half-up, matching Decimal(5,2)", () => {
    // 15 × 7/12 = 8.75 exactly; 10 × 5/12 = 4.166… → 4.17
    expect(proratedLeaveAllocation(15, "2026-06-10")).toBe(8.75);
    expect(proratedLeaveAllocation(10, "2026-08-01")).toBe(4.17);
  });
  test("zero default days stays zero", () => {
    expect(proratedLeaveAllocation(0, "2026-04-01")).toBe(0);
  });
});

describe("leave year split (A11)", () => {
  test("Dec 30 – Jan 2 working dates split by calendar year", () => {
    const segments = splitDatesByYear(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(segments).toEqual([
      { year: 2026, dates: ["2026-12-30", "2026-12-31"] },
      { year: 2027, dates: ["2027-01-01", "2027-01-02"] },
    ]);
  });
  test("single-year range yields one segment", () => {
    expect(splitDatesByYear(["2026-05-04", "2026-05-05"])).toEqual([
      { year: 2026, dates: ["2026-05-04", "2026-05-05"] },
    ]);
  });
});

describe("rollover carry (A7)", () => {
  test("uncapped carry forwards the whole unused balance", () => {
    expect(rolloverCarry(5, null)).toBe(5);
    expect(rolloverCarry(5, undefined)).toBe(5);
  });
  test("maxCarryDays caps the carry", () => {
    expect(rolloverCarry(10, 5)).toBe(5);
    expect(rolloverCarry(3, 5)).toBe(3);
  });
  test("zero or negative unused balance carries nothing", () => {
    expect(rolloverCarry(0, null)).toBe(0);
    expect(rolloverCarry(-2, 5)).toBe(0);
  });
});
