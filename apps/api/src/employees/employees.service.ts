import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { decryptBankDetails, encryptBankDetails, isEncryptedBankDetails } from "../common/bank-crypto";
import { AuthService } from "../auth/auth.service";
import { dateOnly, pageParams, pageResult, toCsv, ymdOf } from "../common/utils";
import type { CreateEmployeeInput, ImportPreviewRow, SalaryStructureInput, UpdateEmployeeInput } from "@hrms/shared";
import { proratedLeaveAllocation } from "@hrms/shared";
import { RequestUser } from "../common/decorators";
import { randomBytes } from "crypto";

const employeeSelect = {
  id: true, employeeCode: true, fullName: true, workEmail: true, phone: true,
  joiningDate: true, employmentStatus: true, employmentType: true, dateOfExit: true,
  pfApplicable: true, esiApplicable: true, tdsDeductedYtd: true,
  address: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true } },
  manager: { select: { id: true, fullName: true, employeeCode: true } },
};

/** Row-level visibility: hr/md see all; employees see self. */
function visibilityWhere(user: RequestUser) {
  if (user.role === "hr" || user.role === "md") return {};
  return { id: user.employeeId ?? "__none__" };
}

/**
 * Bank details are sensitive: they are only ever returned by the detail
 * endpoint, and only to hr/md or the employee themself. `employeeSelect`
 * deliberately excludes `bankDetails`, so list/create/update responses
 * never contain it.
 */
function canViewBankDetails(user: RequestUser, employeeId: string) {
  return user.role === "hr" || user.role === "md" || user.employeeId === employeeId;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Temporary password for auto-created logins: 12 chars, mixed case + digits, no ambiguous chars (0/O/1/l/I). */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(digits), pick(digits)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private auth: AuthService) {}

  async list(user: RequestUser, q: { page?: number; pageSize?: number; search?: string; departmentId?: string; status?: string }) {
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    const where: Record<string, unknown> = {
      companyId: user.companyId,
      ...visibilityWhere(user),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.status ? { employmentStatus: q.status } : {}),
      ...(q.search
        ? { OR: [
            { fullName: { contains: q.search, mode: "insensitive" } },
            { employeeCode: { contains: q.search, mode: "insensitive" } },
            { workEmail: { contains: q.search, mode: "insensitive" } },
          ] }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({ where, select: employeeSelect, orderBy: { fullName: "asc" }, skip, take }),
      this.prisma.employee.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }

  private async assertRefs(companyId: string, input: { departmentId?: string; designationId?: string; managerId?: string }, selfId?: string) {
    if (input.departmentId) {
      const d = await this.prisma.department.findFirst({ where: { id: input.departmentId, companyId } });
      if (!d) throw new BadRequestException({ code: "invalid_department", message: "Department not found" });
    }
    if (input.designationId) {
      const d = await this.prisma.designation.findFirst({ where: { id: input.designationId, companyId } });
      if (!d) throw new BadRequestException({ code: "invalid_designation", message: "Designation not found" });
    }
    if (input.managerId) {
      if (input.managerId === selfId) throw new BadRequestException({ code: "invalid_manager", message: "An employee cannot report to themselves" });
      const m = await this.prisma.employee.findFirst({ where: { id: input.managerId, companyId } });
      if (!m) throw new BadRequestException({ code: "invalid_manager", message: "Reporting manager not found" });
    }
  }

  async create(user: RequestUser, input: CreateEmployeeInput) {
    await this.assertRefs(user.companyId, input);
    const email = input.workEmail.toLowerCase().trim();
    const dup = await this.prisma.employee.findFirst({
      where: { companyId: user.companyId, OR: [{ employeeCode: input.employeeCode }, { workEmail: email }] },
    });
    if (dup) throw new ConflictException({ code: "duplicate_employee", message: "Employee code or email already exists" });

    const created = await this.prisma.employee.create({
      data: {
        companyId: user.companyId,
        employeeCode: input.employeeCode.trim(),
        fullName: input.fullName.trim(),
        workEmail: email,
        phone: input.phone,
        joiningDate: dateOnly(input.joiningDate),
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        managerId: input.managerId ?? null,
        employmentType: input.employmentType,
        pfApplicable: input.pfApplicable ?? undefined,
        esiApplicable: input.esiApplicable ?? undefined,
        tdsDeductedYtd: input.tdsDeductedYtd ?? undefined,
        emergencyContact: input.emergencyContact ?? undefined,
        address: input.address ?? undefined,
        bankDetails: input.bankDetails ?? undefined,
      },
      select: employeeSelect,
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.created", entityType: "employee", entityId: created.id, after: created });

    // Leave allocations on joining: one pro-rated allocation entry per
    // ACTIVE leave type with defaultDays > 0, for the joining year
    // (allocation = defaultDays × months remaining incl. joining month / 12,
    // rounded to 2 decimals — see proratedLeaveAllocation). Previously
    // allocations existed only via seed, so new employees had zero leave.
    // Idempotent guard included so a retry never duplicates an entry.
    // (Canonical helper lives in LeaveService.createAllocationsForEmployee;
    // this inline copy exists because EmployeesModule does not import
    // LeaveModule — keep the two in sync.)
    {
      const joiningYear = Number(input.joiningDate.slice(0, 4));
      const types = await this.prisma.leaveType.findMany({ where: { companyId: user.companyId, isActive: true } });
      for (const t of types) {
        const defaultDays = Number(t.defaultDays);
        if (!(defaultDays > 0)) continue;
        const existing = await this.prisma.leaveLedger.findFirst({
          where: { companyId: user.companyId, employeeId: created.id, leaveTypeId: t.id, year: joiningYear, entryType: "allocation" },
        });
        if (existing) continue;
        const deltaDays = proratedLeaveAllocation(defaultDays, input.joiningDate);
        if (!(deltaDays > 0)) continue;
        await this.prisma.leaveLedger.create({
          data: {
            companyId: user.companyId, employeeId: created.id, leaveTypeId: t.id, year: joiningYear,
            deltaDays, entryType: "allocation",
            note: `Joining-year allocation (pro-rated, joined ${input.joiningDate})`,
            createdById: user.userId,
          },
        });
      }
    }

    // Auto-create a login so the employee can sign in right away. The temporary
    // password is returned ONCE in this response — only its hash is stored.
    let login: { email: string; temporaryPassword: string } | null = null;
    if (created.workEmail) {
      const existingUser = await this.prisma.user.findFirst({ where: { companyId: user.companyId, email: created.workEmail } });
      if (!existingUser) {
        const temporaryPassword = generateTempPassword();
        const loginUser = await this.prisma.user.create({
          data: {
            companyId: user.companyId,
            email: created.workEmail,
            passwordHash: await this.auth.hashPassword(temporaryPassword),
            role: "employee",
            status: "active",
            employeeId: created.id,
            // Temporary login: must change on first sign-in; expires in 7 days.
            mustChangePassword: true,
            tempPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
          select: { id: true },
        });
        await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "user.created", entityType: "user", entityId: loginUser.id, after: { email: created.workEmail, role: "employee" } });
        login = { email: created.workEmail, temporaryPassword };
      }
    }
    return { ...created, login };
  }

  /** Enforce row-level visibility before fetching a single employee. */
  private async assertVisible(user: RequestUser, id: string) {
    if (user.role === "hr" || user.role === "md") return;
    if (id !== user.employeeId) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
  }

  async get(user: RequestUser, id: string) {
    await this.assertVisible(user, id);
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        ...employeeSelect, emergencyContact: true, createdAt: true, bankDetails: true,
        user: { select: { id: true, email: true, role: true, status: true } },
      },
    });
    if (!employee) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    // assertVisible already limits this endpoint to hr/md and the employee
    // themself; enforce the bank-details rule explicitly as well so the
    // field stays protected if visibility rules ever widen.
    if (!canViewBankDetails(user, id)) {
      employee.bankDetails = null;
    } else if (employee.bankDetails !== null && employee.bankDetails !== undefined) {
      if (isEncryptedBankDetails(employee.bankDetails)) {
        // AES-256-GCM at rest; decrypt only for authorised readers.
        employee.bankDetails = decryptBankDetails(employee.bankDetails) as typeof employee.bankDetails;
      } else {
        // Legacy plaintext row: return the value as-is, but encrypt it on
        // read-back so the next read finds ciphertext at rest.
        const plain = employee.bankDetails;
        try {
          await this.prisma.employee.update({ where: { id }, data: { bankDetails: encryptBankDetails(plain) } });
        } catch {
          /* read-back encryption is best-effort; the read itself succeeds */
        }
      }
    }

    const [salaryStructures, recentAttendance, leaveBalances] = await Promise.all([
      this.prisma.salaryStructure.findMany({ where: { employeeId: id }, orderBy: { effectiveFrom: "desc" } }),
      this.prisma.attendanceRecord.findMany({ where: { employeeId: id }, orderBy: { workDate: "desc" }, take: 31 }),
      this.prisma.leaveLedger.groupBy({
        where: { employeeId: id },
        by: ["leaveTypeId", "year"],
        _sum: { deltaDays: true },
      }),
    ]);
    const leaveTypes = await this.prisma.leaveType.findMany({ where: { companyId: user.companyId, isActive: true } });
    const balances = leaveBalances.map((b) => {
      const lt = leaveTypes.find((t) => t.id === b.leaveTypeId);
      return { leaveTypeId: b.leaveTypeId, leaveTypeName: lt?.name ?? "?", year: b.year, balance: Number(b._sum.deltaDays ?? 0) };
    });
    // B5d: log views of sensitive data at the detail-endpoint level. Only
    // hr/md views are logged (self-views are the employee's own data).
    // Payloads carry ids only — never bank details or salary amounts.
    if (user.role === "hr" || user.role === "md") {
      await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.bank_viewed", entityType: "employee", entityId: id });
      await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.salary_viewed", entityType: "employee", entityId: id });
    }
    return { employee, salaryStructures, recentAttendance, leaveBalances: balances };
  }

  async update(user: RequestUser, id: string, input: UpdateEmployeeInput) {
    const existing = await this.prisma.employee.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    await this.assertRefs(user.companyId, input, id);

    const data: Record<string, unknown> = {};
    if (input.employeeCode !== undefined) {
      const dup = await this.prisma.employee.findFirst({ where: { companyId: user.companyId, employeeCode: input.employeeCode, NOT: { id } } });
      if (dup) throw new ConflictException({ code: "duplicate_code", message: "Employee code already exists" });
      data.employeeCode = input.employeeCode.trim();
    }
    if (input.workEmail !== undefined) {
      const email = input.workEmail.toLowerCase().trim();
      const dup = await this.prisma.employee.findFirst({ where: { companyId: user.companyId, workEmail: email, NOT: { id } } });
      if (dup) throw new ConflictException({ code: "duplicate_email", message: "Email already exists" });
      data.workEmail = email;
    }
    for (const k of ["fullName", "phone", "departmentId", "designationId", "managerId", "employmentType", "emergencyContact"] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.joiningDate !== undefined) data.joiningDate = dateOnly(input.joiningDate);
    // Statutory overrides (null = company default) + TDS deducted YTD, HR-editable.
    if (input.pfApplicable !== undefined) data.pfApplicable = input.pfApplicable;
    if (input.esiApplicable !== undefined) data.esiApplicable = input.esiApplicable;
    if (input.tdsDeductedYtd !== undefined) data.tdsDeductedYtd = input.tdsDeductedYtd;
    if (input.address !== undefined) data.address = input.address;
    // Bank details are encrypted at rest (AES-256-GCM); never stored plaintext.
    if (input.bankDetails !== undefined) data.bankDetails = encryptBankDetails(input.bankDetails);

    const updated = await this.prisma.employee.update({ where: { id }, data, select: employeeSelect });
    // A17: a workEmail change syncs the linked login's email (same company).
    // The employee-level uniqueness check above already ran; a colliding
    // login email belonging to a *different* user is a real conflict.
    if (input.workEmail !== undefined && updated.workEmail !== existing.workEmail) {
      const linked = await this.prisma.user.findFirst({ where: { companyId: user.companyId, employeeId: id } });
      if (linked) {
        const clash = await this.prisma.user.findFirst({
          where: { companyId: user.companyId, email: updated.workEmail, NOT: { id: linked.id } },
        });
        if (clash) throw new ConflictException({ code: "duplicate_email", message: "A login already uses this email" });
        await this.prisma.user.update({ where: { id: linked.id }, data: { email: updated.workEmail } });
      }
    }
    // B5b: record a real before/after field diff (not just employeeCode).
    // Bank-details values are never written to the audit log — only a marker
    // that they changed.
    const beforeDiff: Record<string, unknown> = {};
    const afterDiff: Record<string, unknown> = {};
    for (const [key, newVal] of Object.entries(data)) {
      const oldVal = (existing as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
      if (key === "bankDetails") {
        beforeDiff.bankDetails = "changed";
        afterDiff.bankDetails = "changed";
      } else {
        beforeDiff[key] = oldVal ?? null;
        afterDiff[key] = (updated as unknown as Record<string, unknown>)[key] ?? newVal;
      }
    }
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.updated", entityType: "employee", entityId: id, before: beforeDiff, after: afterDiff });
    return updated;
  }

  async deactivate(user: RequestUser, id: string, dateOfExit?: string, reason?: string) {
    const existing = await this.prisma.employee.findFirst({ where: { id, companyId: user.companyId }, include: { user: true } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    const updated = await this.prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({
        where: { id },
        data: { employmentStatus: "exited", dateOfExit: dateOnly(dateOfExit ?? ymdOf(new Date())) },
        select: employeeSelect,
      });
      if (existing.user) {
        await tx.user.update({ where: { id: existing.user.id }, data: { status: "disabled" } });
        await tx.authSession.updateMany({ where: { userId: existing.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return emp;
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.deactivated", entityType: "employee", entityId: id, before: { employmentStatus: existing.employmentStatus }, after: { employmentStatus: "exited", reason } });
    return updated;
  }

  async reactivate(user: RequestUser, id: string) {
    const existing = await this.prisma.employee.findFirst({ where: { id, companyId: user.companyId }, include: { user: true } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    const updated = await this.prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({ where: { id }, data: { employmentStatus: "active", dateOfExit: null }, select: employeeSelect });
      if (existing.user) await tx.user.update({ where: { id: existing.user.id }, data: { status: "active" } });
      return emp;
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.reactivated", entityType: "employee", entityId: id, after: { employmentStatus: "active" } });
    return updated;
  }

  /** Create a login for an employee; returns a one-time temporary password. */
  async createLogin(user: RequestUser, id: string, role: "employee" | "hr" = "employee") {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId: user.companyId }, include: { user: true } });
    if (!employee) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    if (employee.user) throw new ConflictException({ code: "already_linked", message: "Employee already has a login" });
    const tempPassword = randomBytes(9).toString("base64url");
    const created = await this.prisma.user.create({
      data: {
        companyId: user.companyId,
        email: employee.workEmail,
        passwordHash: await this.auth.hashPassword(tempPassword),
        role,
        employeeId: employee.id,
        // Temporary login: must change on first sign-in; expires in 7 days.
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
      select: { id: true, email: true, role: true },
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "user.created", entityType: "user", entityId: created.id, after: { email: created.email, role } });
    return { ...created, tempPassword };
  }

  // ── Import wizard ────────────────────────────────────────────────

  importTemplate(): string {
    return toCsv([
      {
        employeeCode: "EMP001", fullName: "Asha Raman", workEmail: "asha.raman@example.com",
        phone: "9840012345", joiningDate: "2024-06-01", department: "Editorial",
        designation: "Sub Editor", managerCode: "", employmentType: "full_time",
      },
    ]);
  }

  private normalizeHeaders(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = k.trim().toLowerCase().replace(/[\s_-]+/g, "");
      out[key] = (v ?? "").trim();
    }
    // aliases
    const alias: Record<string, string> = {
      employeecode: "employeeCode", code: "employeeCode", id: "employeeCode",
      fullname: "fullName", name: "fullName", employeename: "fullName",
      workemail: "workEmail", email: "workEmail",
      phone: "phone", mobile: "phone", phonenumber: "phone",
      joiningdate: "joiningDate", dateofjoining: "joiningDate", doj: "joiningDate", joindate: "joiningDate",
      department: "department", dept: "department",
      designation: "designation", title: "designation", role: "designation",
      managercode: "managerCode", manager: "managerCode", reportingmanager: "managerCode",
      employmenttype: "employmentType", type: "employmentType",
    };
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(out)) mapped[alias[k] ?? k] = v;
    return mapped;
  }

  async importPreview(user: RequestUser, fileBuffer: Buffer, mapping?: Record<string, string>): Promise<{ rows: ImportPreviewRow[]; validCount: number; errorCount: number }> {
    let rawRows: Record<string, string>[];
    try {
      rawRows = parse(fileBuffer.toString("utf-8"), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    } catch {
      throw new BadRequestException({ code: "invalid_csv", message: "Could not parse the CSV file" });
    }
    if (rawRows.length === 0) throw new BadRequestException({ code: "empty_csv", message: "The CSV file has no data rows" });
    if (rawRows.length > 2000) throw new BadRequestException({ code: "too_many_rows", message: "Maximum 2000 rows per import" });

    const rows = rawRows.map((r) => {
      const n = this.normalizeHeaders(r);
      if (mapping) {
        const remapped: Record<string, string> = {};
        for (const [target, source] of Object.entries(mapping)) {
          const srcKey = Object.keys(n).find((k) => k.toLowerCase() === source.toLowerCase());
          if (srcKey) remapped[target] = n[srcKey];
        }
        return { ...n, ...remapped };
      }
      return n;
    });

    const [departments, designations, existingEmployees] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId: user.companyId } }),
      this.prisma.designation.findMany({ where: { companyId: user.companyId } }),
      this.prisma.employee.findMany({ where: { companyId: user.companyId }, select: { employeeCode: true, workEmail: true } }),
    ]);
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const desigByTitle = new Map(designations.map((d) => [d.title.toLowerCase(), d.id]));
    const existingCodes = new Set(existingEmployees.map((e) => e.employeeCode.toLowerCase()));
    const existingEmails = new Set(existingEmployees.map((e) => e.workEmail.toLowerCase()));
    const codesInFile = new Map<string, number>();
    const emailsInFile = new Map<string, number>();
    rows.forEach((r) => {
      const c = (r.employeeCode ?? "").toLowerCase();
      const e = (r.workEmail ?? "").toLowerCase();
      if (c) codesInFile.set(c, (codesInFile.get(c) ?? 0) + 1);
      if (e) emailsInFile.set(e, (emailsInFile.get(e) ?? 0) + 1);
    });
    const managerCodes = new Set(rows.map((r) => (r.managerCode ?? "").toLowerCase()).filter(Boolean));
    const managersInDb = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, employeeCode: { in: [...managerCodes].map((c) => c.toUpperCase()), mode: "insensitive" } },
      select: { employeeCode: true },
    });
    const managerCodeSet = new Set([
      ...managersInDb.map((m) => m.employeeCode.toLowerCase()),
      ...rows.map((r) => (r.employeeCode ?? "").toLowerCase()).filter(Boolean), // manager may be in the same file
    ]);

    const preview: ImportPreviewRow[] = rows.map((r, i) => {
      const errors: { field: string; message: string }[] = [];
      const code = r.employeeCode ?? "";
      const email = (r.workEmail ?? "").toLowerCase();
      if (!code) errors.push({ field: "employeeCode", message: "Employee code is required" });
      else if (codesInFile.get(code.toLowerCase())! > 1) errors.push({ field: "employeeCode", message: "Duplicate code within the file" });
      else if (existingCodes.has(code.toLowerCase())) errors.push({ field: "employeeCode", message: "Code already exists" });
      if (!r.fullName) errors.push({ field: "fullName", message: "Full name is required" });
      if (!email) errors.push({ field: "workEmail", message: "Email is required" });
      else if (!EMAIL_RE.test(email)) errors.push({ field: "workEmail", message: "Invalid email format" });
      else if (emailsInFile.get(email)! > 1) errors.push({ field: "workEmail", message: "Duplicate email within the file" });
      else if (existingEmails.has(email)) errors.push({ field: "workEmail", message: "Email already exists" });
      if (!r.joiningDate) errors.push({ field: "joiningDate", message: "Joining date is required" });
      else if (!DATE_RE.test(r.joiningDate)) errors.push({ field: "joiningDate", message: "Use YYYY-MM-DD" });
      if (r.department && !deptByName.has(r.department.toLowerCase())) errors.push({ field: "department", message: `Unknown department "${r.department}"` });
      if (r.designation && !desigByTitle.has(r.designation.toLowerCase())) errors.push({ field: "designation", message: `Unknown designation "${r.designation}"` });
      if (r.managerCode && !managerCodeSet.has(r.managerCode.toLowerCase())) errors.push({ field: "managerCode", message: `Unknown manager code "${r.managerCode}"` });
      if (r.managerCode && r.managerCode.toLowerCase() === code.toLowerCase()) errors.push({ field: "managerCode", message: "Employee cannot report to themselves" });
      return { rowNumber: i + 2, data: r, errors };
    });

    const validCount = preview.filter((r) => r.errors.length === 0).length;
    return { rows: preview, validCount, errorCount: preview.length - validCount };
  }

  async importCommit(user: RequestUser, rows: Record<string, string>[]) {
    // Re-validate everything server-side; commit valid rows in one transaction.
    const fakeFile = toCsv(rows);
    const preview = await this.importPreview(user, Buffer.from(fakeFile));
    const valid = preview.rows.filter((r) => r.errors.length === 0);
    const failed = preview.rows.filter((r) => r.errors.length > 0).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));
    if (valid.length === 0) return { imported: 0, failed };

    const departments = await this.prisma.department.findMany({ where: { companyId: user.companyId } });
    const designations = await this.prisma.designation.findMany({ where: { companyId: user.companyId } });
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const desigByTitle = new Map(designations.map((d) => [d.title.toLowerCase(), d.id]));

    // Resolve manager codes to ids (DB first, then within-file codes in code order)
    const codeToId = new Map<string, string>();
    const existingManagers = await this.prisma.employee.findMany({
      where: { companyId: user.companyId },
      select: { id: true, employeeCode: true },
    });
    existingManagers.forEach((m) => codeToId.set(m.employeeCode.toLowerCase(), m.id));

    await this.prisma.$transaction(async (tx) => {
      for (const row of valid) {
        const d = row.data;
        const created = await tx.employee.create({
          data: {
            companyId: user.companyId,
            employeeCode: d.employeeCode.trim(),
            fullName: d.fullName.trim(),
            workEmail: d.workEmail.toLowerCase().trim(),
            phone: d.phone || null,
            joiningDate: dateOnly(d.joiningDate),
            departmentId: d.department ? deptByName.get(d.department.toLowerCase()) ?? null : null,
            designationId: d.designation ? desigByTitle.get(d.designation.toLowerCase()) ?? null : null,
            managerId: d.managerCode ? codeToId.get(d.managerCode.toLowerCase()) ?? null : null,
            employmentType: d.employmentType || "full_time",
          },
          select: { id: true, employeeCode: true },
        });
        codeToId.set(created.employeeCode.toLowerCase(), created.id);
        // Bulk import does NOT go through create() above, so allocations
        // are hooked here too (same pro-rated joining-year rule, inside the
        // same transaction so an import never leaves an employee with no
        // leave). Idempotent guard as in create().
        {
          const joiningYear = Number(d.joiningDate.slice(0, 4));
          const types = await tx.leaveType.findMany({ where: { companyId: user.companyId, isActive: true } });
          for (const t of types) {
            const defaultDays = Number(t.defaultDays);
            if (!(defaultDays > 0)) continue;
            const existing = await tx.leaveLedger.findFirst({
              where: { companyId: user.companyId, employeeId: created.id, leaveTypeId: t.id, year: joiningYear, entryType: "allocation" },
            });
            if (existing) continue;
            const deltaDays = proratedLeaveAllocation(defaultDays, d.joiningDate);
            if (!(deltaDays > 0)) continue;
            await tx.leaveLedger.create({
              data: {
                companyId: user.companyId, employeeId: created.id, leaveTypeId: t.id, year: joiningYear,
                deltaDays, entryType: "allocation",
                note: `Joining-year allocation (pro-rated, joined ${d.joiningDate})`,
                createdById: user.userId,
              },
            });
          }
        }
      }
    });

    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "employee.import", entityType: "employee", after: { imported: valid.length, failed: failed.length } });
    return { imported: valid.length, failed };
  }

  // ── Salary structures ────────────────────────────────────────────

  async listSalaryStructures(user: RequestUser, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId, ...visibilityWhere(user) } });
    if (!emp) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    // Salary details restricted: hr, md, or self
    if (!(user.role === "hr" || user.role === "md" || user.employeeId === employeeId)) {
      throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    }
    return this.prisma.salaryStructure.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
  }

  async createSalaryStructure(user: RequestUser, employeeId: string, input: SalaryStructureInput) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId } });
    if (!emp) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.salaryStructure.updateMany({ where: { employeeId, status: "active" }, data: { status: "superseded" } });
      return tx.salaryStructure.create({
        data: { employeeId, effectiveFrom: dateOnly(input.effectiveFrom), components: input.components as object, status: "active", createdById: user.userId },
      });
    });
    // B5c: salary audit payloads carry structure keys + effectiveFrom only —
    // never amounts (components hold basic/HRA/allowances/deductions).
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "salary.revised", entityType: "employee", entityId: employeeId, after: { componentKeys: Object.keys(input.components ?? {}), effectiveFrom: input.effectiveFrom } });
    return result;
  }
}
