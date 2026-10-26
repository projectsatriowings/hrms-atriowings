import * as argon2 from "argon2";
import { readFileSync } from "fs";
import { join } from "path";
import { AuthService } from "./auth.service";

// @nestjs/schedule ships ESM in its dist entry, which Jest's CommonJS
// transform cannot parse. The service only uses it for the @Cron decorator,
// so stub it: the decorator factory returns a no-op decorator.
jest.mock("@nestjs/schedule", () => ({ Cron: () => () => undefined, CronExpression: { EVERY_DAY_AT_3AM: "0 3 * * *" } }));

// otplib pulls in ESM-only @scure/base, which Jest's CommonJS transform
// cannot parse. Login tests never exercise TOTP, so stub the whole module.
jest.mock("otplib", () => ({
  generate: jest.fn(),
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

/**
 * Login/tenant fix + enumeration-safe lockout (fix-round task).
 *
 * Prisma is mocked (no live DB here): the schema/migration guarantees are
 * asserted against the actual file contents, and the login behaviour is
 * asserted against the service with a mocked Prisma client. A live-DB
 * check that the unique constraint rejects a second company reusing an
 * email is still pending for integration (see final report).
 */

const PASSWORD = "Correct@123";
let passwordHash = "";

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD);
});

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "karthik.n@atriowings.in",
    passwordHash,
    role: "employee",
    status: "active",
    companyId: "co1",
    employeeId: "e1",
    company: { id: "co1", name: "Atriowings Technologies", slug: "atriowings", timezone: "Asia/Kolkata" },
    employee: { fullName: "Karthik Narayanan" },
    mustChangePassword: false,
    tempPasswordExpiresAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    ...overrides,
  };
}

function makeService(user: Record<string, unknown> | null) {
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async () => ({})),
    },
    authSession: { create: jest.fn(async () => ({})) },
  };
  const jwt: any = { sign: jest.fn(() => "access-token") };
  const audit: any = { log: jest.fn(async () => undefined) };
  const svc = new AuthService(prisma, jwt, audit);
  return { svc, prisma };
}

/** Extracts the { status, body } a Nest exception produces over HTTP. */
function httpOf(err: any) {
  return { status: typeof err.getStatus === "function" ? err.getStatus() : null, body: err.getResponse?.() };
}

describe("login by globally-unique email", () => {
  test("login without a companyCode succeeds (single-company path)", async () => {
    const { svc, prisma } = makeService(makeUser());
    const res: any = await svc.login("karthik.n@atriowings.in", PASSWORD);
    expect(res.accessToken).toBe("access-token");
    expect(res.user.email).toBe("karthik.n@atriowings.in");
    // Unambiguous lookup: findUnique by email alone, never findFirst
    // (findFirst could return another tenant's row for a duplicate email).
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "karthik.n@atriowings.in" } }),
    );
    expect(prisma.user.findUnique.mock.calls[0][0].where).not.toHaveProperty("companyId");
  });

  test("login with the correct companyCode (slug) succeeds", async () => {
    const { svc } = makeService(makeUser());
    const res: any = await svc.login("karthik.n@atriowings.in", PASSWORD, "atriowings");
    expect(res.accessToken).toBe("access-token");
  });

  test("login with a wrong companyCode fails 401", async () => {
    const { svc } = makeService(makeUser());
    await expect(svc.login("karthik.n@atriowings.in", PASSWORD, "other-company")).rejects.toMatchObject({});
    try {
      await svc.login("karthik.n@atriowings.in", PASSWORD, "other-company");
      throw new Error("should have thrown");
    } catch (err: any) {
      const { status, body } = httpOf(err);
      expect(status).toBe(401);
      expect(body.code).toBe("company_mismatch");
    }
  });

  test("email lookup is case/whitespace-insensitive", async () => {
    const { svc, prisma } = makeService(makeUser());
    await svc.login("  KARTHIK.N@atriowings.in ", PASSWORD);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "karthik.n@atriowings.in" } }),
    );
  });
});

describe("enumeration-safe lockout", () => {
  test("locked account with the CORRECT password gets generic 401 invalid_credentials", async () => {
    const locked = makeUser({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    const { svc, prisma } = makeService(locked);
    try {
      await svc.login("karthik.n@atriowings.in", PASSWORD);
      throw new Error("should have thrown");
    } catch (err: any) {
      const { status, body } = httpOf(err);
      expect(status).toBe(401);
      expect(body).toEqual({ code: "invalid_credentials", message: "Invalid email or password" });
    }
    // No session issued, lock untouched (it simply expires).
    expect(prisma.authSession.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("locked / wrong-password / nonexistent responses are indistinguishable", async () => {
    const locked = makeUser({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    const unlocked = makeUser();
    const cases: { status: number; body: unknown }[] = [];
    for (const [user, password] of [
      [locked, PASSWORD],
      [locked, "Wrong@123"],
      [unlocked, "Wrong@123"],
      [null, "Wrong@123"],
    ] as const) {
      const { svc } = makeService(user);
      try {
        await svc.login("karthik.n@atriowings.in", password);
        throw new Error("should have thrown");
      } catch (err: any) {
        cases.push(httpOf(err));
      }
    }
    for (const c of cases) {
      expect(c.status).toBe(401);
      expect(c.body).toEqual({ code: "invalid_credentials", message: "Invalid email or password" });
    }
    // In particular: no distinct account_locked code and no 429 anywhere.
    expect(JSON.stringify(cases)).not.toContain("account_locked");
    expect(cases.map((c) => c.status)).not.toContain(429);
  });

  test("wrong password while locked does not extend the lock", async () => {
    const locked = makeUser({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000), failedLoginCount: 5 });
    const { svc, prisma } = makeService(locked);
    await expect(svc.login("karthik.n@atriowings.in", "Wrong@123")).rejects.toBeTruthy();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("lockout mechanics kept: 5th failed login sets a ~15-minute lock; 4th does not", async () => {
    const before = Date.now();
    const fourth = makeUser({ failedLoginCount: 3 });
    const { svc: svc4, prisma: prisma4 } = makeService(fourth);
    await expect(svc4.login("karthik.n@atriowings.in", "Wrong@123")).rejects.toBeTruthy();
    expect(prisma4.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginCount: 4 }) }),
    );
    expect(prisma4.user.update.mock.calls[0][0].data).not.toHaveProperty("lockedUntil");

    const fifth = makeUser({ failedLoginCount: 4 });
    const { svc: svc5, prisma: prisma5 } = makeService(fifth);
    await expect(svc5.login("karthik.n@atriowings.in", "Wrong@123")).rejects.toBeTruthy();
    const data = prisma5.user.update.mock.calls[0][0].data;
    expect(data.failedLoginCount).toBe(5);
    expect(data.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + 14 * 60 * 1000);
    expect(data.lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });

  test("expired lock no longer blocks login", async () => {
    const { svc } = makeService(makeUser({ lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 5 }));
    const res: any = await svc.login("karthik.n@atriowings.in", PASSWORD);
    expect(res.accessToken).toBe("access-token");
  });
});

describe("schema + migration level: same email cannot exist in two companies", () => {
  // __dirname = apps/api/src/auth → ../../prisma
  const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf-8");
  const migration = readFileSync(
    join(__dirname, "../../prisma/migrations/20261025210000_user_email_global_unique/migration.sql"),
    "utf-8",
  );
  const serviceSrc = readFileSync(join(__dirname, "auth.service.ts"), "utf-8");

  test("User.email is globally unique in the schema", () => {
    const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("model AuthSession"));
    expect(userModel).toMatch(/email\s+String\s+@unique/);
    expect(userModel).not.toContain("@@unique([companyId, email])");
  });

  test("migration drops the composite unique index and adds a unique index on email", () => {
    expect(migration).toContain('DROP INDEX "User_companyId_email_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "User_email_key" ON "User"("email")');
  });

  test("no account_locked response remains in the login path", () => {
    // (The word appears in an explanatory comment; what must be gone is
    // an actual response carrying that code, and the 429 status.)
    expect(serviceSrc).not.toContain('code: "account_locked"');
    expect(serviceSrc).not.toContain("HttpStatus.TOO_MANY_REQUESTS");
  });
});
