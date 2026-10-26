import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { dateOnly, pageParams, pageResult } from "../common/utils";
import { RequestUser } from "../common/decorators";
import { getLegal, type LegalInfo } from "../billing/letterhead";
import { DEFAULT_STATUTORY_SETTINGS, statutorySettingsSchema } from "@hrms/shared";
import type { DepartmentInput, DesignationInput, HolidayInput } from "@hrms/shared";

/** Company statutory settings with defaults applied (all true / "TN"). */
export function getStatutory(settings: unknown) {
  const raw = (settings && typeof settings === "object" ? (settings as Record<string, unknown>).statutory : undefined);
  const parsed = raw && typeof raw === "object" ? statutorySettingsSchema.partial().safeParse(raw) : null;
  return { ...DEFAULT_STATUTORY_SETTINGS, ...(parsed?.success ? parsed.data : {}) };
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ── Departments ──────────────────────────────────────────────

  async listDepartments(user: RequestUser) {
    return this.prisma.department.findMany({
      where: { companyId: user.companyId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    });
  }

  async createDepartment(user: RequestUser, input: DepartmentInput) {
    const dup = await this.prisma.department.findFirst({ where: { companyId: user.companyId, name: { equals: input.name.trim(), mode: "insensitive" } } });
    if (dup) throw new ConflictException({ code: "duplicate_department", message: "Department already exists" });
    const created = await this.prisma.department.create({ data: { companyId: user.companyId, name: input.name.trim() } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.department_created", entityType: "department", entityId: created.id, after: input });
    return created;
  }

  async updateDepartment(user: RequestUser, id: string, input: DepartmentInput) {
    const existing = await this.prisma.department.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Department not found" });
    return this.prisma.department.update({ where: { id }, data: { name: input.name.trim() } });
  }

  async deleteDepartment(user: RequestUser, id: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, companyId: user.companyId }, include: { _count: { select: { employees: true } } } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Department not found" });
    if (existing._count.employees > 0) {
      throw new ConflictException({ code: "department_in_use", message: `Cannot delete: ${existing._count.employees} employee(s) are assigned to this department` });
    }
    await this.prisma.department.delete({ where: { id } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.department_deleted", entityType: "department", entityId: id, before: { name: existing.name } });
    return { ok: true };
  }

  // ── Designations ─────────────────────────────────────────────

  async listDesignations(user: RequestUser) {
    return this.prisma.designation.findMany({
      where: { companyId: user.companyId },
      include: { _count: { select: { employees: true } } },
      orderBy: [{ level: "asc" }, { title: "asc" }],
    });
  }

  async createDesignation(user: RequestUser, input: DesignationInput) {
    const dup = await this.prisma.designation.findFirst({ where: { companyId: user.companyId, title: { equals: input.title.trim(), mode: "insensitive" } } });
    if (dup) throw new ConflictException({ code: "duplicate_designation", message: "Designation already exists" });
    const created = await this.prisma.designation.create({ data: { companyId: user.companyId, title: input.title.trim(), level: input.level } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.designation_created", entityType: "designation", entityId: created.id, after: input });
    return created;
  }

  async updateDesignation(user: RequestUser, id: string, input: DesignationInput) {
    const existing = await this.prisma.designation.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Designation not found" });
    return this.prisma.designation.update({ where: { id }, data: { title: input.title.trim(), level: input.level } });
  }

  async deleteDesignation(user: RequestUser, id: string) {
    const existing = await this.prisma.designation.findFirst({ where: { id, companyId: user.companyId }, include: { _count: { select: { employees: true } } } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Designation not found" });
    if (existing._count.employees > 0) {
      throw new ConflictException({ code: "designation_in_use", message: `Cannot delete: ${existing._count.employees} employee(s) hold this designation` });
    }
    await this.prisma.designation.delete({ where: { id } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.designation_deleted", entityType: "designation", entityId: id, before: { title: existing.title } });
    return { ok: true };
  }

  // ── Holidays ─────────────────────────────────────────────────

  async listHolidays(user: RequestUser, year?: number) {
    return this.prisma.holiday.findMany({
      where: {
        companyId: user.companyId,
        ...(year ? { date: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) } } : {}),
      },
      orderBy: { date: "asc" },
    });
  }

  async createHoliday(user: RequestUser, input: HolidayInput) {
    const dup = await this.prisma.holiday.findFirst({ where: { companyId: user.companyId, date: dateOnly(input.date) } });
    if (dup) throw new ConflictException({ code: "duplicate_holiday", message: "A holiday already exists on this date" });
    const created = await this.prisma.holiday.create({ data: { companyId: user.companyId, date: dateOnly(input.date), name: input.name.trim(), type: input.type } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.holiday_created", entityType: "holiday", entityId: created.id, after: input });
    return created;
  }

  async deleteHoliday(user: RequestUser, id: string) {
    const existing = await this.prisma.holiday.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Holiday not found" });
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.holiday_deleted", entityType: "holiday", entityId: id, before: { name: existing.name } });
    return { ok: true };
  }

  // ── Company settings ─────────────────────────────────────────

  async getSettings(user: RequestUser) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return { id: company.id, name: company.name, slug: company.slug, timezone: company.timezone, logoUrl: company.logoUrl, settings: company.settings, legal: getLegal(company.settings), statutory: getStatutory(company.settings) };
  }

  async updateSettings(user: RequestUser, input: { name?: string; timezone?: string; logoUrl?: string; settings?: Record<string, unknown>; legal?: Partial<LegalInfo> }) {
    const before = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    const current = (before?.settings && typeof before.settings === "object" ? before.settings : {}) as Record<string, unknown>;
    let settings = input.settings;
    if (settings?.statutory !== undefined) {
      // Validate the statutory block; reject bad values instead of persisting them.
      const parsed = statutorySettingsSchema.partial().safeParse(settings.statutory);
      if (!parsed.success) throw new BadRequestException({ code: "invalid_statutory", message: "Invalid statutory settings" });
      settings = { ...settings, statutory: { ...getStatutory(current), ...parsed.data } };
    }
    if (input.legal || settings) {
      // Merge with existing settings instead of replacing them, so saving one
      // section (e.g. statutory) never wipes another (e.g. legal / currency).
      const currentLegal = (current.legal && typeof current.legal === "object" ? current.legal : {}) as Record<string, unknown>;
      settings = { ...current, ...(settings ?? {}), ...(input.legal ? { legal: { ...currentLegal, ...input.legal } } : {}) };
    }
    const updated = await this.prisma.company.update({
      where: { id: user.companyId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
        ...(settings ? { settings: settings as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "admin.settings_updated", entityType: "company", entityId: user.companyId, before: { timezone: before?.timezone }, after: input });
    return { id: updated.id, name: updated.name, timezone: updated.timezone, logoUrl: updated.logoUrl, settings: updated.settings, legal: getLegal(updated.settings), statutory: getStatutory(updated.settings) };
  }

  // ── Audit log ────────────────────────────────────────────────

  async auditLogs(user: RequestUser, q: { page?: number; pageSize?: number; entityType?: string; action?: string }) {
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    const where = {
      companyId: user.companyId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }
}
