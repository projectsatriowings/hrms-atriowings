import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { dateInTz, dateOnly, haversineMeters, minutesBetween, pageParams, pageResult, toCsv, todayInTz, ymdOf } from "../common/utils";
import { RequestUser } from "../common/decorators";
import type { AttendancePolicyInput, BiometricPunchInput, CheckInInput, CorrectAttendanceInput, WfhDayInput, WfhRequestInput } from "@hrms/shared";

/** UTC instant of HH:mm on a YYYY-MM-DD in the given IANA zone (converges for fixed-offset zones). */
export function zonedTimeToUtc(ymd: string, hm: string, tz: string): Date {
  const [Y, M, D] = ymd.split("-").map(Number);
  const [h, m] = hm.split(":").map(Number);
  const base = Date.UTC(Y, M - 1, D, h, m);
  let guess = base;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    const asUtc = Date.UTC(+get("year"), +get("month") - 1, +get("day"), (+get("hour")) % 24, +get("minute"), +get("second"));
    guess = base - (asUtc - guess);
  }
  return new Date(guess);
}

const recordSelect = {
  id: true, workDate: true, checkInAt: true, checkOutAt: true, status: true,
  lateMinutes: true, workingMinutes: true, source: true, note: true, needsReview: true,
  checkInLat: true, checkInLng: true, locationVerified: true, wfh: true,
};

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async companyOf(user: RequestUser) {
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) throw new NotFoundException({ code: "not_found", message: "Company not found" });
    return company;
  }

  private async defaultPolicy(companyId: string) {
    return this.prisma.attendancePolicy.findFirst({ where: { companyId, isDefault: true } });
  }

  private async employeeOf(user: RequestUser) {
    if (!user.employeeId) throw new BadRequestException({ code: "no_employee", message: "Your login is not linked to an employee record" });
    const emp = await this.prisma.employee.findFirst({ where: { id: user.employeeId, companyId: user.companyId } });
    if (!emp) throw new BadRequestException({ code: "no_employee", message: "Your login is not linked to an employee record" });
    return emp;
  }

  /** True when the given calendar date is a WFH day for the employee: either an
   *  approved personal WFH request or a company-wide WFH day. */
  private async isWfhDay(companyId: string, employeeId: string, workDate: Date): Promise<boolean> {
    const [request, day] = await Promise.all([
      this.prisma.wfhRequest.findFirst({ where: { employeeId, date: workDate, status: "approved" }, select: { id: true } }),
      this.prisma.wfhDay.findFirst({ where: { companyId, date: workDate }, select: { id: true } }),
    ]);
    return request != null || day != null;
  }

  private async canReviewWfh(user: RequestUser): Promise<boolean> {
    return user.role === "hr" || user.role === "md";
  }

  // ── Employee self-service ────────────────────────────────────────

  async today(user: RequestUser) {
    const company = await this.companyOf(user);
    const employee = await this.employeeOf(user);
    const today = todayInTz(company.timezone);
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: dateOnly(today) } },
      select: recordSelect,
    });
    const policy = await this.defaultPolicy(user.companyId);
    const isWfhToday = await this.isWfhDay(user.companyId, employee.id, dateOnly(today));
    return { record, policy, serverTime: new Date().toISOString(), today, timezone: company.timezone, isWfhToday };
  }

  async checkIn(user: RequestUser, dto: CheckInInput = {}) {
    const company = await this.companyOf(user);
    const employee = await this.employeeOf(user);
    if (employee.employmentStatus !== "active") {
      throw new BadRequestException({ code: "inactive_employee", message: "Only active employees can check in" });
    }
    const today = todayInTz(company.timezone);

    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        companyId: user.companyId, employeeId: employee.id, status: "approved",
        fromDate: { lte: dateOnly(today) }, toDate: { gte: dateOnly(today) },
      },
    });
    if (onLeave) throw new ConflictException({ code: "on_leave", message: "You are on approved leave today" });

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: dateOnly(today) } },
    });
    if (existing) {
      if (!existing.checkOutAt) throw new ConflictException({ code: "already_checked_in", message: "You have already checked in today" });
      throw new ConflictException({ code: "already_completed", message: "Today's attendance is already complete" });
    }

    // ── Geofence enforcement (skipped on WFH days) ──
    const isWfh = await this.isWfhDay(user.companyId, employee.id, dateOnly(today));
    const policy = await this.defaultPolicy(user.companyId);
    const officeSet = policy?.officeLatitude != null && policy?.officeLongitude != null;
    const hasCoords = dto.latitude != null && dto.longitude != null;
    let checkInLat: number | undefined;
    let checkInLng: number | undefined;
    let locationVerified = false;
    if (isWfh) {
      // WFH day: never block on location; still record coords when provided.
      if (hasCoords) {
        checkInLat = dto.latitude;
        checkInLng = dto.longitude;
      }
    } else if (policy?.requireLocation && officeSet) {
      if (!hasCoords) {
        throw new BadRequestException({ code: "location_required", message: "Location is required for check-in" });
      }
      const distance = haversineMeters(dto.latitude!, dto.longitude!, policy.officeLatitude!, policy.officeLongitude!);
      const radius = policy.geofenceRadiusMeters ?? 200;
      if (distance > radius) {
        throw new ForbiddenException({
          code: "outside_geofence",
          message: `You are ${Math.round(distance)} m away from the office`,
          details: { distanceMeters: Math.round(distance) },
        });
      }
      checkInLat = dto.latitude;
      checkInLng = dto.longitude;
      locationVerified = true;
    } else if (hasCoords) {
      checkInLat = dto.latitude;
      checkInLng = dto.longitude;
      if (officeSet) {
        const distance = haversineMeters(dto.latitude!, dto.longitude!, policy.officeLatitude!, policy.officeLongitude!);
        locationVerified = distance <= (policy!.geofenceRadiusMeters ?? 200);
      }
    }

    const now = new Date();
    try {
      return await this.prisma.attendanceRecord.create({
        data: {
          companyId: user.companyId, employeeId: employee.id,
          workDate: dateOnly(today), checkInAt: now, status: "present", source: "self",
          checkInLat, checkInLng, locationVerified, wfh: isWfh,
        },
        select: recordSelect,
      });
    } catch (e) {
      // Lost a race with a simultaneous check-in: the (employeeId, workDate)
      // unique key fired. Report the same clean conflict as the pre-check.
      if (this.isUniqueViolation(e)) {
        throw new ConflictException({ code: "already_checked_in", message: "You have already checked in today" });
      }
      throw e;
    }
  }

  async checkOut(user: RequestUser) {
    const company = await this.companyOf(user);
    const employee = await this.employeeOf(user);
    const today = todayInTz(company.timezone);
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: dateOnly(today) } },
    });
    if (!record || !record.checkInAt) throw new ConflictException({ code: "no_check_in", message: "You have not checked in today" });
    if (record.checkOutAt) throw new ConflictException({ code: "already_completed", message: "You have already checked out today" });

    const now = new Date();
    const computed = await this.computeDerived(user.companyId, company.timezone, record.checkInAt, now, today);
    const updated = await this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { checkOutAt: now, workingMinutes: computed.workingMinutes, lateMinutes: computed.lateMinutes, status: computed.status },
      select: recordSelect,
    });
    return updated;
  }

  // ── Work from home ───────────────────────────────────────────────

  async requestWfh(user: RequestUser, dto: WfhRequestInput) {
    const company = await this.companyOf(user);
    const employee = await this.employeeOf(user);
    if (employee.employmentStatus !== "active") {
      throw new BadRequestException({ code: "inactive_employee", message: "Only active employees can request work from home" });
    }
    const today = todayInTz(company.timezone);
    if (dto.date < today) {
      throw new BadRequestException({ code: "past_date", message: "Work-from-home can only be requested for today or a future date" });
    }
    const date = dateOnly(dto.date);
    const companyDay = await this.prisma.wfhDay.findFirst({ where: { companyId: user.companyId, date }, select: { id: true } });
    if (companyDay) {
      throw new ConflictException({ code: "company_wfh_day", message: "This is already a company work-from-home day" });
    }
    try {
      return await this.prisma.wfhRequest.create({
        data: { companyId: user.companyId, employeeId: employee.id, date, reason: dto.reason, status: "pending" },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw new ConflictException({ code: "duplicate_wfh", message: "A work-from-home request already exists for this date" });
      }
      throw e;
    }
  }

  async myWfhRequests(user: RequestUser) {
    const employee = await this.employeeOf(user);
    return this.prisma.wfhRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: "desc" },
    });
  }

  async teamWfhRequests(user: RequestUser, status?: string) {
    const where: Record<string, unknown> = { companyId: user.companyId };
    if (status) where.status = status;
    return this.prisma.wfhRequest.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } } },
      orderBy: { date: "asc" },
    });
  }

  async decideWfh(user: RequestUser, id: string, decision: "approved" | "rejected", note?: string) {
    const request = await this.prisma.wfhRequest.findFirst({
      where: { id, companyId: user.companyId },
      include: { employee: { select: { id: true, fullName: true } } },
    });
    if (!request) throw new NotFoundException({ code: "not_found", message: "Work-from-home request not found" });
    if (request.status !== "pending") {
      throw new ConflictException({ code: "already_decided", message: `Request is already ${request.status}` });
    }
    if (!(await this.canReviewWfh(user))) {
      throw new ForbiddenException({ code: "forbidden", message: "You cannot decide this request" });
    }
    // Self-approval is blocked, mirroring leave decide(): an approver whose
    // login is linked to the requester's employee record cannot decide
    // their own WFH request (either decision).
    if (user.employeeId && user.employeeId === request.employeeId) {
      throw new ForbiddenException({ code: "self_approval", message: "You cannot decide your own work-from-home request" });
    }
    const updated = await this.prisma.wfhRequest.update({
      where: { id },
      data: { status: decision, decidedById: user.userId, decidedAt: new Date() },
    });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: `wfh.${decision}`,
      entityType: "wfh_request", entityId: id, after: { note, employeeId: request.employeeId, date: request.date },
    });
    return updated;
  }

  async listWfhDays(user: RequestUser) {
    return this.prisma.wfhDay.findMany({
      where: { companyId: user.companyId },
      orderBy: { date: "desc" },
    });
  }

  async addWfhDay(user: RequestUser, dto: WfhDayInput) {
    try {
      const day = await this.prisma.wfhDay.create({
        data: { companyId: user.companyId, date: dateOnly(dto.date), note: dto.note },
      });
      await this.audit.log({
        companyId: user.companyId, actorId: user.userId, action: "wfh.day_added",
        entityType: "wfh_day", entityId: day.id, after: { date: dto.date, note: dto.note },
      });
      return day;
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw new ConflictException({ code: "duplicate_wfh_day", message: "This date is already a company work-from-home day" });
      }
      throw e;
    }
  }

  async removeWfhDay(user: RequestUser, id: string) {
    const day = await this.prisma.wfhDay.findFirst({ where: { id, companyId: user.companyId } });
    if (!day) throw new NotFoundException({ code: "not_found", message: "Work-from-home day not found" });
    await this.prisma.wfhDay.delete({ where: { id } });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "wfh.day_removed",
      entityType: "wfh_day", entityId: id, after: { date: day.date },
    });
    return { deleted: true };
  }

  // ── A5: nightly review flagging ─────────────────────────────────────
  /** Nightly (02:00 server time): flag records from before today that still
   *  have no check-out as needing review. Deliberately does NOT fabricate a
   *  check-out time — HR corrects the record by hand. Requires the
   *  ScheduleModule to be registered (wired by another workstream); without
   *  it this decorator is inert. */
  @Cron("0 0 2 * * *")
  async flagOpenRecordsForReview() {
    const companies = await this.prisma.company.findMany({ select: { id: true, timezone: true } });
    let flagged = 0;
    for (const company of companies) {
      const today = todayInTz(company.timezone);
      const res = await this.prisma.attendanceRecord.updateMany({
        where: { companyId: company.id, workDate: { lt: dateOnly(today) }, checkOutAt: null, needsReview: false },
        data: { needsReview: true },
      });
      flagged += res.count;
    }
    return { flagged };
  }

  // ── Biometric device punches (device-authenticated, no JWT) ──────

  /** Verify an `x-device-key` header against active device hashes.
   *  A20: keys issued after this fix carry the device id
   *  (`hrms_bm_<deviceId>_<random>`), so they resolve by direct lookup.
   *  Legacy keys (`hrms_bm_<random>`) have no device id and still work via
   *  the scan fallback below. */
  private async deviceByKey(deviceKey: string) {
    if (deviceKey.startsWith("hrms_bm_")) {
      const rest = deviceKey.slice("hrms_bm_".length);
      const sep = rest.indexOf("_");
      if (sep > 0) {
        const direct = await this.prisma.biometricDevice.findFirst({
          where: { id: rest.slice(0, sep), status: "active" },
          include: { company: true },
        });
        if (direct && this.hashMatches(deviceKey, direct.apiKeyHash)) return direct;
      }
    }
    // Legacy fallback: scan active devices (timing-safe compare).
    const candidates = await this.prisma.biometricDevice.findMany({
      where: { status: "active" },
      include: { company: true },
    });
    for (const device of candidates) {
      if (this.hashMatches(deviceKey, device.apiKeyHash)) return device;
    }
    throw new UnauthorizedException({ code: "invalid_device_key", message: "Invalid device key" });
  }

  private hashMatches(deviceKey: string, storedHash: string): boolean {
    try {
      const providedHash = createHash("sha256").update(deviceKey).digest();
      const stored = Buffer.from(storedHash, "hex");
      return stored.length === providedHash.length && timingSafeEqual(stored, providedHash);
    } catch {
      return false;
    }
  }

  async biometricPunch(deviceKey: string, input: BiometricPunchInput) {
    const device = await this.deviceByKey(deviceKey);
    await this.prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });

    const punchAt = new Date(input.timestamp);
    const now = Date.now();
    // Biometric window: offline devices may only sync days later, so punches
    // up to 7 days old are accepted and flagged as late sync (lateSync, plus
    // an audit note below). Older punches are still rejected, and future
    // punches beyond the 10-minute clock-skew tolerance are still rejected.
    const FUTURE_TOLERANCE_MS = 10 * 60_000;
    const MAX_PUNCH_AGE_MS = 7 * 24 * 3600_000;
    const LATE_SYNC_AFTER_MS = 24 * 3600_000;
    if (Number.isNaN(punchAt.getTime()) || punchAt.getTime() > now + FUTURE_TOLERANCE_MS || punchAt.getTime() < now - MAX_PUNCH_AGE_MS) {
      throw new BadRequestException({ code: "bad_timestamp", message: "Punch timestamp is outside the allowed window" });
    }
    const lateSync = punchAt.getTime() < now - LATE_SYNC_AFTER_MS;

    const mapping = await this.prisma.biometricMapping.findUnique({
      where: { deviceId_deviceUserId: { deviceId: device.id, deviceUserId: input.deviceUserId } },
      include: { employee: true },
    });
    if (!mapping) throw new NotFoundException({ code: "unmapped_user", message: "Device user is not mapped to any employee" });

    const employee = mapping.employee;
    if (employee.employmentStatus !== "active") {
      throw new BadRequestException({ code: "inactive_employee", message: "Only active employees can punch" });
    }
    const company = device.company;
    const workDate = dateInTz(punchAt, company.timezone);
    const recordKey = { employeeId_workDate: { employeeId: employee.id, workDate: dateOnly(workDate) } };

    // A20 idempotency: a replayed identical punch (same device, user,
    // timestamp, type) returns the existing result unchanged — no duplicate
    // record, no 409. Only successful punches are logged, so a replay of a
    // punch that originally failed still fails the same way.
    const replay = await this.prisma.biometricPunch.findUnique({
      where: { deviceId_deviceUserId_timestamp_type: { deviceId: device.id, deviceUserId: input.deviceUserId, timestamp: punchAt, type: input.type } },
      include: { record: { select: recordSelect } },
    });
    if (replay?.record) return replay.record;
    if (replay && !replay.record) {
      // Logged punch whose record was deleted: re-apply below, then the
      // log insert will hit P2002 and be swallowed (state is identical).
    }

    // A20 first-in / last-out: one record per employee+date. An "in" moves
    // checkInAt only to an EARLIER time; an "out" moves checkOutAt only to
    // a LATER time. Later "in" punches after a completed day and earlier
    // "out" punches therefore change nothing — verified by the probe.
    // (Review claim confirmed: the old code 409'd on any second in/out.)
    let record = await this.prisma.attendanceRecord.findUnique({ where: recordKey, select: recordSelect });
    if (input.type === "in") {
      if (!record) {
        const onLeave = await this.prisma.leaveRequest.findFirst({
          where: {
            companyId: device.companyId, employeeId: employee.id, status: "approved",
            fromDate: { lte: dateOnly(workDate) }, toDate: { gte: dateOnly(workDate) },
          },
        });
        if (onLeave) throw new ConflictException({ code: "on_leave", message: "Employee is on approved leave" });
        try {
          record = await this.prisma.attendanceRecord.create({
            data: {
              companyId: device.companyId, employeeId: employee.id,
              workDate: dateOnly(workDate), checkInAt: punchAt, status: "present", source: "biometric",
              locationVerified: true,
            },
            select: recordSelect,
          });
        } catch (e) {
          if (this.isUniqueViolation(e)) {
            record = await this.prisma.attendanceRecord.findUnique({ where: recordKey, select: recordSelect });
          } else throw e;
        }
      } else if (!record.checkInAt || punchAt.getTime() < record.checkInAt.getTime()) {
        const data: Record<string, unknown> = { checkInAt: punchAt };
        if (record.checkOutAt) {
          const computed = await this.computeDerived(device.companyId, company.timezone, punchAt, record.checkOutAt, workDate);
          data.workingMinutes = computed.workingMinutes;
          data.lateMinutes = computed.lateMinutes;
          data.status = computed.status;
        }
        record = await this.prisma.attendanceRecord.update({ where: { id: record.id }, data, select: recordSelect });
      } else {
        record = await this.prisma.attendanceRecord.findUnique({ where: { id: record.id }, select: recordSelect });
      }
    } else {
      // type === "out"
      if (!record || !record.checkInAt) throw new ConflictException({ code: "no_check_in", message: "No check-in found for this punch" });
      if (punchAt.getTime() < record.checkInAt.getTime()) {
        throw new BadRequestException({ code: "bad_timestamp", message: "Check-out cannot be before check-in" });
      }
      if (!record.checkOutAt || punchAt.getTime() > record.checkOutAt.getTime()) {
        const computed = await this.computeDerived(device.companyId, company.timezone, record.checkInAt, punchAt, workDate);
        record = await this.prisma.attendanceRecord.update({
          where: { id: record.id },
          data: { checkOutAt: punchAt, workingMinutes: computed.workingMinutes, lateMinutes: computed.lateMinutes, status: computed.status },
          select: recordSelect,
        });
      } else {
        record = await this.prisma.attendanceRecord.findUnique({ where: { id: record.id }, select: recordSelect });
      }
    }

    if (!record) throw new ConflictException({ code: "no_check_in", message: "No check-in found for this punch" });
    // Log the punch. A concurrent identical punch may win this insert; its
    // record mutation is idempotent (same earliest/latest), so swallowing
    // P2002 here is safe and the returned record is identical either way.
    try {
      await this.prisma.biometricPunch.create({
        data: { deviceId: device.id, deviceUserId: input.deviceUserId, timestamp: punchAt, type: input.type, recordId: record.id, lateSync },
      });
    } catch (e) {
      if (!this.isUniqueViolation(e)) throw e;
    }
    if (lateSync) {
      // Audit note: this punch arrived more than 24h after it happened
      // (offline device syncing late), so HR can tell it apart from a
      // live punch when reviewing the record.
      await this.audit.log({
        companyId: device.companyId, action: "attendance.biometric_late_sync",
        entityType: "biometric_punch", entityId: record.id,
        after: { deviceId: device.id, deviceUserId: input.deviceUserId, timestamp: punchAt.toISOString(), type: input.type, lateSync: true },
      });
    }
    return record;
  }

  /** Prisma unique-constraint error (P2002), duck-typed to avoid a hard import. */
  private isUniqueViolation(e: unknown): boolean {
    return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
  }

  /** Derive late/working minutes + status from punch times and policy. */
  private async computeDerived(companyId: string, tz: string, checkInAt: Date, checkOutAt: Date, workDate: string) {
    const policy = await this.defaultPolicy(companyId);
    const workStart = policy?.workStart ?? "09:30";
    const grace = policy?.graceMinutes ?? 10;
    const fullDay = policy?.fullDayMinutes ?? 480;
    const halfDay = policy?.halfDayMinutes ?? 240;

    const startUtc = zonedTimeToUtc(workDate, workStart, tz).getTime() + grace * 60000;
    const lateMinutes = Math.max(0, Math.round((checkInAt.getTime() - startUtc) / 60000));
    const workingMinutes = minutesBetween(checkInAt, checkOutAt);
    // Status follows the policy thresholds: >= fullDay → present, >= halfDay →
    // half_day, anything below that is "absent" (the enum's below-threshold
    // status, which payroll already counts as 0 paid days). Previously every
    // completed pair under fullDay became half_day — even a 0-minute pair.
    const status = workingMinutes >= fullDay ? "present" : workingMinutes >= halfDay ? "half_day" : "absent";
    return { lateMinutes, workingMinutes, status: status as "present" | "half_day" | "absent" };
  }

  async myHistory(user: RequestUser, q: { from?: string; to?: string; page?: number; pageSize?: number }) {
    const employee = await this.employeeOf(user);
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    // A18: from+to merged into ONE workDate object (two spread keys made
    // the second overwrite the first, silently dropping the from bound).
    const workDate: Record<string, unknown> = {};
    if (q.from) workDate.gte = dateOnly(q.from);
    if (q.to) workDate.lte = dateOnly(q.to);
    const where = {
      employeeId: employee.id,
      ...(Object.keys(workDate).length ? { workDate } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({ where, select: recordSelect, orderBy: { workDate: "desc" }, skip, take }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }

  // ── HR views ─────────────────────────────────────────────────────

  async daily(user: RequestUser, date: string, departmentId?: string) {
    const company = await this.companyOf(user);
    const policy = await this.defaultPolicy(user.companyId);
    const employees = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, employmentStatus: "active", ...(departmentId ? { departmentId } : {}) },
      select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } },
      orderBy: { fullName: "asc" },
    });

    const [holidays, leaves, dayRecords] = await Promise.all([
      this.prisma.holiday.findMany({ where: { companyId: user.companyId, date: dateOnly(date) } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: user.companyId, status: "approved", fromDate: { lte: dateOnly(date) }, toDate: { gte: dateOnly(date) } },
        select: { employeeId: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { companyId: user.companyId, workDate: dateOnly(date) },
        select: { employeeId: true, ...recordSelect },
      }),
    ]);
    const recordByEmployee = new Map(dayRecords.map((r) => [r.employeeId, r]));
    const ctx = {
      holidays: new Set(holidays.map((h) => ymdOf(h.date))),
      weeklyOffs: policy?.weeklyOffs ?? [0],
      leaveDays: new Set(leaves.map((l) => `${l.employeeId}:${date}`)),
    };

    const todayStr = todayInTz(company.timezone);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const rows = employees.map((e) => {
      const record = recordByEmployee.get(e.id) ?? null;
      let displayStatus: string;
      let missingCheckout = false;
      let calculated = false;
      if (record) {
        displayStatus = record.status;
        missingCheckout = !record.checkOutAt && date < todayStr;
      } else {
        calculated = true;
        if (ctx.holidays.has(date)) displayStatus = "holiday";
        else if (ctx.weeklyOffs.includes(dow)) displayStatus = "weekly_off";
        else if (ctx.leaveDays.has(`${e.id}:${date}`)) displayStatus = "on_leave";
        else displayStatus = "absent";
      }
      return { employeeId: e.id, record, displayStatus, missingCheckout, calculated };
    });
    const totals = { present: 0, absent: 0, half_day: 0, onLeave: 0, late: 0, missingCheckout: 0, weeklyOff: 0, holiday: 0 };
    const records = rows.map((r, i) => {
      const emp = employees[i];
      const s = r.displayStatus;
      if (s === "present") totals.present++;
      else if (s === "half_day") totals.half_day++;
      else if (s === "absent") totals.absent++;
      else if (s === "on_leave") totals.onLeave++;
      else if (s === "weekly_off") totals.weeklyOff++;
      else if (s === "holiday") totals.holiday++;
      if (r.record && r.record.lateMinutes > 0) totals.late++;
      if (r.missingCheckout) totals.missingCheckout++;
      return { employee: emp, ...r };
    });
    return { date, totals, records };
  }

  async monthly(user: RequestUser, year: number, month: number, departmentId?: string) {
    const company = await this.companyOf(user);
    const policy = await this.defaultPolicy(user.companyId);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);

    const employees = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, employmentStatus: "active", ...(departmentId ? { departmentId } : {}) },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    });
    const [holidays, leaves, records] = await Promise.all([
      this.prisma.holiday.findMany({
        where: { companyId: user.companyId, date: { gte: dateOnly(days[0]), lte: dateOnly(days[days.length - 1]) } },
      }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: user.companyId, status: "approved", fromDate: { lte: dateOnly(days[days.length - 1]) }, toDate: { gte: dateOnly(days[0]) } },
        select: { employeeId: true, fromDate: true, toDate: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { companyId: user.companyId, workDate: { gte: dateOnly(days[0]), lte: dateOnly(days[days.length - 1]) } },
        select: { employeeId: true, workDate: true, status: true, lateMinutes: true, checkOutAt: true, checkInAt: true, checkInLat: true, checkInLng: true, locationVerified: true, wfh: true },
      }),
    ]);

    const holidaySet = new Set(holidays.map((h) => ymdOf(h.date)));
    const weeklyOffs = policy?.weeklyOffs ?? [0];
    const leaveSet = new Set<string>();
    for (const l of leaves) {
      const from = ymdOf(l.fromDate), to = ymdOf(l.toDate);
      for (const d of days) if (d >= from && d <= to) leaveSet.add(`${l.employeeId}:${d}`);
    }
    const recordMap = new Map(records.map((r) => [`${r.employeeId}:${ymdOf(r.workDate)}`, r]));
    const today = todayInTz(company.timezone);

    const matrix: Record<string, Record<string, string>> = {};
    const summary: Record<string, { present: number; absent: number; half_day: number; onLeave: number; late: number; missingCheckout: number }> = {};
    for (const e of employees) {
      matrix[e.id] = {};
      summary[e.id] = { present: 0, absent: 0, half_day: 0, onLeave: 0, late: 0, missingCheckout: 0 };
      for (const d of days) {
        const rec = recordMap.get(`${e.id}:${d}`);
        let s: string;
        if (rec) {
          s = rec.status;
          if (rec.lateMinutes > 0) summary[e.id].late++;
          if (!rec.checkOutAt && d < today) { summary[e.id].missingCheckout++; s = "missing_checkout"; }
        } else {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          if (d > today) s = "future";
          else if (holidaySet.has(d)) s = "holiday";
          else if (weeklyOffs.includes(dow)) s = "weekly_off";
          else if (leaveSet.has(`${e.id}:${d}`)) s = "on_leave";
          else s = "absent";
        }
        matrix[e.id][d] = s;
        const sum = summary[e.id];
        if (s === "present") sum.present++;
        else if (s === "half_day") sum.half_day++;
        else if (s === "absent") sum.absent++;
        else if (s === "on_leave") sum.onLeave++;
      }
    }
    return { year, month, days, employees, matrix, summary };
  }

  async exportCsv(user: RequestUser, from: string, to: string, departmentId?: string) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, ...(departmentId ? { departmentId } : {}) },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { employeeCode: "asc" },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: { companyId: user.companyId, workDate: { gte: dateOnly(from), lte: dateOnly(to) }, employeeId: { in: employees.map((e) => e.id) } },
      select: { employeeId: true, workDate: true, checkInAt: true, checkOutAt: true, status: true, lateMinutes: true, workingMinutes: true, checkInLat: true, checkInLng: true, locationVerified: true, wfh: true },
      orderBy: [{ workDate: "asc" }],
    });
    const empById = new Map(employees.map((e) => [e.id, e]));
    return toCsv(records.map((r) => {
      const e = empById.get(r.employeeId)!;
      return {
        date: ymdOf(r.workDate), employeeCode: e.employeeCode, fullName: e.fullName,
        checkIn: r.checkInAt?.toISOString() ?? "", checkOut: r.checkOutAt?.toISOString() ?? "",
        status: r.status, lateMinutes: r.lateMinutes, workingMinutes: r.workingMinutes,
      };
    }));
  }

  // ── Corrections (HR) ─────────────────────────────────────────────

  async correct(user: RequestUser, recordId: string, input: CorrectAttendanceInput) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, companyId: user.companyId },
      select: { ...recordSelect, employeeId: true },
    });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Attendance record not found" });

    const before = { checkInAt: record.checkInAt, checkOutAt: record.checkOutAt, status: record.status };
    const data: Record<string, unknown> = {};
    if (input.checkInAt !== undefined) data.checkInAt = input.checkInAt ? new Date(input.checkInAt) : null;
    if (input.checkOutAt !== undefined) data.checkOutAt = input.checkOutAt ? new Date(input.checkOutAt) : null;
    if (input.status) data.status = input.status;
    data.source = "correction";
    const newIn = (data.checkInAt ?? record.checkInAt) as Date | null;
    const newOut = (data.checkOutAt ?? record.checkOutAt) as Date | null;
    data.workingMinutes = newIn && newOut ? minutesBetween(newIn, newOut) : 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.update({ where: { id: recordId }, data, select: recordSelect });
      await tx.attendanceCorrection.create({
        data: { recordId, actorId: user.userId, before: before as object, after: { checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt, status: rec.status }, reason: input.reason },
      });
      return rec;
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "attendance.corrected", entityType: "attendance_record", entityId: recordId, before, after: { reason: input.reason } });
    return updated;
  }

  async correctionHistory(user: RequestUser, recordId: string) {
    const record = await this.prisma.attendanceRecord.findFirst({ where: { id: recordId, companyId: user.companyId }, select: { id: true } });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Attendance record not found" });
    return this.prisma.attendanceCorrection.findMany({ where: { recordId }, orderBy: { createdAt: "desc" } });
  }

  // ── Policies (HR) ────────────────────────────────────────────────

  async listPolicies(user: RequestUser) {
    return this.prisma.attendancePolicy.findMany({ where: { companyId: user.companyId }, orderBy: { isDefault: "desc" } });
  }

  async createPolicy(user: RequestUser, input: AttendancePolicyInput) {
    // Same duplicate-name guard the admin module uses (was missing here —
    // a duplicate policy name died on the unique key with a 500).
    const dup = await this.prisma.attendancePolicy.findFirst({ where: { companyId: user.companyId, name: { equals: input.name.trim(), mode: "insensitive" } } });
    if (dup) throw new ConflictException({ code: "duplicate_policy", message: "An attendance policy with this name already exists" });
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.attendancePolicy.updateMany({ where: { companyId: user.companyId }, data: { isDefault: false } });
        return tx.attendancePolicy.create({ data: { companyId: user.companyId, ...input } });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException({ code: "duplicate_policy", message: "An attendance policy with this name already exists" });
      throw e;
    }
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "attendance.policy_created", entityType: "attendance_policy", entityId: created.id, after: input });
    return created;
  }

  async updatePolicy(user: RequestUser, id: string, input: Partial<AttendancePolicyInput>) {
    const existing = await this.prisma.attendancePolicy.findFirst({ where: { id, companyId: user.companyId } });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Policy not found" });
    if (input.name) {
      const dup = await this.prisma.attendancePolicy.findFirst({ where: { companyId: user.companyId, id: { not: id }, name: { equals: input.name.trim(), mode: "insensitive" } } });
      if (dup) throw new ConflictException({ code: "duplicate_policy", message: "An attendance policy with this name already exists" });
    }
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.attendancePolicy.updateMany({ where: { companyId: user.companyId }, data: { isDefault: false } });
        return tx.attendancePolicy.update({ where: { id }, data: input });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw new ConflictException({ code: "duplicate_policy", message: "An attendance policy with this name already exists" });
      throw e;
    }
    await this.audit.log({ companyId: user.companyId, actorId: user.userId, action: "attendance.policy_updated", entityType: "attendance_policy", entityId: id, before: existing, after: updated });
    return updated;
  }
}
