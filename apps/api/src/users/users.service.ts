import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { AuthService } from "../auth/auth.service";
import { pageParams, pageResult } from "../common/utils";
import type { CreateUserInput, Role } from "@hrms/shared";
import { RequestUser } from "../common/decorators";
import { randomBytes } from "crypto";

const TEMP_PASSWORD_TTL_MS = 7 * 24 * 3600 * 1000;

/** Temporary password: 12 chars, mixed case + digits, no ambiguous chars. */
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

const userSelect = {
  id: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true,
  employee: { select: { id: true, fullName: true, employeeCode: true } },
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private auth: AuthService) {}

  async list(user: RequestUser, query: { page?: number; pageSize?: number; search?: string }) {
    const { skip, take, page, pageSize } = pageParams(query.page, query.pageSize);
    const where = {
      companyId: user.companyId,
      ...(query.search ? { email: { contains: query.search, mode: "insensitive" as const } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "desc" }, skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }

  async create(actor: RequestUser, input: CreateUserInput) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.user.findFirst({ where: { companyId: actor.companyId, email } });
    if (existing) throw new ConflictException({ code: "duplicate_email", message: "A user with this email already exists" });

    if (input.employeeId) {
      const emp = await this.prisma.employee.findFirst({
        where: { id: input.employeeId, companyId: actor.companyId },
        include: { user: { select: { id: true } } },
      });
      if (!emp) throw new NotFoundException({ code: "not_found", message: "Employee not found" });
      if (emp.user) throw new ConflictException({ code: "already_linked", message: "Employee already has a login" });
    }

    const created = await this.prisma.user.create({
      data: {
        companyId: actor.companyId,
        email,
        passwordHash: await this.auth.hashPassword(input.password),
        role: input.role,
        employeeId: input.employeeId ?? null,
      },
      select: userSelect,
    });
    await this.audit.log({ companyId: actor.companyId, actorId: actor.userId, action: "user.created", entityType: "user", entityId: created.id, after: { email, role: input.role } });
    return created;
  }

  async setRole(actor: RequestUser, id: string, role: Role) {
    const target = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId } });
    if (!target) throw new NotFoundException({ code: "not_found", message: "User not found" });
    if (target.id === actor.userId) throw new BadRequestException({ code: "cannot_change_self", message: "You cannot change your own role" });
    if (target.role === "md" && role !== "md") {
      const mds = await this.prisma.user.count({ where: { companyId: actor.companyId, role: "md", status: "active" } });
      if (mds <= 1) throw new BadRequestException({ code: "last_md", message: "The company must keep at least one active MD" });
    }
    const updated = await this.prisma.user.update({ where: { id }, data: { role }, select: userSelect });
    await this.audit.log({ companyId: actor.companyId, actorId: actor.userId, action: "user.role_changed", entityType: "user", entityId: id, before: { role: target.role }, after: { role } });
    return updated;
  }

  async setStatus(actor: RequestUser, id: string, status: "active" | "disabled") {
    const target = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId } });
    if (!target) throw new NotFoundException({ code: "not_found", message: "User not found" });
    if (target.id === actor.userId) throw new BadRequestException({ code: "cannot_change_self", message: "You cannot disable your own account" });
    const updated = await this.prisma.user.update({ where: { id }, data: { status }, select: userSelect });
    if (status === "disabled") {
      await this.prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ companyId: actor.companyId, actorId: actor.userId, action: "user.status_changed", entityType: "user", entityId: id, before: { status: target.status }, after: { status } });
    return updated;
  }

  /**
   * MD/HR admin password reset (route is @Roles("hr","md") at controller
   * level). Issues a new temporary password (mustChangePassword + 7-day
   * expiry), revokes all of the user's sessions, and returns the password
   * ONCE — only its hash is stored. This is the fallback while password-
   * reset email delivery is not wired (see auth.service forgotPassword).
   */
  async adminResetPassword(actor: RequestUser, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, companyId: actor.companyId } });
    if (!target) throw new NotFoundException({ code: "not_found", message: "User not found" });
    const temporaryPassword = generateTempPassword();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash: await this.auth.hashPassword(temporaryPassword),
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ companyId: actor.companyId, actorId: actor.userId, action: "user.password_reset", entityType: "user", entityId: id });
    return { id, email: target.email, temporaryPassword };
  }
}
