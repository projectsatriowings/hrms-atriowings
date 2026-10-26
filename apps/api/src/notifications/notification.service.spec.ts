import { NotificationService } from "./notification.service";

function makeService(opts: { configured?: boolean; sendImpl?: (mail: never) => Promise<unknown>; users?: { email: string }[] | Error } = {}) {
  const sent: { to: unknown; subject: unknown; text: unknown }[] = [];
  const mailer = {
    isConfigured: jest.fn(() => opts.configured ?? true),
    sendMail: jest.fn(async (mail: never) => {
      if (opts.sendImpl) return opts.sendImpl(mail);
      sent.push(mail as unknown as { to: unknown; subject: unknown; text: unknown });
      return undefined;
    }),
  };
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => {
        if (opts.users instanceof Error) throw opts.users;
        return opts.users ?? [{ email: "hr@example.com" }, { email: "md@example.com" }];
      }),
    },
  };
  return { service: new NotificationService(prisma, mailer as never), sent, mailer, prisma };
}

describe("NotificationService (capture mailer, no real SMTP)", () => {
  test("leave approved notifies the requesting employee", async () => {
    const { service, sent } = makeService();
    await service.notifyLeaveDecided({
      companyId: "c1", employeeEmail: "asha@example.com", employeeName: "Asha",
      leaveTypeName: "Casual Leave", fromDate: "2026-05-04", toDate: "2026-05-05",
      decision: "approved",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["asha@example.com"]);
    expect(sent[0].subject).toContain("approved");
    expect(sent[0].text).toContain("Casual Leave");
  });

  test("leave rejected includes the reviewer comment", async () => {
    const { service, sent } = makeService();
    await service.notifyLeaveDecided({
      companyId: "c1", employeeEmail: "asha@example.com", employeeName: "Asha",
      leaveTypeName: "Casual Leave", fromDate: "2026-05-04", toDate: "2026-05-05",
      decision: "rejected", comment: "No cover that week",
    });
    expect(sent[0].subject).toContain("rejected");
    expect(sent[0].text).toContain("No cover that week");
  });

  test("leave decision with no employee email sends nothing and does not throw", async () => {
    const { service, sent } = makeService();
    await expect(service.notifyLeaveDecided({
      companyId: "c1", employeeEmail: null, employeeName: "Asha",
      leaveTypeName: "Casual Leave", fromDate: "2026-05-04", toDate: "2026-05-05",
      decision: "approved",
    })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  test("unconfigured mailer sends nothing and does not throw", async () => {
    const { service, sent } = makeService({ configured: false });
    await expect(service.notifyLeaveDecided({
      companyId: "c1", employeeEmail: "asha@example.com", employeeName: "Asha",
      leaveTypeName: "Casual Leave", fromDate: "2026-05-04", toDate: "2026-05-05",
      decision: "approved",
    })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  test("SMTP failure is swallowed, never thrown", async () => {
    const { service } = makeService({ sendImpl: async () => { throw new Error("smtp down"); } });
    await expect(service.notifyLeaveDecided({
      companyId: "c1", employeeEmail: "asha@example.com", employeeName: "Asha",
      leaveTypeName: "Casual Leave", fromDate: "2026-05-04", toDate: "2026-05-05",
      decision: "approved",
    })).resolves.toBeUndefined();
  });

  test("payroll transition notifies all active HR/MD users in the same company", async () => {
    const { service, sent, prisma } = makeService();
    await service.notifyPayrollTransition({ companyId: "c1", year: 2026, month: 9, status: "submitted" });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: "c1", role: { in: ["hr", "md"] }, status: "active" },
      select: { email: true },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["hr@example.com", "md@example.com"]);
    expect(sent[0].subject).toContain("2026-09");
    expect(sent[0].subject).toContain("submitted");
  });

  test("payroll transition with no HR/MD recipients sends nothing", async () => {
    const { service, sent } = makeService({ users: [] });
    await service.notifyPayrollTransition({ companyId: "c1", year: 2026, month: 9, status: "finalized" });
    expect(sent).toHaveLength(0);
  });

  test("payroll recipient lookup failure is swallowed", async () => {
    const { service, sent } = makeService({ users: new Error("db down") });
    await expect(service.notifyPayrollTransition({ companyId: "c1", year: 2026, month: 9, status: "approved" }))
      .resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});
