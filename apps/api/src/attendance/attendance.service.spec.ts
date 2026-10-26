import { createHash } from "node:crypto";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceService } from "./attendance.service";

// Same @nestjs/schedule ESM stub as leave.service.spec.ts: Jest's CommonJS
// transform cannot parse the schedule dist entry, and the service only uses
// it for the @Cron decorator.
jest.mock("@nestjs/schedule", () => ({ Cron: () => () => undefined }));

const DEVICE_KEY = "hrms_bm_dev1_abc";
const DEVICE_ID = "dev1";

type PunchCreate = {
  deviceId: string; deviceUserId: string; timestamp: Date;
  type: string; recordId: string; lateSync: boolean;
};

/** Service with a mocked Prisma layer for the biometricPunch path only. */
function makeService() {
  const punchCreates: PunchCreate[] = [];
  const auditLog = jest.fn().mockResolvedValue(undefined);
  const record = { id: "rec1", checkInAt: null as Date | null, checkOutAt: null as Date | null, status: "present" };
  const prisma = {
    biometricDevice: {
      findFirst: jest.fn(async () => ({
        id: DEVICE_ID,
        status: "active",
        apiKeyHash: createHash("sha256").update(DEVICE_KEY).digest("hex"),
        companyId: "c1",
        company: { id: "c1", timezone: "Asia/Kolkata" },
      })),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    biometricMapping: {
      findUnique: jest.fn(async () => ({
        deviceId: DEVICE_ID,
        deviceUserId: "u1",
        employee: { id: "e1", employmentStatus: "active" },
      })),
    },
    biometricPunch: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (args: { data: PunchCreate }) => { punchCreates.push(args.data); return args.data; }),
    },
    leaveRequest: { findFirst: jest.fn(async () => null) },
    attendanceRecord: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (args: { data: { checkInAt: Date } }) => ({ ...record, checkInAt: args.data.checkInAt, source: "biometric" })),
    },
    attendancePolicy: { findFirst: jest.fn(async () => null) },
  };
  const svc = new AttendanceService(prisma as unknown as PrismaService, { log: auditLog } as unknown as AuditService);
  return { svc, punchCreates, auditLog };
}

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

describe("biometricPunch acceptance window (7-day late sync)", () => {
  test("a 3-day-old punch is accepted with the late-sync flag + audit note", async () => {
    const { svc, punchCreates, auditLog } = makeService();
    const res = await svc.biometricPunch(DEVICE_KEY, {
      deviceUserId: "u1",
      timestamp: isoAgo(3 * 24 * 3600_000),
      type: "in",
    });
    expect(res.checkInAt).toBeTruthy();
    expect(punchCreates).toHaveLength(1);
    expect(punchCreates[0]).toMatchObject({ lateSync: true });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "attendance.biometric_late_sync",
      after: expect.objectContaining({ lateSync: true }),
    }));
  });

  test("a punch within 24h is accepted without the late-sync flag", async () => {
    const { svc, punchCreates, auditLog } = makeService();
    await svc.biometricPunch(DEVICE_KEY, {
      deviceUserId: "u1",
      timestamp: isoAgo(60 * 60_000),
      type: "in",
    });
    expect(punchCreates[0]).toMatchObject({ lateSync: false });
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("an 8-day-old punch is rejected", async () => {
    const { svc } = makeService();
    await expect(svc.biometricPunch(DEVICE_KEY, {
      deviceUserId: "u1",
      timestamp: isoAgo(8 * 24 * 3600_000),
      type: "in",
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: "bad_timestamp" }) });
  });

  test("a future punch is rejected", async () => {
    const { svc } = makeService();
    await expect(svc.biometricPunch(DEVICE_KEY, {
      deviceUserId: "u1",
      timestamp: new Date(Date.now() + 60 * 60_000).toISOString(),
      type: "in",
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: "bad_timestamp" }) });
  });
});
