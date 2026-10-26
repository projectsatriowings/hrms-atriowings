import { PayrollService } from "./payroll.service";

const USER: any = { userId: "md1", companyId: "c1", role: "md", email: "md@example.com", employeeId: null };

function makeService(notify: jest.Mock) {
  const auditLog = jest.fn(async () => undefined);
  const period = { id: "p1", companyId: "c1", year: 2026, month: 9, status: "draft" };
  const prisma: any = {
    payrollPeriod: {
      findFirst: jest.fn(async () => period),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    payrollRecord: { updateMany: jest.fn(async () => ({})) },
  };
  const svc = new PayrollService(prisma, { log: auditLog } as never, { notifyPayrollTransition: notify } as never);
  return { svc, notify };
}

describe("payroll transition notification call sites", () => {
  test("submit notifies HR/MD with status submitted", async () => {
    const notify = jest.fn(async () => undefined);
    const { svc } = makeService(notify);
    await svc.submit(USER, "p1");
    expect(notify).toHaveBeenCalledWith({ companyId: "c1", year: 2026, month: 9, status: "submitted" });
  });

  test("approve notifies HR/MD with status approved", async () => {
    const notify = jest.fn(async () => undefined);
    const { svc } = makeService(notify);
    await svc.approve(USER, "p1");
    expect(notify).toHaveBeenCalledWith({ companyId: "c1", year: 2026, month: 9, status: "approved" });
  });

  test("finalize notifies HR/MD with status finalized", async () => {
    const notify = jest.fn(async () => undefined);
    const { svc } = makeService(notify);
    await svc.finalize(USER, "p1");
    expect(notify).toHaveBeenCalledWith({ companyId: "c1", year: 2026, month: 9, status: "finalized" });
  });

  test("a notification failure never fails the transition", async () => {
    const notify = jest.fn(async () => { throw new Error("smtp down"); });
    const { svc } = makeService(notify);
    await expect(svc.submit(USER, "p1")).resolves.toMatchObject({ id: "p1" });
  });
});
