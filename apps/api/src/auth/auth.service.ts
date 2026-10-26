import { HttpException, HttpStatus, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit.service";
import { MailerService } from "../mailer/mailer.service";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import type { AuthUser } from "@hrms/shared";

const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 30 * 24 * 3600);
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MFA_TOKEN_TTL_SECONDS = 5 * 60;
const SESSION_PURGE_AGE_MS = 30 * 24 * 3600 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

function generateRecoveryCodes(): string[] {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    let code = "";
    for (let j = 0; j < 10; j++) code += chars[randomBytes(1)[0] % chars.length];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

const unauth = (code: string, message: string) => new UnauthorizedException({ code, message });

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    // Optional so direct `new AuthService(prisma, jwt, audit)` construction
    // in tests keeps working; Nest injects the global MailerService in prod.
    @Optional() private mailer?: MailerService,
  ) {}

  private toAuthUser(user: {
    id: string; email: string; role: string; companyId: string; employeeId: string | null;
    company: { name: string; timezone: string }; employee: { fullName: string } | null;
  }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role as AuthUser["role"],
      companyId: user.companyId,
      companyName: user.company.name,
      companyTimezone: user.company.timezone,
      employeeId: user.employeeId,
      employeeName: user.employee?.fullName ?? null,
    };
  }

  private signAccess(user: { id: string; companyId: string; role: string; email: string; employeeId: string | null }) {
    // jti makes every access token unique even when minted in the same second
    // (JWT iat has 1-second resolution, so two same-second tokens with identical
    // claims would otherwise be byte-identical strings).
    return this.jwt.sign(
      { sub: user.id, companyId: user.companyId, role: user.role, email: user.email, employeeId: user.employeeId, jti: randomBytes(16).toString("hex") },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL },
    );
  }

  private async issueSession(user: {
    id: string; email: string; role: string; companyId: string; employeeId: string | null;
    company: { name: string; timezone: string }; employee: { fullName: string } | null;
  }, ip?: string) {
    const refreshToken = randomBytes(48).toString("hex");
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
        ip,
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit.log({ companyId: user.companyId, actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, ip });
    return { accessToken: this.signAccess(user), refreshToken, user: this.toAuthUser(user) };
  }

  private signMfaToken(userId: string): string {
    return this.jwt.sign(
      { sub: userId, purpose: "mfa-challenge" },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: MFA_TOKEN_TTL_SECONDS },
    );
  }

  async login(email: string, password: string, companyCode?: string, ip?: string) {
    // Email is globally unique (see schema: User.email @unique), so a
    // single lookup by email is unambiguous across companies — the old
    // findFirst-by-email could silently pick the wrong tenant's account
    // if the same email ever existed in two companies.
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { company: true, employee: { select: { fullName: true } } },
    });
    // Only active users may log in; inactive/invited/disabled accounts
    // are indistinguishable from nonexistent ones.
    if (!user || user.status !== "active") {
      throw unauth("invalid_credentials", "Invalid email or password");
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      // A locked account must not have its lock extended by probing:
      // failed attempts while already locked change nothing.
      if (!(user.lockedUntil && user.lockedUntil > new Date())) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            ...(failed >= MAX_FAILED_LOGINS ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
          },
        });
      }
      throw unauth("invalid_credentials", "Invalid email or password");
    }
    // Enumeration safety: a locked account gets exactly the same generic
    // 401 as a wrong password or a nonexistent email — never a distinct
    // account_locked code or 429. This check runs after password
    // verification and before every other post-auth branch (temp-password
    // expiry, companyCode) so a locked account cannot be distinguished
    // through any of them, whatever its other state is. The lock itself
    // is untouched here: it simply expires after 15 minutes.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw unauth("invalid_credentials", "Invalid email or password");
    }
    // Temporary (auto-created) passwords expire 7 days after issue.
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
      throw unauth(
        "temp_password_expired",
        "Your temporary password has expired. Ask HR or your MD to reset your password.",
      );
    }
    // Optional companyCode (the company's slug): mismatch is a hard 401.
    if (companyCode && companyCode !== user.company.slug && companyCode !== user.company.id) {
      throw unauth("company_mismatch", "Company code does not match this account");
    }
    // MFA step-up: correct password but no tokens yet — the caller must
    // complete POST /auth/mfa/verify with the short-lived mfaToken.
    if (user.mfaEnabled) {
      return { mfaRequired: true as const, mfaToken: this.signMfaToken(user.id) };
    }
    const issued = await this.issueSession(user, ip);
    return { ...issued, mustChangePassword: user.mustChangePassword };
  }

  /** Completes an MFA login challenge (TOTP code or one-time recovery code). */
  async verifyMfa(mfaToken: string, code: string, ip?: string) {
    let payload: { sub?: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw unauth("invalid_mfa_token", "MFA session expired. Please log in again.");
    }
    if (payload.purpose !== "mfa-challenge" || !payload.sub) {
      throw unauth("invalid_mfa_token", "MFA session expired. Please log in again.");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { company: true, employee: { select: { fullName: true } } },
    });
    if (!user || user.status !== "active" || !user.mfaEnabled || !user.mfaSecret) {
      throw unauth("invalid_mfa_token", "MFA session expired. Please log in again.");
    }
    let ok = false;
    try {
      const result = await verifyTotp({ secret: user.mfaSecret, token: code.trim() });
      ok = result.valid;
    } catch {
      // keep false: an unverifiable code is simply not valid
    }
    if (!ok) {
      // Recovery-code fallback: single use, SHA-256 hashed at rest.
      const codes = Array.isArray(user.mfaRecoveryCodes) ? (user.mfaRecoveryCodes as string[]) : [];
      const hashed = hashToken(normalizeRecoveryCode(code));
      const idx = codes.indexOf(hashed);
      if (idx >= 0) {
        codes.splice(idx, 1);
        await this.prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: codes } });
        ok = true;
      }
    }
    if (!ok) throw unauth("invalid_mfa_code", "Invalid MFA code");
    const issued = await this.issueSession(user, ip);
    return { ...issued, mustChangePassword: user.mustChangePassword };
  }

  /** TOTP setup step 1: returns a secret + otpauth URL. Nothing is stored yet. */
  async mfaSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauth("invalid_session", "Session expired.");
    const secret = generateSecret();
    const otpauthUrl = generateURI({ secret, issuer: "Attenza", label: user.email });
    return { secret, otpauthUrl };
  }

  /** TOTP setup step 2: a valid code stores the secret, enables MFA, and
   *  returns 10 one-time recovery codes (plaintext, shown once only). */
  async mfaVerifySetup(userId: string, secret: string, code: string) {
    let valid = false;
    try {
      valid = (await verifyTotp({ secret, token: code.trim() })).valid;
    } catch {
      // keep false: an unverifiable code is simply not valid
    }
    if (!valid) throw unauth("invalid_mfa_code", "Invalid MFA code");
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaSecret: secret,
        mfaRecoveryCodes: recoveryCodes.map((c) => hashToken(normalizeRecoveryCode(c))),
      },
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.audit.log({ companyId: user.companyId, actorId: userId, action: "auth.mfa_enabled", entityType: "user", entityId: userId });
    }
    return { recoveryCodes };
  }

  /** Disable MFA: requires the account password plus a valid TOTP code. */
  async mfaDisable(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw unauth("invalid_credentials", "Invalid password");
    }
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new HttpException({ code: "mfa_not_enabled", message: "MFA is not enabled" }, HttpStatus.BAD_REQUEST);
    }
    let valid = false;
    try {
      valid = (await verifyTotp({ secret: user.mfaSecret, token: code.trim() })).valid;
    } catch {
      // keep false: an unverifiable code is simply not valid
    }
    if (!valid) throw unauth("invalid_mfa_code", "Invalid MFA code");
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });
    await this.audit.log({ companyId: user.companyId, actorId: userId, action: "auth.mfa_disabled", entityType: "user", entityId: userId });
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentRefreshToken?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauth("invalid_session", "Session expired.");
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw unauth("invalid_credentials", "Current password is incorrect");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword), mustChangePassword: false, tempPasswordExpiresAt: null },
    });
    // Revoke ALL other sessions; keep the session this request came from.
    if (currentRefreshToken) {
      await this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null, NOT: { refreshTokenHash: hashToken(currentRefreshToken) } },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ companyId: user.companyId, actorId: userId, action: "auth.password_changed", entityType: "user", entityId: userId });
    return { ok: true };
  }

  /**
   * Forgot password: always creates a token for an existing active user, but
   * never reveals whether the email exists. When the mailer is configured
   * (SMTP_HOST + SMTP_FROM), a real reset email is sent containing the
   * reset link for the token just created (valid 1 hour, same token the
   * reset-password endpoint verifies). Returns `emailConfigured: false`
   * when no SMTP is configured — the controller then answers 503 telling
   * the user to ask HR for a reset. Token generation/security semantics
   * are unchanged; a delivery failure is logged, not surfaced, so the
   * response never leaks account existence or mailer state.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), status: "active" },
    });
    if (!user) return { emailConfigured: true };
    const token = randomBytes(32).toString("hex");
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: new Date(Date.now() + 3600 * 1000) },
    });
    const emailConfigured = this.mailer
      ? this.mailer.isConfigured()
      : Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
    if (emailConfigured && this.mailer) {
      const base = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const resetLink = `${base}/reset-password?token=${token}`;
      try {
        await this.mailer.sendMail({
          to: user.email,
          subject: "Attenza: reset your password",
          text: [
            `You requested a password reset for your Attenza account.`,
            ``,
            `Reset your password here (link expires in 1 hour): ${resetLink}`,
            ``,
            `If you did not request this, you can ignore this email — your password is unchanged.`,
          ].join("\n"),
          html: `<p>You requested a password reset for your Attenza account.</p><p><a href="${resetLink}">Reset your password</a> (link expires in 1 hour).</p><p>If you did not request this, you can ignore this email — your password is unchanged.</p>`,
        });
      } catch (err) {
        console.warn("[auth] failed to send password-reset email:", err instanceof Error ? err.message : err);
      }
    } else if (emailConfigured) {
      // Mailer env is set but no MailerService was injected (e.g. direct
      // construction in tests): same warning as before this wiring landed.
      console.warn("[auth] SMTP configured but no mailer transport is wired; reset token created but not delivered");
    }
    return { emailConfigured };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { passwordResetTokenHash: hashToken(token) } });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw unauth("invalid_reset_token", "Reset link is invalid or has expired");
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(newPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ companyId: user.companyId, actorId: user.id, action: "auth.password_reset", entityType: "user", entityId: user.id });
    return { ok: true };
  }

  async refresh(refreshToken: string, ip?: string) {
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { user: { include: { company: true, employee: { select: { fullName: true } } } } },
    });
    // Refresh-token reuse detection: a token whose session was already
    // rotated out or logged out must never work again. If it reappears, the
    // token family is compromised — revoke EVERY session for that user.
    if (session && session.revokedAt) {
      await this.prisma.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({ companyId: session.user.companyId, actorId: session.userId, action: "auth.refresh_reused", entityType: "user", entityId: session.userId, ip });
      throw unauth("refresh_token_reused", "Session expired. Please log in again.");
    }
    if (!session || session.expiresAt < new Date() || session.user.status !== "active") {
      throw unauth("invalid_session", "Session expired. Please log in again.");
    }
    // Rotation: revoke old, issue new
    const newRefresh = randomBytes(48).toString("hex");
    await this.prisma.$transaction([
      this.prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
      this.prisma.authSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: hashToken(newRefresh),
          expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
          ip,
        },
      }),
    ]);
    return { accessToken: this.signAccess(session.user), refreshToken: newRefresh, user: this.toAuthUser(session.user) };
  }

  async logout(refreshToken: string | undefined, userId: string) {
    if (refreshToken) {
      await this.prisma.authSession.updateMany({
        where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.audit.log({ companyId: user.companyId, actorId: userId, action: "auth.logout", entityType: "user", entityId: userId });
    }
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { company: true, employee: { select: { fullName: true } } },
    });
    if (!user) throw new UnauthorizedException({ code: "invalid_session", message: "Session expired." });
    return this.toAuthUser(user);
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  /** B7: nightly purge of expired/revoked sessions older than 30 days. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredSessions() {
    const cutoff = new Date(Date.now() - SESSION_PURGE_AGE_MS);
    const result = await this.prisma.authSession.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    });
    return { deleted: result.count };
  }
}
