import {
  annualTdsOn, annualTdsOnOld, computePayroll, pfWagesFor,
  professionalTaxFor, PT_IMPLEMENTED_STATES,
} from "./payroll.calc";

const noStat = { pf: false, esi: false, pt: false, tds: false };

function withStat(statutory: Record<string, unknown>, components: Record<string, unknown>) {
  return computePayroll({
    components: {
      basic: 0, hra: 0, allowances: [], deductions: [],
      ...(components as object),
    } as never,
    paidDays: 30, lopDays: 0, daysInMonth: 30,
    statutory: { ...noStat, ...statutory } as never,
  });
}

describe("professional tax per-state slabs", () => {
  test("TN slabs are kept exactly as before", () => {
    expect(professionalTaxFor("TN", 3500)).toBe(0);
    expect(professionalTaxFor("TN", 5000)).toBe(22.5);
    expect(professionalTaxFor("TN", 7500)).toBe(52.5);
    expect(professionalTaxFor("TN", 10000)).toBe(115);
    expect(professionalTaxFor("TN", 12500)).toBe(171);
    expect(professionalTaxFor("TN", 44850)).toBe(208);
  });

  test("monthly-slab states", () => {
    expect(professionalTaxFor("MH", 7500)).toBe(0);
    expect(professionalTaxFor("MH", 10000)).toBe(175);
    expect(professionalTaxFor("MH", 50000)).toBe(200);
    expect(professionalTaxFor("KA", 25000)).toBe(0);
    expect(professionalTaxFor("KA", 25001)).toBe(200);
    expect(professionalTaxFor("GJ", 5999)).toBe(0);
    expect(professionalTaxFor("GJ", 6000)).toBe(80);
    expect(professionalTaxFor("GJ", 9000)).toBe(150);
    expect(professionalTaxFor("GJ", 12000)).toBe(200);
    expect(professionalTaxFor("AP", 15000)).toBe(0);
    expect(professionalTaxFor("AP", 20000)).toBe(150);
    expect(professionalTaxFor("AP", 20001)).toBe(200);
    expect(professionalTaxFor("TG", 30000)).toBe(200);
    expect(professionalTaxFor("TS", 30000)).toBe(200); // Telangana alias
    expect(professionalTaxFor("AS", 10000)).toBe(0);
    expect(professionalTaxFor("AS", 15000)).toBe(150);
    expect(professionalTaxFor("AS", 25000)).toBe(180);
    expect(professionalTaxFor("AS", 25001)).toBe(208);
    expect(professionalTaxFor("MP", 18750)).toBe(0);
    expect(professionalTaxFor("MP", 25000)).toBe(125);
    expect(professionalTaxFor("MP", 33333)).toBe(167);
    expect(professionalTaxFor("MP", 40000)).toBe(208);
    expect(professionalTaxFor("CG", 8333)).toBe(0);
    expect(professionalTaxFor("CG", 12500)).toBe(130);
    expect(professionalTaxFor("CG", 30000)).toBe(208);
    expect(professionalTaxFor("ML", 4166)).toBe(0);
    expect(professionalTaxFor("ML", 6250)).toBe(16.5);
    expect(professionalTaxFor("ML", 50000)).toBe(208);
    expect(professionalTaxFor("SK", 20000)).toBe(0);
    expect(professionalTaxFor("SK", 30000)).toBe(125);
    expect(professionalTaxFor("SK", 50000)).toBe(200);
    expect(professionalTaxFor("TR", 7500)).toBe(0);
    expect(professionalTaxFor("TR", 15000)).toBe(150);
    expect(professionalTaxFor("TR", 15001)).toBe(208);
    expect(professionalTaxFor("MZ", 5000)).toBe(0);
    expect(professionalTaxFor("MZ", 15001)).toBe(208);
  });

  test("West Bengal uses the 1 Oct 2026 slabs", () => {
    expect(professionalTaxFor("WB", 20000)).toBe(0);
    expect(professionalTaxFor("WB", 30000)).toBe(100);
    expect(professionalTaxFor("WB", 50000)).toBe(140);
    expect(professionalTaxFor("WB", 100000)).toBe(170);
    expect(professionalTaxFor("WB", 100001)).toBe(208);
  });

  test("annual / half-yearly states are spread monthly", () => {
    expect(professionalTaxFor("JH", 25000)).toBe(0); // annual 3,00,000
    expect(professionalTaxFor("JH", 40000)).toBe(100); // annual 4,80,000 -> 1,200/yr
    expect(professionalTaxFor("JH", 100000)).toBe(208.33); // 2,500/yr / 12
    expect(professionalTaxFor("BR", 40000)).toBe(83.33); // 1,000/yr / 12
    expect(professionalTaxFor("BR", 100000)).toBe(208.33);
    expect(professionalTaxFor("KL", 10000)).toBe(125); // half-year 60,000 -> 750 / 6
    expect(professionalTaxFor("KL", 5000)).toBe(100); // half-year 30,000 -> 600 / 6
  });

  test("no-PT states return 0 (a positive fact, not a fallback)", () => {
    expect(professionalTaxFor("DL", 100000)).toBe(0);
    expect(professionalTaxFor("UP", 100000)).toBe(0);
    expect(professionalTaxFor("Delhi", 100000)).toBe(0);
  });

  test("unknown states FAIL LOUDLY naming the state", () => {
    expect(() => professionalTaxFor("XX", 50000)).toThrow(/not implemented for state "XX"/);
    expect(() => professionalTaxFor("KeralaX", 50000)).toThrow(/KeralaX/);
    expect(() => withStat({ pt: true, ptState: "XX" }, { basic: 50000 })).toThrow(/not implemented for state "XX"/);
    expect(PT_IMPLEMENTED_STATES).toContain("TN");
    expect(PT_IMPLEMENTED_STATES).toContain("MH");
  });

  test("ptState drives computePayroll", () => {
    const r = withStat({ pt: true, ptState: "AP" }, { basic: 30000 });
    expect(r.components.find((c) => c.componentKey === "pt")?.amount).toBe(200);
    const r2 = withStat({ pt: true, ptState: "AP" }, { basic: 12000 });
    expect(r2.components.find((c) => c.componentKey === "pt")).toBeUndefined();
  });
});

describe("PF on Code on Wages wages + 50% deeming rule", () => {
  test("no deeming: excluded (HRA + conveyance) below 50% of total", () => {
    // basic 30,000 + medical 1,250 (included) + HRA 12,000 + conveyance 1,600 (excluded)
    // total 44,850; excluded 13,600 < 22,425 -> wages = 31,250 -> capped at 15,000
    expect(pfWagesFor({
      basic: 30000, hra: 12000,
      allowances: [{ label: "Conveyance", amount: 1600 }, { label: "Medical", amount: 1250 }],
      deductions: [],
    })).toBe(31250);
  });

  test("deeming: excluded above 50% pushes wages up to half of total", () => {
    // basic 10,000 + HRA 20,000 + conveyance 10,000: total 40,000, excluded
    // 30,000 > 20,000 -> wages = 20,000 (not 10,000) -> PF 12% of capped 15,000
    expect(pfWagesFor({
      basic: 10000, hra: 20000,
      allowances: [{ label: "Conveyance", amount: 10000 }],
      deductions: [],
    })).toBe(20000);
    const r = withStat({ pf: true }, {
      basic: 10000, hra: 20000,
      allowances: [{ label: "Conveyance", amount: 10000 }],
    });
    // PF wages 20,000 capped at 15,000 -> 1,800 (basic-only would give 1,200)
    expect(r.components.find((c) => c.componentKey === "pf_employee")?.amount).toBe(1800);
  });

  test("DA / retaining / special allowances count as wages; bonus does not", () => {
    expect(pfWagesFor({
      basic: 20000, hra: 0,
      allowances: [
        { label: "Dearness Allowance", amount: 5000 },
        { label: "Retaining Allowance", amount: 2000 },
        { label: "Special Allowance", amount: 3000 },
        { label: "Bonus", amount: 9000 },
      ],
      deductions: [],
    })).toBe(30000); // 20,000 + 5,000 + 2,000 + 3,000; bonus excluded, total 39,000, excluded 9,000 < 19,500
  });

  test("PF ceiling of Rs 15,000 still applies on the wider base", () => {
    const r = withStat({ pf: true }, { basic: 60000, hra: 0, allowances: [] });
    expect(r.components.find((c) => c.componentKey === "pf_employee")?.amount).toBe(1800);
  });
});

describe("TDS old regime FY 2025-26", () => {
  test("old slabs, standard deduction Rs 50,000, 87A rebate to Rs 5L", () => {
    expect(annualTdsOnOld(500000)).toBe(0); // taxable 4,50,000 after std ded -> rebate
    expect(annualTdsOnOld(550000)).toBe(0); // taxable exactly 5,00,000 -> rebate
    // taxable 5,50,000: 12,500 + 20% of 50,000 = 22,500; +4% cess = 23,400
    expect(annualTdsOnOld(600000)).toBe(23400);
    // 12L gross, no declarations: taxable 11,50,000 -> 12,500+1,00,000+45,000=1,57,500; +cess = 1,63,800
    expect(annualTdsOnOld(1200000)).toBe(163800);
  });

  test("80C capped at Rs 1,50,000; 80D and HRA exemption applied as declared", () => {
    // 12L gross, 80C claimed 2,00,000 (capped 1,50,000), 80D 25,000, HRA 50,000:
    // taxable = 12,00,000 - 50,000 - 1,50,000 - 25,000 - 50,000 = 9,25,000
    // tax = 12,500 + 20% of 4,25,000 = 97,500; +cess = 1,01,400
    expect(annualTdsOnOld(1200000, { section80C: 200000, section80D: 25000, hraExemption: 50000 })).toBe(101400);
  });

  test("regime selection via annualTdsOn options; new regime unchanged", () => {
    expect(annualTdsOn(1200000, { regime: "old" })).toBe(163800);
    expect(annualTdsOn(1200000 + 75000)).toBe(0); // new-regime rebate path intact
    const r = withStat(
      { tds: true, tdsRegime: "old", taxDeclaration: { section80C: 150000, section80D: 25000 } },
      { basic: 80000, hra: 20000, allowances: [] },
    );
    // monthly wages 1,00,000 -> annual 12,00,000 -> taxable 9,75,000
    // tax = 12,500 + 20% of 4,75,000 = 1,07,500; +cess = 1,11,800; monthly = 9,316.67
    expect(r.components.find((c) => c.componentKey === "tds")?.amount).toBe(9316.67);
    expect(r.components.find((c) => c.componentKey === "tds")?.label).toBe("TDS (estimate)");
  });
});

describe("integer paise", () => {
  test("fractional amounts round half-up at the paise boundary, not via floats", () => {
    // Gross 33,333.33-ish via LOP: 10,000 gross, 1 lop day of 30 -> 333.33
    const r = computePayroll({
      components: { basic: 10000, hra: 0, allowances: [], deductions: [] },
      paidDays: 29, lopDays: 1, daysInMonth: 30,
      statutory: { pf: false, esi: false, pt: false, tds: false },
    });
    expect(r.components.find((c) => c.componentKey === "lop")?.amount).toBe(333.33);
    expect(r.netPay).toBe(9666.67);
  });

  test("ESI 0.75% of an odd amount lands on an exact paise", () => {
    const r = withStat({ esi: true }, { basic: 10001, hra: 0, allowances: [] });
    // 0.75% of 10,001 = 75.0075 -> 75.01 paise-rounded
    expect(r.components.find((c) => c.componentKey === "esi_employee")?.amount).toBe(75.01);
  });
});
