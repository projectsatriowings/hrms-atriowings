import { AuthService } from "./auth.service";

// Same Jest workarounds as auth.service.spec.ts (owned by the login worker):
// @nestjs/schedule and otplib ship ESM that Jest's CommonJS transform
// cannot parse; forgotPassword exercises neither.
jest.mock("@nestjs/schedule", () => ({ Cron: () => () => undefined, CronExpression: { EVERY_DAY_AT_3AM: "0 3 * * *" } }));
jest.mock("otplib", () => ({
  generate: jest.fn(),
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

/** Mailer-workstream specs for forgotPassword only (no live DB, no SMTP). */

function makeService(mailer: { isConfigured: () => boolean; sendMail: jest.Mock<any, any> } | undefined) {
  const updates: any[] = [];
  const prisma: any = {
    user: {
      findFirst: jest.fn(async () => ({ id: "u1", email: "asha@example.com" })),
      update: jest.fn(async (args: any) => { updates.push(args.data); return args.data; }),
    },
  };
  const svc = new AuthService(prisma, {} as never, { log: jest.fn() } as never, mailer as never);
  return { svc, prisma, updates };
}

describe("forgotPassword mailer wiring", () => {
  const OLD_FRONTEND = process.env.FRONTEND_URL;
  beforeEach(() => { process.env.FRONTEND_URL = "https://hrms.example.test"; });
  afterEach(() => {
    if (OLD_FRONTEND === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = OLD_FRONTEND;
  });

  test("sends a real reset email with a reset link when the mailer is configured", async () => {
    const sendMail: jest.Mock<any, any> = jest.fn(async () => undefined);
    const { svc, updates } = makeService({ isConfigured: () => true, sendMail });
    const result = await svc.forgotPassword("asha@example.com");
    expect(result).toEqual({ emailConfigured: true });
    expect(updates).toHaveLength(1);
    // Token is created (hashed at rest, 1h expiry) — same semantics as before.
    expect(updates[0].passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("asha@example.com");
    expect(mail.subject).toContain("reset");
    // The link carries the raw token the reset endpoint verifies.
    expect(mail.text).toMatch(/https:\/\/hrms\.example\.test\/reset-password\?token=[0-9a-f]{64}/);
    expect(mail.html).toContain("/reset-password?token=");
  });

  test("returns emailConfigured:false and sends nothing when the mailer is not configured (controller → 503)", async () => {
    const sendMail: jest.Mock<any, any> = jest.fn(async () => undefined);
    const { svc, updates } = makeService({ isConfigured: () => false, sendMail });
    const result = await svc.forgotPassword("asha@example.com");
    expect(result).toEqual({ emailConfigured: false });
    expect(updates).toHaveLength(1); // token still created, delivery deferred
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("unknown email stays enumeration-safe: no send, emailConfigured:true", async () => {
    const sendMail: jest.Mock<any, any> = jest.fn(async () => undefined);
    const { svc, prisma, updates } = makeService({ isConfigured: () => true, sendMail });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    const result = await svc.forgotPassword("nobody@example.com");
    expect(result).toEqual({ emailConfigured: true });
    expect(updates).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("a delivery failure is logged, not thrown, and still reports configured", async () => {
    const sendMail: jest.Mock<any, any> = jest.fn(async () => { throw new Error("smtp down"); });
    const { svc } = makeService({ isConfigured: () => true, sendMail });
    await expect(svc.forgotPassword("asha@example.com")).resolves.toEqual({ emailConfigured: true });
  });
});
