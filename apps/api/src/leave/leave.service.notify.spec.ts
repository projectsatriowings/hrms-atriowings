import { LeaveService } from "./leave.service";

jest.mock("@nestjs/schedule", () => ({ Cron: () => () => undefined }));

const HR_USER: any = { userId: "hr1", companyId: "c1", role: "hr", email: "hr@example.com", employeeId: null };

function makeDecideService(notify: jest.Mock) {
  const auditLog = jest.fn(async () => undefined);
  const tx: any = {
    leaveRequest: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ id: "lr1", status: "approved" })),
    },
    attendanceRecord: { findMany: jest.fn(async () => []), upsert: jest.fn(async () => ({})) },
    leaveLedger: {
      findMany: jest.fn(async () => [{ deltaDays: 10 }]),
      create: jest.fn(async (args: any) => args.data),
    },
  };
  const prisma: any = {
    attendancePolicy: { findFirst: jest.fn(async () => null) },
    holiday: { findMany: jest.fn(async () => []) },
    leaveRequest: {
      findFirst: jest.fn(async () => ({
        id: "lr1", employeeId: "e1", status: "pending", days: 2,
        employee: { id: "e1", fullName: "Asha", workEmail: "asha@example.com" },
        leaveType: { code: "CL", name: "Casual Leave" },
        fromDate: new Date("2026-05-04T00:00:00Z"),
        toDate: new Date("2026-05-05T00:00:00Z"),
      })),
      update: jest.fn(async (args: any) => ({ id: "lr1", ...args.data })),
    },
    $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(tx)),
  };
  const svc = new LeaveService(prisma, { log: auditLog } as never, { notifyLeaveDecided: notify } as never);
  return { svc, notify };
}

describe("leave decide() notification call sites", () => {
  test("rejected decision notifies the requesting employee", async () => {
    const notify = jest.fn(async () => undefined);
    const { svc } = makeDecideService(notify);
    await svc.decide(HR_USER, "lr1", { decision: "rejected", comment: "No cover" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "c1",
      employeeEmail: "asha@example.com",
      decision: "rejected",
      comment: "No cover",
    }));
  });

  test("approved decision notifies the requesting employee", async () => {
    const notify = jest.fn(async () => undefined);
    const { svc } = makeDecideService(notify);
    await svc.decide(HR_USER, "lr1", { decision: "approved" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      employeeEmail: "asha@example.com",
      decision: "approved",
    }));
  });

  test("a notification failure never fails the decision", async () => {
    const notify = jest.fn(async () => { throw new Error("smtp down"); });
    const { svc } = makeDecideService(notify);
    await expect(svc.decide(HR_USER, "lr1", { decision: "rejected" })).resolves.toMatchObject({ id: "lr1" });
  });
});
