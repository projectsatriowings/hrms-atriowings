import { PayrollService } from "./payroll.service";
import { buildPayslipPdf } from "./payslip.pdf";

function mockService(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    company: { findUnique: jest.fn().mockResolvedValue({ name: "Atriowings Technologies" }) },
    payrollPeriod: { findFirst: jest.fn() },
    payrollRecord: { findFirst: jest.fn(), findMany: jest.fn() },
    ...overrides,
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new PayrollService(prisma, audit as never), prisma, audit };
}


async function expectStatus(promise: Promise<unknown>, code: number) {
  let err: any;
  try { await promise; } catch (e) { err = e; }
  expect(err).toBeDefined();
  expect(typeof err.getStatus === "function" ? err.getStatus() : err.status).toBe(code);
}

const hr = { userId: "u-hr", companyId: "co", role: "hr", email: "hr@x", employeeId: "e-hr" } as never;
const empSelf = { userId: "u-e1", companyId: "co", role: "employee", email: "e@x", employeeId: "e1" };

describe("payslip PDF", () => {
  test("buildPayslipPdf produces a real PDF starting with %PDF", async () => {
    const buf = await buildPayslipPdf({
      companyName: "Atriowings Technologies",
      employeeName: "Test One", employeeCode: "E1",
      periodLabel: "October 2026", paidDays: 30, lopDays: 0,
      components: [
        { label: "Basic Salary", amount: 30000, kind: "earning" },
        { label: "TDS (estimate)", amount: 1000, kind: "deduction" },
      ],
      gross: 30000, totalDeductions: 1000, netPay: 29000,
    });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(500);
    // TDS stays labelled an estimate: pdfkit writes text as hex TJ
    // arrays, so decode the hex strings before asserting on the text.
    const raw = buf.toString("latin1");
    const decoded = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
      .map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");
    expect(decoded).toContain("PAYSLIP");
    expect(decoded).toContain("TDS (estimate)");
  });

  test("payslipPdf: HR downloads any company record; employee only own finalized record", async () => {
    const record: any = {
      id: "rec1", period: { companyId: "co", year: 2026, month: 10, status: "finalized" },
      gross: 30000, totalDeductions: 1000, netPay: 29000, paidDays: 30, lopDays: 0,
      components: [{ label: "Basic Salary", amount: 30000, kind: "earning" }],
      employeeId: "e1",
      employee: { fullName: "Test One", employeeCode: "E1", department: null, designation: null },
    };
    const { service, prisma } = mockService();
    prisma.payrollRecord.findFirst.mockResolvedValue(record);
    const pdf = await service.payslipPdf(hr as never, "rec1");
    expect(pdf.slice(0, 4).toString("ascii")).toBe("%PDF");
    // Employee self: allowed (finalized, own record).
    await expect(service.payslipPdf(empSelf as never, "rec1")).resolves.toBeInstanceOf(Buffer);
    // Employee other record: 403.
    const other = { ...empSelf, employeeId: "e2" } as never;
    await expectStatus(service.payslipPdf(other, "rec1"), 403);
    // Cross-company record: 404.
    prisma.payrollRecord.findFirst.mockResolvedValue({ ...record, period: { ...record.period, companyId: "other-co" } });
    await expectStatus(service.payslipPdf(hr as never, "rec1"), 404);
    // Own record but period not finalized: 404 (mirrors myPayslip).
    prisma.payrollRecord.findFirst.mockResolvedValue({ ...record, period: { ...record.period, status: "draft" } });
    await expectStatus(service.payslipPdf(empSelf as never, "rec1"), 404);
  });
});

describe("NEFT bank transfer file", () => {
  function finalizedService() {
    const { service, prisma, audit } = mockService();
    prisma.payrollPeriod.findFirst.mockResolvedValue({ id: "p1", companyId: "co", year: 2026, month: 10, status: "finalized" });
    prisma.payrollRecord.findMany.mockResolvedValue([
      {
        netPay: 42842,
        employee: { fullName: "Test One", employeeCode: "E1", bankDetails: { accountHolder: "Test One", accountNumber: "1234567890", ifsc: "SBIN0001234" } },
      },
      {
        netPay: 15000,
        employee: { fullName: "No Bank", employeeCode: "E2", bankDetails: null },
      },
      {
        netPay: 0,
        employee: { fullName: "Zero Pay", employeeCode: "E3", bankDetails: { accountNumber: "999", ifsc: "HDFC0000001" } },
      },
    ]);
    return { service, prisma, audit };
  }

  test("CSV shape: beneficiary, account, IFSC, amount, period; skips reported", async () => {
    const { service } = finalizedService();
    const out = await service.bankTransferCsv(hr as never, "p1");
    expect(out.period).toBe("2026-10");
    expect(out.rows).toBe(1);
    expect(out.skipped.map((s) => s.employeeCode)).toEqual(["E2", "E3"]);
    const lines = out.csv.trim().split("\n");
    expect(lines[0]).toContain("Beneficiary Name");
    expect(lines[0]).toContain("Account Number");
    expect(lines[0]).toContain("IFSC");
    expect(lines[0]).toContain("Amount");
    expect(lines[0]).toContain("Period");
    expect(lines[1]).toContain("Test One");
    expect(lines[1]).toContain("1234567890");
    expect(lines[1]).toContain("SBIN0001234");
    expect(lines[1]).toContain("42842.00");
    expect(lines[1]).toContain("2026-10");
  });

  test("non-finalized periods are rejected with 409", async () => {
    const { service, prisma } = mockService();
    prisma.payrollPeriod.findFirst.mockResolvedValue({ id: "p1", companyId: "co", year: 2026, month: 10, status: "draft" });
    await expectStatus(service.bankTransferCsv(hr as never, "p1"), 409);
    prisma.payrollPeriod.findFirst.mockResolvedValue({ id: "p1", companyId: "co", year: 2026, month: 10, status: "approved" });
    await expectStatus(service.bankTransferCsv(hr as never, "p1"), 409);
  });

  test("unknown period is 404", async () => {
    const { service, prisma } = mockService();
    prisma.payrollPeriod.findFirst.mockResolvedValue(null);
    await expectStatus(service.bankTransferCsv(hr as never, "p1"), 404);
  });
});
