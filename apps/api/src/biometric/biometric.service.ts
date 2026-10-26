import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { pageParams, pageResult } from "../common/utils";
import { RequestUser } from "../common/decorators";
import type { BiometricDeviceInput, BiometricMappingInput } from "@hrms/shared";

const deviceSelect = { id: true, name: true, status: true, lastSeenAt: true, createdAt: true, updatedAt: true };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

@Injectable()
export class BiometricService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async deviceOf(user: RequestUser, deviceId: string) {
    const device = await this.prisma.biometricDevice.findFirst({
      where: { id: deviceId, companyId: user.companyId },
    });
    if (!device) throw new NotFoundException({ code: "not_found", message: "Device not found" });
    return device;
  }

  // ── Devices ────────────────────────────────────────────────────

  async listDevices(user: RequestUser, q: { page?: number; pageSize?: number }) {
    const { skip, take, page, pageSize } = pageParams(q.page, q.pageSize);
    const where = { companyId: user.companyId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.biometricDevice.findMany({
        where,
        select: { ...deviceSelect, _count: { select: { mappings: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      this.prisma.biometricDevice.count({ where }),
    ]);
    return pageResult(data, total, page, pageSize);
  }

  async createDevice(user: RequestUser, input: BiometricDeviceInput) {
    const dup = await this.prisma.biometricDevice.findFirst({
      where: { companyId: user.companyId, name: input.name },
      select: { id: true },
    });
    if (dup) throw new ConflictException({ code: "duplicate_device_name", message: "A device with this name already exists" });

    // A20: new keys embed the device id (hrms_bm_<deviceId>_<random>) so
    // punch authentication can look the device up directly; legacy keys
    // without the id keep working via the scan fallback in deviceByKey.
    // The device is created first with a placeholder hash, then the real
    // key (which needs the id) is hashed and stored.
    let device;
    try {
      device = await this.prisma.biometricDevice.create({
        data: { companyId: user.companyId, name: input.name, status: input.status ?? "active", apiKeyHash: "pending" },
        select: deviceSelect,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException({ code: "duplicate_device_name", message: "A device with this name already exists" });
      throw e;
    }
    const apiKey = `hrms_bm_${device.id}_${randomBytes(32).toString("hex")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    await this.prisma.biometricDevice.update({ where: { id: device.id }, data: { apiKeyHash } });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "biometric.device_created",
      entityType: "biometric_device", entityId: device.id, after: { name: device.name, status: device.status },
    });
    // Plaintext key is returned exactly once — it is never stored or shown again.
    return { ...device, apiKey };
  }

  async updateDevice(user: RequestUser, id: string, input: Partial<BiometricDeviceInput>) {
    const existing = await this.deviceOf(user, id);
    if (input.name && input.name !== existing.name) {
      const dup = await this.prisma.biometricDevice.findFirst({
        where: { companyId: user.companyId, name: input.name, id: { not: id } },
        select: { id: true },
      });
      if (dup) throw new ConflictException({ code: "duplicate_device_name", message: "A device with this name already exists" });
    }
    const updated = await this.prisma.biometricDevice.update({ where: { id }, data: input, select: deviceSelect });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "biometric.device_updated",
      entityType: "biometric_device", entityId: id, before: { name: existing.name, status: existing.status },
      after: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  async deleteDevice(user: RequestUser, id: string) {
    const existing = await this.deviceOf(user, id);
    await this.prisma.biometricDevice.delete({ where: { id } });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "biometric.device_deleted",
      entityType: "biometric_device", entityId: id, before: { name: existing.name },
    });
    return { deleted: true };
  }

  // ── Mappings ───────────────────────────────────────────────────

  async listMappings(user: RequestUser, deviceId: string) {
    await this.deviceOf(user, deviceId);
    return this.prisma.biometricMapping.findMany({
      where: { deviceId },
      select: {
        id: true, deviceUserId: true, createdAt: true,
        employee: { select: { id: true, fullName: true, employeeCode: true, employmentStatus: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createMapping(user: RequestUser, deviceId: string, input: BiometricMappingInput) {
    await this.deviceOf(user, deviceId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, companyId: user.companyId },
      select: { id: true, fullName: true },
    });
    if (!employee) throw new BadRequestException({ code: "no_employee", message: "Employee not found in this company" });

    const conflict = await this.prisma.biometricMapping.findFirst({
      where: {
        deviceId,
        OR: [{ deviceUserId: input.deviceUserId }, { employeeId: input.employeeId }],
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException({ code: "mapping_conflict", message: "This device user or employee is already mapped on this device" });
    }

    let mapping;
    try {
      mapping = await this.prisma.biometricMapping.create({
        data: { deviceId, deviceUserId: input.deviceUserId, employeeId: input.employeeId },
        select: { id: true, deviceUserId: true, createdAt: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({ code: "mapping_conflict", message: "This device user or employee is already mapped on this device" });
      }
      throw e;
    }
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "biometric.mapping_created",
      entityType: "biometric_mapping", entityId: mapping.id,
      after: { deviceId, deviceUserId: input.deviceUserId, employeeId: input.employeeId },
    });
    return mapping;
  }

  async deleteMapping(user: RequestUser, deviceId: string, mappingId: string) {
    await this.deviceOf(user, deviceId);
    const mapping = await this.prisma.biometricMapping.findFirst({
      where: { id: mappingId, deviceId },
      select: { id: true, deviceUserId: true },
    });
    if (!mapping) throw new NotFoundException({ code: "not_found", message: "Mapping not found" });
    await this.prisma.biometricMapping.delete({ where: { id: mappingId } });
    await this.audit.log({
      companyId: user.companyId, actorId: user.userId, action: "biometric.mapping_deleted",
      entityType: "biometric_mapping", entityId: mappingId, before: { deviceUserId: mapping.deviceUserId },
    });
    return { deleted: true };
  }
}
