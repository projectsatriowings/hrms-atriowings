// Payroll calculation engine — pure functions, unit-tested.
// Indian statutory defaults below carry effective dates and MUST be verified
// by a qualified payroll professional (and against the current Finance Act)
// before any real payroll run.
//
// INTEGER PAISE: all computation inside computePayroll happens in integer
// paise (number, safely below 2^53 for any realistic salary). The only float
// step is the input boundary toPaise() (rupees -> paise, half-up) and the
// output boundary (paise / 100). There is no round2-style float math in any
// computation path, and storage stays Decimal(12,2) as before.
//
// PROFESSIONAL TAX — per-state slabs (monthly deduction, standard month).
// Implemented states (ptState value -> slabs). The company ptState setting
// drives this; any other value FAILS LOUDLY (see professionalTaxFor) —
// it never silently falls back to another state's slabs.
//   TN: kept exactly as before (legacy monthly-equivalent slabs). NOTE: TN
//     today levies PT half-yearly on half-yearly income (nil to Rs 21,000,
//     then Rs 135/315/690/1,025/1,250 per half-year); the monthly-equivalent
//     slabs below are retained unchanged so existing payrolls do not move,
//     and must be re-based to the half-yearly schedule before a TN filing
//     is made from this engine.
//   MH: Maharashtra (men's schedule; the women's exemption to Rs 25,000 is
//     NOT modelled — the engine has no gender field — so a woman earning
//     Rs 10,001-25,000 is charged the men's rate; correct via adjustment).
//   KA: Karnataka, post-1-Apr-2025 amendment (nil to Rs 25,000).
//   GJ: Gujarat graded schedule (Rs 80/150/200).
//   AP, TG: Andhra Pradesh / Telangana (Rs 150/200; TG also accepts "TS").
//   WB: West Bengal NEW slabs effective 1 Oct 2026 (nil to Rs 20,000, then
//     Rs 100/140/170/208). Pre-Oct-2026 periods used nil to Rs 10,000, then
//     Rs 110/130/150/200 — do not re-run old periods on the new table.
//   OD: Odisha monthly-equivalent of the annual schedule. CONFLICTING
//     SOURCES: one FY 2026-27 guide claims Odisha abolished PT from
//     1 Apr 2026, and the top slab is variously Rs 200 (Rs 300 last month)
//     or Rs 208. Verify against the Odisha CT & GST portal before use; if
//     abolished, set ptApplicable=false instead of relying on this table.
//   AS: Assam (Rs 150/180/208).
//   MP: Madhya Pradesh monthly-equivalent of the annual schedule
//     (Rs 125/167/208).
//   CG: Chhattisgarh, amended schedule (annual nil to Rs 1,00,000, then
//     Rs 130/150/200/208 a month). Older schedules with Rs 30-200 bands on
//     Rs 40,000-3,00,000 annual income are superseded — verify before use.
//   JH: Jharkhand annual schedule spread over 12 months
//     (Rs 1,200/1,800/2,100/2,500 a year).
//   BR: Bihar annual schedule spread over 12 months
//     (Rs 1,000/2,000/2,500 a year). Accepts "BH" as an alias.
//   ML: Meghalaya 12-band monthly schedule (Rs 16.50-208). An alternative
//     simplified schedule (nil to Rs 5,000, Rs 35/75/125/175/208) circulates;
//     the 12-band schedule is used here — verify before use.
//   SK: Sikkim (Rs 125/150/200).
//   TR: Tripura (Rs 150/208). A 2026-27 variant (Rs 56/112/125, max
//     Rs 1,500/yr) circulates and conflicts — verify before use.
//   MZ: Mizoram (Rs 75/120/150/180/208). Band boundaries are the least
//     well-attested in this table — verify before use.
//   KL: Kerala half-yearly schedule spread over 6 months
//     (Rs 320/450/600/750/1,000/1,250 per half-year).
// NOT modelled anywhere: February / last-month top-ups (MH/KA Rs 300 in
// February, MP/OD Rs 212 in the last month, CG Rs 212) — this engine is
// month-agnostic, so a standard month is always charged and the annual
// total lands Rs 100 short of the Rs 2,500 ceiling in those states. Post
// the top-up as a payroll adjustment in February / the last month.
// States with NO professional tax on salary (Delhi, Uttar Pradesh, Haryana,
// Rajasthan, Uttarakhand, Himachal Pradesh, J&K, Ladakh, Goa, Arunachal
// Pradesh, Chandigarh, Andaman & Nicobar, Lakshadweep, Dadra & Nagar
// Haveli and Daman & Diu) return 0 — that is a positive fact about the
// state, not a fallback. Every other value throws.
// Sources consulted (Oct 2026): state PT Acts / commercial-tax portals as
// summarised by ERP/payroll references — Maharashtra PTRC schedule,
// Karnataka Tax on Professions (Amendment) Act 2025, Gujarat State Tax on
// Professions Act 1976 schedule, AP/Telangana Tax on Professions Act 1987
// schedule, WB Finance Act 2026 notification (Oct 2026 slabs), Orissa
// Professions Tax Act schedule, Assam Commissionerate of Taxes schedule,
// MP Vritti Kar Adhiniyam 1995, Chhattisgarh Professions Tax Act 1995
// (amended), Jharkhand/Bihar Tax on Professions Acts 2011, Meghalaya /
// Sikkim / Tripura / Mizoram / Kerala schedules. A payroll professional
// must re-verify each table against the current state notification
// before a real run — secondary summaries disagree on several states
// (see the per-state notes above).
//
// PF — Code on Wages, 2019 s.2(y) "wages" definition with the 50% deeming
// rule (replaces the old basic-only base). Wages = basic + DA + retaining
// allowance + all other remuneration EXCEPT the excluded components below.
// Excluded (mapped to this codebase's components): the HRA field, and any
// allowance whose label matches HRA / house rent / conveyance / travel /
// LTA / bonus. Everything else (DA, retaining, special, medical and other
// allowances, variable pay) counts as wages. Deeming: if excluded
// components exceed 50% of total remuneration, the excess over 50% counts
// as wages, i.e. wages = max(included, total / 2). The Rs 15,000 monthly
// PF wage ceiling is kept.
// Caveat: whether a specific allowance is truly "excluded" (e.g. uniform
// or special-expense allowances) depends on its actual terms; the label
// heuristic above is a documented approximation, not a legal opinion.
//
// TDS — FY 2025-26. New regime (default): slabs 0-4L nil, 4-8L 5%,
// 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, >24L 30%; standard
// deduction Rs 75,000; 87A rebate to nil tax up to Rs 12L taxable income
// with marginal relief; 4% cess. Old regime: slabs 0-2.5L nil, 2.5-5L 5%,
// 5-10L 20%, >10L 30%; standard deduction Rs 50,000; 80C capped at
// Rs 1,50,000; 80D and HRA exemption taken as declared (HR must verify
// the 80D limits); 87A rebate to nil tax up to Rs 5L taxable income
// (slab tax at Rs 5L is exactly Rs 12,500, so no marginal-relief step is
// needed); 4% cess. PT as a section 16(iii) deduction under the old
// regime is NOT modelled. TDS is always labelled "TDS (estimate)".

export interface SalaryComponents {
  basic: number;
  hra: number;
  allowances: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  variablePay?: number;
}

export type TaxRegime = "new" | "old";

/** Structured annual investment/exemption declarations (old regime only). */
export interface TaxDeclaration {
  /** Claimed u/s 80C; capped at Rs 1,50,000 by the engine. */
  section80C?: number;
  /** Claimed u/s 80D; taken as declared — HR must verify the limits. */
  section80D?: number;
  /** HRA exemption claimed (annual). */
  hraExemption?: number;
}

export interface StatutoryConfig {
  pf: boolean; // Provident Fund
  esi: boolean; // Employee State Insurance
  pt: boolean; // Professional Tax (state slabs)
  tds: boolean; // Tax Deducted at Source
  ptState?: string; // default "TN"
  /** TDS regime; default "new". Resolved by the service from the employee
   *  record, then the employee's tax declaration, then the company default. */
  tdsRegime?: TaxRegime;
  /** Old-regime declarations; ignored under the new regime. */
  taxDeclaration?: TaxDeclaration;
}

export interface PayrollInput {
  components: SalaryComponents;
  paidDays: number;
  lopDays: number;
  daysInMonth: number;
  statutory: StatutoryConfig;
  /** TDS already deducted earlier in the financial year (for annual projection). */
  tdsDeductedYtd?: number;
}

export interface ComputedComponent {
  componentKey: string;
  label: string;
  amount: number;
  kind: "earning" | "deduction" | "employer";
}

export interface PayrollComputation {
  components: ComputedComponent[];
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number; // gross + employer PF/ESI (informational)
}

// ── Integer-paise helpers (all computation is in integer paise) ─────────

/** Rupees -> paise, half-up. Input-boundary conversion only. */
const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** Paise -> rupees for output (paise / 100 is exact for these magnitudes). */
const toRupees = (paise: number): number => paise / 100;

/**
 * Round num/den to the nearest integer, halves up, using exact integer
 * arithmetic (both args must be non-negative integers).
 */
function roundDiv(num: number, den: number): number {
  const q = Math.floor(num / den);
  const r = num - q * den;
  return 2 * r >= den ? q + 1 : q;
}

/** Round paise * pctNum / pctDen to integer paise, halves up. */
const pctPaise = (paise: number, pctNum: number, pctDen = 100): number =>
  roundDiv(paise * pctNum, pctDen);

/**
 * Pro-rate paise by a fractional day ratio (paidDays or lopDays, each
 * recorded to 2 decimals) over daysInMonth, exactly in integers.
 */
function proratePaise(paise: number, days: number, daysInMonth: number): number {
  if (daysInMonth <= 0 || days <= 0) return 0;
  const scaledDays = Math.round(days * 100);
  return roundDiv(paise * scaledDays, daysInMonth * 100);
}

// ── Professional Tax ───────────────────────────────────────────────────

type PtTable = [limitPaise: number, amountPaise: number][];

/** Monthly tables: [wages upper limit (paise), monthly PT (paise)]. */
const PT_MONTHLY: Record<string, PtTable> = {
  // TN: legacy monthly-equivalent slabs, kept exactly as before.
  TN: [[350000, 0], [500000, 2250], [750000, 5250], [1000000, 11500], [1250000, 17100], [Infinity, 20800]],
  MH: [[750000, 0], [1000000, 17500], [Infinity, 20000]],
  KA: [[2500000, 0], [Infinity, 20000]],
  GJ: [[599900, 0], [899900, 8000], [1199900, 15000], [Infinity, 20000]],
  AP: [[1500000, 0], [2000000, 15000], [Infinity, 20000]],
  TG: [[1500000, 0], [2000000, 15000], [Infinity, 20000]],
  // WB: new slabs effective 1 Oct 2026 (see header note).
  WB: [[2000000, 0], [3000000, 10000], [5000000, 14000], [10000000, 17000], [Infinity, 20800]],
  OD: [[1330400, 0], [2500000, 12500], [4166600, 16700], [Infinity, 20800]],
  AS: [[1000000, 0], [1500000, 15000], [2500000, 18000], [Infinity, 20800]],
  MP: [[1875000, 0], [2500000, 12500], [3333300, 16700], [Infinity, 20800]],
  // CG: amended schedule, monthly equivalents of the annual bands.
  CG: [[833300, 0], [1250000, 13000], [1666600, 15000], [2083300, 20000], [Infinity, 20800]],
  ML: [[416600, 0], [625000, 1650], [833300, 2500], [1250000, 4150], [1666600, 6250], [2083300, 8333], [2500000, 10416], [2916600, 12500], [3333300, 15000], [3750000, 17500], [4166600, 20000], [Infinity, 20800]],
  SK: [[2000000, 0], [3000000, 12500], [4000000, 15000], [Infinity, 20000]],
  TR: [[750000, 0], [1500000, 15000], [Infinity, 20800]],
  MZ: [[500000, 0], [750000, 7500], [1000000, 12000], [1250000, 15000], [1500000, 18000], [Infinity, 20800]],
};

/** Annual tables: [annual wages upper limit (paise), annual PT (paise)].
 *  The monthly deduction is annual PT / 12, rounded to the paise. */
const PT_ANNUAL: Record<string, PtTable> = {
  JH: [[30000000, 0], [50000000, 120000], [80000000, 180000], [100000000, 210000], [Infinity, 250000]],
  BR: [[30000000, 0], [50000000, 100000], [100000000, 200000], [Infinity, 250000]],
};

/** Half-yearly tables: [half-year wages upper limit, half-year PT]. */
const PT_HALF_YEARLY: Record<string, PtTable> = {
  KL: [[1199900, 0], [1799900, 32000], [2999900, 45000], [4499900, 60000], [9999900, 75000], [12499900, 100000], [Infinity, 125000]],
};

const PT_ALIASES: Record<string, string> = {
  "TAMIL NADU": "TN", "MAHARASHTRA": "MH", "KARNATAKA": "KA", "GUJARAT": "GJ",
  "ANDHRA PRADESH": "AP", "TELANGANA": "TG", "TS": "TG", "WEST BENGAL": "WB",
  "ODISHA": "OD", "ORISSA": "OD", "OR": "OD", "ASSAM": "AS", "MADHYA PRADESH": "MP",
  "CHHATTISGARH": "CG", "JHARKHAND": "JH", "BIHAR": "BR", "BH": "BR",
  "MEGHALAYA": "ML", "SIKKIM": "SK", "TRIPURA": "TR", "MIZORAM": "MZ", "KERALA": "KL",
};

/** States with no professional tax on salary: PT is genuinely 0, not a fallback. */
const PT_NO_TAX: Record<string, string> = {
  DL: "Delhi", UP: "Uttar Pradesh", HR: "Haryana", RJ: "Rajasthan",
  UT: "Uttarakhand", HP: "Himachal Pradesh", JK: "Jammu & Kashmir",
  LA: "Ladakh", GA: "Goa", AR: "Arunachal Pradesh", CH: "Chandigarh",
  AN: "Andaman & Nicobar", LD: "Lakshadweep", DN: "Dadra & Nagar Haveli and Daman & Diu",
};

const PT_NO_TAX_ALIASES: Record<string, string> = {
  "DELHI": "DL", "UTTAR PRADESH": "UP", "HARYANA": "HR", "RAJASTHAN": "RJ",
  "UTTARAKHAND": "UT", "HIMACHAL PRADESH": "HP", "JAMMU & KASHMIR": "JK",
  "JAMMU AND KASHMIR": "JK", "LADAKH": "LA", "GOA": "GA", "ARUNACHAL PRADESH": "AR",
  "CHANDIGARH": "CH", "ANDAMAN & NICOBAR": "AN", "LAKSHADWEEP": "LD",
  "DADRA & NAGAR HAVELI AND DAMAN & DIU": "DN",
};

/** States with an implemented PT table (codes). */
export const PT_IMPLEMENTED_STATES: string[] = [
  ...Object.keys(PT_MONTHLY), ...Object.keys(PT_ANNUAL), ...Object.keys(PT_HALF_YEARLY),
].sort();

/** States known to levy no PT on salary (codes). */
export const PT_NO_TAX_STATES: string[] = Object.keys(PT_NO_TAX).sort();

function lookupSlab(table: PtTable, wagesPaise: number): number {
  for (const [limit, amount] of table) {
    if (wagesPaise <= limit) return amount;
  }
  return 0; // unreachable: every table ends with Infinity
}

/**
 * Monthly professional tax in paise for a state code/name and monthly
 * wages in paise. THROWS for any state with no implemented table and no
 * known no-PT status — an unknown/mistyped state must never silently
 * reuse another state's slabs or silently charge 0.
 */
export function professionalTaxPaiseFor(state: string | undefined, wagesPaise: number): number {
  const raw = (state ?? "").trim();
  if (raw === "") return lookupSlab(PT_MONTHLY.TN, wagesPaise); // default TN
  const key = raw.toUpperCase().replace(/\s+/g, " ");
  const code = PT_ALIASES[key] ?? key.replace(/\s+/g, "");
  if (PT_MONTHLY[code]) return lookupSlab(PT_MONTHLY[code], wagesPaise);
  if (PT_ANNUAL[code]) return roundDiv(lookupSlab(PT_ANNUAL[code], wagesPaise * 12), 12);
  if (PT_HALF_YEARLY[code]) return roundDiv(lookupSlab(PT_HALF_YEARLY[code], wagesPaise * 6), 6);
  const noTaxCode = PT_NO_TAX_ALIASES[key] ?? code;
  if (PT_NO_TAX[noTaxCode]) return 0;
  throw new Error(
    `Professional Tax slabs are not implemented for state "${raw}" ` +
    `(normalised to "${code}"). Implemented states: ${PT_IMPLEMENTED_STATES.join(", ")}. ` +
    `Set ptState to an implemented state, or set ptApplicable=false if this state levies no professional tax.`,
  );
}

/** Monthly professional tax in rupees (convenience wrapper for tests/callers). */
export function professionalTaxFor(state: string | undefined, monthlyWagesRupees: number): number {
  return toRupees(professionalTaxPaiseFor(state, toPaise(monthlyWagesRupees)));
}

// ── PF on Code on Wages wages ───────────────────────────────────────────

/**
 * Allowance labels treated as EXCLUDED from Code on Wages "wages"
 * (HRA, house-accommodation value, travelling/conveyance allowance,
 * LTA/travelling concession, bonus). Everything else counts as wages.
 */
const PF_EXCLUDED_LABEL = /(hra|house\s*rent|conveyance|travell|lta|leave\s*travel|bonus)/i;

/**
 * Monthly PF wages in paise under Code on Wages s.2(y) + 50% deeming rule.
 * Included = basic + non-excluded allowances + variable pay; excluded =
 * HRA + excluded allowances. If excluded > 50% of total remuneration,
 * wages = total / 2 (the excess over 50% is deemed wages); otherwise
 * wages = included. Equivalently wages = max(included, total / 2).
 */
export function pfWagesPaiseFor(components: SalaryComponents): number {
  const basicPaise = toPaise(components.basic);
  const hraPaise = toPaise(components.hra);
  let included = basicPaise + toPaise(components.variablePay ?? 0);
  let excluded = hraPaise;
  for (const a of components.allowances) {
    const p = toPaise(a.amount);
    if (PF_EXCLUDED_LABEL.test(a.label)) excluded += p;
    else included += p;
  }
  const total = included + excluded;
  if (total <= 0) return 0;
  return Math.max(included, roundDiv(total, 2));
}

/** Monthly PF wages in rupees (convenience wrapper). */
export function pfWagesFor(components: SalaryComponents): number {
  return toRupees(pfWagesPaiseFor(components));
}

/** PF: 12% employee + 12% employer on PF wages, wage ceiling Rs 15,000. */
function pfOn(pfWagesPaidPaise: number): { employee: number; employer: number } {
  const wages = Math.min(pfWagesPaidPaise, 1500000);
  return { employee: pctPaise(wages, 12), employer: pctPaise(wages, 12) };
}

/** ESI: 0.75% employee + 3.25% employer, applies when monthly wages ≤ Rs 21,000. */
function esiOn(wagesPaidPaise: number): { employee: number; employer: number } | null {
  if (wagesPaidPaise > 2100000 || wagesPaidPaise <= 0) return null;
  return { employee: pctPaise(wagesPaidPaise, 75, 10000), employer: pctPaise(wagesPaidPaise, 325, 10000) };
}

// ── TDS ──────────────────────────────────────────────────────────────────

type Slab = [limitPaise: number, ratePct: number][];

const TDS_SLABS_NEW: Slab = [
  [40000000, 0], [80000000, 5], [120000000, 10], [160000000, 15],
  [200000000, 20], [240000000, 25], [Infinity, 30],
];

const TDS_SLABS_OLD: Slab = [
  [25000000, 0], [50000000, 5], [100000000, 20], [Infinity, 30],
];

/** Slab tax in paise from a taxable amount in paise (single rounding). */
function slabTaxPaise(taxablePaise: number, slabs: Slab): number {
  let taxNum = 0; // sum of (band paise * rate), denominator 100
  let prev = 0;
  for (const [limit, rate] of slabs) {
    if (taxablePaise <= prev) break;
    taxNum += (Math.min(taxablePaise, limit) - prev) * rate;
    prev = limit;
  }
  return roundDiv(taxNum, 100);
}

function withCess(taxPaise: number): number {
  return roundDiv(taxPaise * 104, 100); // +4% health & education cess
}

/** New-regime annual TDS in paise. */
function annualTdsNewPaise(annualGrossPaise: number): number {
  const taxable = Math.max(0, annualGrossPaise - 7500000);
  if (taxable <= 120000000) return 0; // rebate u/s 87A
  // Marginal relief: tax cannot exceed income above Rs 12L
  const tax = Math.min(slabTaxPaise(taxable, TDS_SLABS_NEW), taxable - 120000000);
  return withCess(tax);
}

/** Old-regime annual TDS in paise (FY 2025-26). */
function annualTdsOldPaise(annualGrossPaise: number, decl: TaxDeclaration = {}): number {
  const section80C = Math.min(Math.max(0, toPaise(decl.section80C ?? 0)), 15000000);
  const section80D = Math.max(0, toPaise(decl.section80D ?? 0));
  const hraExemption = Math.max(0, toPaise(decl.hraExemption ?? 0));
  const taxable = Math.max(0, annualGrossPaise - 5000000 - section80C - section80D - hraExemption);
  if (taxable <= 50000000) return 0; // rebate u/s 87A (slab tax at 5L = Rs 12,500)
  return withCess(slabTaxPaise(taxable, TDS_SLABS_OLD));
}

export interface AnnualTdsOptions {
  regime?: TaxRegime;
  declaration?: TaxDeclaration;
}

/**
 * Annual TDS in rupees. No options = new regime (backwards compatible).
 * Old regime honours the structured declarations in `options.declaration`.
 */
export function annualTdsOn(annualGross: number, options: AnnualTdsOptions = {}): number {
  const grossPaise = toPaise(annualGross);
  const taxPaise = options.regime === "old"
    ? annualTdsOldPaise(grossPaise, options.declaration)
    : annualTdsNewPaise(grossPaise);
  return toRupees(taxPaise);
}

/** Old-regime annual TDS in rupees (direct entry point for tests/callers). */
export function annualTdsOnOld(annualGross: number, declaration: TaxDeclaration = {}): number {
  return toRupees(annualTdsOldPaise(toPaise(annualGross), declaration));
}

// ── Main computation (integer paise throughout) ──────────────────────────

export function computePayroll(input: PayrollInput): PayrollComputation {
  const { components, paidDays, lopDays, daysInMonth, statutory } = input;
  const c: ComputedComponent[] = [];
  const push = (componentKey: string, label: string, amountPaise: number, kind: ComputedComponent["kind"]) => {
    c.push({ componentKey, label, amount: toRupees(amountPaise), kind });
  };

  const allowancePaise = components.allowances.map((a) => ({ label: a.label, paise: toPaise(a.amount) }));
  const variablePaise = toPaise(components.variablePay ?? 0);
  const basicPaise = toPaise(components.basic);
  const hraPaise = toPaise(components.hra);
  const grossPaise = basicPaise + hraPaise + allowancePaise.reduce((s, a) => s + a.paise, 0) + variablePaise;

  // Earnings at full month value (LOP handled as an explicit deduction line)
  push("basic", "Basic Salary", basicPaise, "earning");
  push("hra", "House Rent Allowance", hraPaise, "earning");
  for (const a of allowancePaise) push(`allowance:${a.label}`, a.label, a.paise, "earning");
  if (variablePaise > 0) push("variable_pay", "Variable Pay", variablePaise, "earning");

  // Loss of pay: per-day = gross / days in month
  const lopPaise = proratePaise(grossPaise, lopDays, daysInMonth);
  if (lopPaise > 0) push("lop", `Loss of Pay (${lopDays}d)`, lopPaise, "deduction");

  const wagesPaidPaise = grossPaise - lopPaise; // actual payable wages drive ESI/PT/TDS

  let employerExtraPaise = 0;

  if (statutory.pf) {
    // Code on Wages wages, pro-rated by paid days, Rs 15,000 ceiling.
    const pfWagesPaidPaise = proratePaise(pfWagesPaiseFor(components), paidDays, daysInMonth);
    const pf = pfOn(pfWagesPaidPaise);
    if (pf.employee > 0) push("pf_employee", "Provident Fund (Employee)", pf.employee, "deduction");
    if (pf.employer > 0) {
      push("pf_employer", "Provident Fund (Employer)", pf.employer, "employer");
      employerExtraPaise += pf.employer;
    }
  }
  if (statutory.esi) {
    const esi = esiOn(wagesPaidPaise);
    if (esi) {
      push("esi_employee", "ESI (Employee)", esi.employee, "deduction");
      push("esi_employer", "ESI (Employer)", esi.employer, "employer");
      employerExtraPaise += esi.employer;
    }
  }
  if (statutory.pt) {
    // Throws for an unimplemented ptState — fail loudly, never fall back.
    const ptPaise = professionalTaxPaiseFor(statutory.ptState ?? "TN", wagesPaidPaise);
    if (ptPaise > 0) push("pt", "Professional Tax", ptPaise, "deduction");
  }
  if (statutory.tds) {
    const annualPaise = wagesPaidPaise * 12;
    const annualTaxPaise = statutory.tdsRegime === "old"
      ? annualTdsOldPaise(annualPaise, statutory.taxDeclaration)
      : annualTdsNewPaise(annualPaise);
    const monthlyPaise = roundDiv(Math.max(0, annualTaxPaise - toPaise(input.tdsDeductedYtd ?? 0)), 12);
    // Labelled an estimate: the calc annualises this month's wages and nets
    // off tdsDeductedYtd, but bonuses/arrears/declarations beyond the
    // structured old-regime fields are not modelled — verify before filing.
    if (monthlyPaise > 0) push("tds", "TDS (estimate)", monthlyPaise, "deduction");
  }

  for (const d of components.deductions) {
    push(`deduction:${d.label}`, d.label, toPaise(d.amount), "deduction");
  }

  const totalDeductionsPaise = c.filter((x) => x.kind === "deduction").reduce((s, x) => s + toPaise(x.amount), 0);
  const netPayPaise = grossPaise - totalDeductionsPaise;

  return {
    components: c,
    gross: toRupees(grossPaise),
    totalDeductions: toRupees(totalDeductionsPaise),
    netPay: toRupees(netPayPaise),
    employerCost: toRupees(grossPaise + employerExtraPaise),
  };
}
