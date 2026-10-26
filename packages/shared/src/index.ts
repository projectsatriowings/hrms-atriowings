// @hrms/shared — single source of truth for API shapes.
// Both apps/web (client validation) and apps/api (server validation) use these.

import { z } from "zod";
export { z };

// ── Common ─────────────────────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export const roleSchema = z.enum(["employee", "hr", "md"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * A YYYY-MM-DD string that must be a REAL calendar date. The regex alone
 * accepts impossibilities like 2026-02-30 (which JS Date silently rolls into
 * March) and 2026-13-45 (an Invalid Date that crashed Prisma writes) — the
 * refine round-trips through Date and compares, rejecting both.
 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid calendar date");

// ── Auth ───────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  companyId: string;
  companyName: string;
  companyTimezone: string;
  employeeId: string | null;
  employeeName: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// ── Employees ──────────────────────────────────────────────────────────

export const postalAddressSchema = z.object({
  line: z.string().max(200).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  pin: z.string().max(10).optional(),
});
export type PostalAddress = z.infer<typeof postalAddressSchema>;

export const employeeAddressSchema = z.object({
  current: postalAddressSchema.optional(),
  permanent: postalAddressSchema.optional(),
});
export type EmployeeAddress = z.infer<typeof employeeAddressSchema>;

export const bankDetailsSchema = z.object({
  accountHolder: z.string().max(120).optional(),
  bankName: z.string().max(120).optional(),
  accountNumber: z.string().max(34).optional(),
  ifsc: z.string().max(11).optional(),
  branch: z.string().max(120).optional(),
});
export type BankDetails = z.infer<typeof bankDetailsSchema>;

export const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1).max(20),
  fullName: z.string().min(2).max(120),
  workEmail: z.string().email(),
  phone: z.string().max(20).optional(),
  joiningDate: dateString,
  departmentId: z.string().optional(),
  designationId: z.string().optional(),
  managerId: z.string().optional(),
  employmentType: z.string().default("full_time"),
  /** Statutory overrides (null = company default) + TDS deducted YTD (HR-editable). */
  pfApplicable: z.boolean().nullable().optional(),
  esiApplicable: z.boolean().nullable().optional(),
  tdsDeductedYtd: z.number().nonnegative().max(999_999_999).optional(),
  emergencyContact: z.record(z.string()).optional(),
  address: employeeAddressSchema.optional(),
  bankDetails: bankDetailsSchema.optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export const updateEmployeeSchema = createEmployeeSchema.partial();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const salaryStructureSchema = z.object({
  effectiveFrom: dateString,
  components: z.object({
    basic: z.number().nonnegative().max(10_000_000),
    hra: z.number().nonnegative().max(10_000_000),
    allowances: z.array(z.object({ label: z.string(), amount: z.number().nonnegative().max(10_000_000) })).default([]),
    deductions: z.array(z.object({ label: z.string(), amount: z.number().nonnegative().max(10_000_000) })).default([]),
    variablePay: z.number().nonnegative().max(10_000_000).optional(),
  }),
});
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;

export const importPreviewRowSchema = z.object({
  rowNumber: z.number(),
  data: z.record(z.string()),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});
export type ImportPreviewRow = z.infer<typeof importPreviewRowSchema>;

// ── Attendance ─────────────────────────────────────────────────────────

export const attendancePolicySchema = z.object({
  name: z.string().min(1),
  workStart: z.string().regex(/^\d{2}:\d{2}$/),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/),
  graceMinutes: z.number().int().min(0).max(120),
  weeklyOffs: z.array(z.number().int().min(0).max(6)),
  fullDayMinutes: z.number().int().min(60).max(1440),
  halfDayMinutes: z.number().int().min(30).max(1440),
  isDefault: z.boolean().optional(),
  officeLatitude: z.number().min(-90).max(90).nullable().optional(),
  officeLongitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusMeters: z.number().int().min(50).max(5000).optional(),
  requireLocation: z.boolean().optional(),
});
export type AttendancePolicyInput = z.infer<typeof attendancePolicySchema>;

// ── Attendance anti-fraud ──

export const checkInSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const biometricDeviceSchema = z.object({
  name: z.string().min(1).max(80),
  status: z.enum(["active", "disabled"]).optional(),
});
export type BiometricDeviceInput = z.infer<typeof biometricDeviceSchema>;

export const biometricMappingSchema = z.object({
  deviceUserId: z.string().min(1).max(80),
  employeeId: z.string().min(1),
});
export type BiometricMappingInput = z.infer<typeof biometricMappingSchema>;

export const biometricPunchSchema = z.object({
  deviceUserId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.enum(["in", "out"]),
});
export type BiometricPunchInput = z.infer<typeof biometricPunchSchema>;

// ── Work from home ──

export const wfhRequestSchema = z.object({
  date: dateString,
  reason: z.string().max(500).optional(),
});
export type WfhRequestInput = z.infer<typeof wfhRequestSchema>;

export const wfhDecideSchema = z.object({
  note: z.string().max(500).optional(),
});
export type WfhDecideInput = z.infer<typeof wfhDecideSchema>;

export const wfhDaySchema = z.object({
  date: dateString,
  note: z.string().max(200).optional(),
});
export type WfhDayInput = z.infer<typeof wfhDaySchema>;

export const correctAttendanceSchema = z.object({
  checkInAt: z.string().datetime().nullable().optional(),
  checkOutAt: z.string().datetime().nullable().optional(),
  status: z.enum(["present", "absent", "half_day", "on_leave", "weekly_off", "holiday"]).optional(),
  reason: z.string().min(3, "A reason is required for corrections"),
});
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;

// ── Leave ──────────────────────────────────────────────────────────────

export const applyLeaveSchema = z.object({
  leaveTypeId: z.string().min(1),
  fromDate: dateString,
  toDate: dateString,
  reason: z.string().min(3).max(500),
});
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const decideLeaveSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(500).optional(),
});
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;

export const leaveTypeSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1),
  defaultDays: z.number().nonnegative().max(366),
  carryForward: z.boolean().default(false),
  maxCarryDays: z.number().nonnegative().max(366).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

export const leaveAdjustmentSchema = z.object({
  leaveTypeId: z.string().min(1),
  year: z.number().int(),
  deltaDays: z.number().min(-366).max(366),
  entryType: z.enum(["allocation", "adjustment", "carry_forward"]).default("adjustment"),
  note: z.string().min(3),
});
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;

// ── Payroll ────────────────────────────────────────────────────────────

export const payrollPeriodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});
export type PayrollPeriodInput = z.infer<typeof payrollPeriodSchema>;

export const payrollAdjustmentSchema = z.object({
  payrollRecordId: z.string().min(1),
  componentKey: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().min(-999_999_999).max(999_999_999), // signed; negative reduces
  kind: z.enum(["earning", "deduction"]),
  reason: z.string().min(3),
});
export type PayrollAdjustmentInput = z.infer<typeof payrollAdjustmentSchema>;

// ── Billing ────────────────────────────────────────────────────────────

export const customerSchema = z.object({
  name: z.string().min(1),
  gstin: z.string().max(15).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  address: z.record(z.string()).optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().max(1_000_000),
  rate: z.number().nonnegative().max(100_000_000),
  taxRate: z.number().min(0).max(100).default(18),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const createInvoiceSchema = z.object({
  customerId: z.string().min(1),
  // B8: optional — when omitted the API auto-generates <prefix>/<FY>/<seq>.
  invoiceNo: z.string().min(1).optional(),
  issueDate: dateString,
  dueDate: dateString,
  items: z.array(invoiceItemSchema).min(1),
  notes: z.string().optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const invoicePaymentSchema = z.object({
  amount: z.number().positive().max(999_999_999),
  paidOn: dateString,
  method: z.string().default("bank_transfer"),
  reference: z.string().optional(),
});
export type InvoicePaymentInput = z.infer<typeof invoicePaymentSchema>;

export const createQuotationSchema = z.object({
  customerId: z.string().min(1),
  issueDate: dateString,
  validUntil: dateString,
  items: z.array(invoiceItemSchema).min(1),
  terms: z.string().max(2000).optional(),
  notes: z.string().optional(),
});
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;

export const quotationStatusSchema = z.object({
  status: z.enum(["sent", "accepted", "rejected", "expired"]),
});
export type QuotationStatusInput = z.infer<typeof quotationStatusSchema>;

// ── Admin ──────────────────────────────────────────────────────────────

export const departmentSchema = z.object({ name: z.string().min(1) });
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const designationSchema = z.object({
  title: z.string().min(1),
  level: z.number().int().min(0).max(1000).default(0),
});
export type DesignationInput = z.infer<typeof designationSchema>;

export const holidaySchema = z.object({
  date: dateString,
  name: z.string().min(1),
  type: z.string().default("public"),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: roleSchema,
  employeeId: z.string().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// ── Payroll statutory settings & adjustments (review fixes, 2026-10-21) ──
// Appended only; earlier schemas above are untouched.

/** Company-level statutory defaults, stored at Company.settings.statutory. */
export const statutorySettingsSchema = z.object({
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(true),
  ptApplicable: z.boolean().default(true),
  tdsApplicable: z.boolean().default(true),
  /** Per-state PT slabs are implemented (see payroll.calc PT table); an
   *  unimplemented state value fails payroll compute loudly instead of
   *  falling back to another state's slabs. */
  ptState: z.string().min(1).default("TN"),
});
export type StatutorySettings = z.infer<typeof statutorySettingsSchema>;

export const DEFAULT_STATUTORY_SETTINGS: StatutorySettings = {
  pfApplicable: true, esiApplicable: true, ptApplicable: true, tdsApplicable: true, ptState: "TN",
};

/** Resolve the statutory config compute() must use: company defaults,
 *  overridden per employee where the employee flag is non-null (null =
 *  "use company default"). pt/tds have no per-employee override. */
export function resolveStatutory(
  companySettings: unknown,
  employee: { pfApplicable?: boolean | null; esiApplicable?: boolean | null },
): { pf: boolean; esi: boolean; pt: boolean; tds: boolean; ptState: string } {
  const raw = (companySettings && typeof companySettings === "object"
    ? (companySettings as Record<string, unknown>).statutory : undefined) as
    | Partial<StatutorySettings> | undefined;
  const parsed = raw ? statutorySettingsSchema.partial().safeParse(raw) : null;
  const s = { ...DEFAULT_STATUTORY_SETTINGS, ...(parsed?.success ? parsed.data : {}) };
  return {
    pf: employee.pfApplicable ?? s.pfApplicable,
    esi: employee.esiApplicable ?? s.esiApplicable,
    pt: s.ptApplicable,
    tds: s.tdsApplicable,
    ptState: s.ptState,
  };
}

/** Per-employee statutory overrides + TDS already deducted this FY.
 *  Added to the employee schemas so HR can edit them from the employment
 *  section; null flags mean "use company default". */
export const employeeStatutorySchema = z.object({
  pfApplicable: z.boolean().nullable().optional(),
  esiApplicable: z.boolean().nullable().optional(),
  tdsDeductedYtd: z.number().nonnegative().max(999_999_999).optional(),
});
export type EmployeeStatutoryInput = z.infer<typeof employeeStatutorySchema>;

/** Adjustment stored in PayrollAdjustment (survives recompute). Distinct
 *  from payrollAdjustmentSchema (legacy, keyed by payrollRecordId): this one
 *  is keyed by employeeId so it can be recorded before a record exists and
 *  re-applied by compute(). */
export const payrollAdjustmentCreateSchema = z.object({
  employeeId: z.string().min(1),
  componentKey: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().min(-999_999_999).max(999_999_999),
  kind: z.enum(["earning", "deduction"]),
  note: z.string().max(500).optional(),
});
export type PayrollAdjustmentCreateInput = z.infer<typeof payrollAdjustmentCreateSchema>;

// ── Leave allocation helpers (pure; shared by API + backfill script) ──

/**
 * Pro-rated leave allocation for a joining employee.
 * monthsRemaining counts the joining month itself (join in March → 10
 * months: Mar–Dec), so allocation = defaultDays × monthsRemaining / 12.
 * ROUNDING RULE: rounded to 2 decimals (half-up via Math.round), matching
 * the LeaveLedger deltaDays Decimal(5,2) column — never more precision
 * than the column can store.
 */
export function proratedLeaveAllocation(defaultDays: number, joiningDateYmd: string): number {
  const month = Number(joiningDateYmd.slice(5, 7)); // 1–12
  const monthsRemaining = 13 - month;
  return Math.round(((defaultDays * monthsRemaining) / 12) * 100) / 100;
}

/** Group YYYY-MM-DD dates by calendar year, preserving date order. */
export function splitDatesByYear(dates: string[]): { year: number; dates: string[] }[] {
  const byYear = new Map<number, string[]>();
  for (const d of dates) {
    const year = Number(d.slice(0, 4));
    const list = byYear.get(year) ?? [];
    list.push(d);
    byYear.set(year, list);
  }
  return [...byYear.entries()].map(([year, ds]) => ({ year, dates: ds }));
}

// ── Review fixes (billing/biometric, 2026-10-21) ───────────────────────
// Billing prefixes live in Company.settings.billing:
//   { billing: { quotationPrefix: "ATQ", invoicePrefix: "ATL" } }
// (defaults shown; billing code falls back to them when unset).
export const billingSettingsSchema = z.object({
  quotationPrefix: z.string().min(1).max(10).optional(),
  invoicePrefix: z.string().min(1).max(10).optional(),
});
export type BillingSettingsInput = z.infer<typeof billingSettingsSchema>;

/**
 * Rollover amount for one employee + leave type: min(unused prior-year
 * balance, maxCarryDays when set, else unused), rounded to 2 decimals.
 * Returns 0 when the unused balance is not positive.
 */
export function rolloverCarry(unused: number, maxCarryDays: number | null | undefined): number {
  if (!(unused > 0)) return 0;
  const cap = maxCarryDays == null ? unused : maxCarryDays;
  return Math.round(Math.min(unused, cap) * 100) / 100;
}

// ── Security review fixes (2026-10-21, appended only — do not move) ─────
// Login with an optional companyCode (the company's slug): when supplied it
// must match the user's company, otherwise login returns 401. Absent = old
// behaviour. Kept separate from loginSchema so existing callers are untouched.
export const loginWithCompanySchema = loginSchema.extend({
  companyCode: z.string().min(1).optional(),
});
export type LoginWithCompanyInput = z.infer<typeof loginWithCompanySchema>;

/** Full login success: includes the forced-password-change flag. */
export interface LoginSuccessResponse {
  accessToken: string;
  user: AuthUser;
  mustChangePassword: boolean;
}

/** Step-up response when the user has MFA enabled: no tokens yet. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResultResponse = LoginSuccessResponse | MfaChallengeResponse;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** TOTP setup verification: the secret is only stored after a valid code. */
export const mfaSetupVerifySchema = z.object({
  secret: z.string().min(1),
  code: z.string().min(6).max(8),
});
export type MfaSetupVerifyInput = z.infer<typeof mfaSetupVerifySchema>;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaDisableSchema = z.object({
  password: z.string().min(1),
  code: z.string().min(6).max(8),
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;
