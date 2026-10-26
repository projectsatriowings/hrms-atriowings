import { annualTdsOn, computePayroll } from "./payroll.calc";

const base = {
  daysInMonth: 30,
  statutory: { pf: true, esi: true, pt: true, tds: true, ptState: "TN" },
};

describe("payroll.calc", () => {
  test("standard salary: PF capped at 15000 wages, TN PT, no TDS under 12L", () => {
    const r = computePayroll({
      ...base,
      components: {
        basic: 30000, hra: 12000,
        allowances: [{ label: "Conveyance", amount: 1600 }, { label: "Medical", amount: 1250 }],
        deductions: [],
      },
      paidDays: 30, lopDays: 0,
    });
    expect(r.gross).toBe(44850);
    const pf = r.components.find((c) => c.componentKey === "pf_employee");
    expect(pf?.amount).toBe(1800); // 12% of capped 15000
    const pt = r.components.find((c) => c.componentKey === "pt");
    expect(pt?.amount).toBe(208); // TN slab above 12500
    expect(r.components.find((c) => c.componentKey === "tds")).toBeUndefined();
    expect(r.components.find((c) => c.componentKey === "esi_employee")).toBeUndefined(); // > 21000
    expect(r.totalDeductions).toBe(2008);
    expect(r.netPay).toBe(42842);
  });

  test("LOP reduces pay and drives statutory wages", () => {
    const r = computePayroll({
      ...base,
      components: {
        basic: 30000, hra: 12000,
        allowances: [{ label: "Conveyance", amount: 1600 }, { label: "Medical", amount: 1250 }],
        deductions: [],
      },
      paidDays: 28, lopDays: 2,
    });
    const lop = r.components.find((c) => c.componentKey === "lop");
    expect(lop?.amount).toBe(2990); // 44850/30 * 2
    expect(r.totalDeductions).toBe(4998); // 2990 + 1800 + 208
    expect(r.netPay).toBe(39852);
  });

  test("ESI applies at/below 21000 wages", () => {
    const r = computePayroll({
      ...base,
      components: { basic: 12000, hra: 5000, allowances: [{ label: "Conveyance", amount: 3000 }], deductions: [] },
      paidDays: 30, lopDays: 0,
    });
    expect(r.gross).toBe(20000);
    expect(r.components.find((c) => c.componentKey === "esi_employee")?.amount).toBe(150);
    expect(r.components.find((c) => c.componentKey === "esi_employer")?.amount).toBe(650);
    expect(r.components.find((c) => c.componentKey === "pf_employee")?.amount).toBe(1440);
    expect(r.netPay).toBe(18202);
  });

  test("high earner: TDS via new-regime slabs", () => {
    const r = computePayroll({
      ...base,
      components: { basic: 150000, hra: 60000, allowances: [{ label: "Special", amount: 10000 }], deductions: [] },
      paidDays: 30, lopDays: 0,
    });
    expect(r.gross).toBe(220000);
    expect(r.components.find((c) => c.componentKey === "tds")?.amount).toBe(30290);
    expect(r.netPay).toBe(187702);
  });

  test("annualTdsOn: rebate to zero at 12L, marginal relief just above", () => {
    expect(annualTdsOn(1200000 + 75000)).toBe(0); // taxable exactly 12L
    expect(annualTdsOn(1250000 + 75000)).toBe(52000); // slabs give 67500, marginal relief caps at 50000, +4% cess
  });

  test("statutory flags can disable components", () => {
    const r = computePayroll({
      ...base,
      statutory: { pf: false, esi: false, pt: false, tds: false },
      components: { basic: 30000, hra: 12000, allowances: [], deductions: [] },
      paidDays: 30, lopDays: 0,
    });
    expect(r.totalDeductions).toBe(0);
    expect(r.netPay).toBe(42000);
  });
});
