import { Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { EmployeesModule } from "./employees/employees.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { BiometricModule } from "./biometric/biometric.module";
import { LeaveModule } from "./leave/leave.module";
import { PayrollModule } from "./payroll/payroll.module";
import { BillingModule } from "./billing/billing.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ReportsModule } from "./reports/reports.module";
import { AdminModule } from "./admin/admin.module";
import { HealthModule } from "./health/health.module";
import { MailerModule } from "./mailer/mailer.module";
import { NotificationsModule } from "./notifications/notifications.module";

/**
 * Fail-closed secrets (security review A14/B6). The API must not boot with a
 * missing or known-default JWT access secret, and in production it must not
 * boot without a valid bank-encryption key. There are deliberately NO
 * fallback secret strings anywhere in the API source.
 *
 * NOTE on JWT_REFRESH_SECRET: verified dead — the refresh flow uses opaque
 * random tokens (randomBytes + SHA-256 hash, see auth.service.ts), and no
 * code anywhere reads JWT_REFRESH_SECRET. It is therefore NOT enforced here
 * and was removed from .env.example; enforcing a dead variable would only
 * create false startup failures.
 */
const KNOWN_DEFAULT_ACCESS_SECRETS = new Set([
  "dev-access-secret-change-me",
  "change-me",
  "dev-secret",
  "test-secret",
]);
function assertSecretsOrFail() {
  const access = process.env.JWT_ACCESS_SECRET;
  if (!access || KNOWN_DEFAULT_ACCESS_SECRETS.has(access)) {
    throw new Error("JWT_ACCESS_SECRET is missing or a known default value — refusing to start");
  }
  if (process.env.NODE_ENV === "production") {
    const bankKey = process.env.BANK_ENCRYPTION_KEY;
    if (!bankKey || !/^[0-9a-fA-F]{64}$/.test(bankKey)) {
      throw new Error("BANK_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters in production — refusing to start");
    }
  }
}
// Checked in onModuleInit (not at import time): ConfigModule loads .env
// during module instantiation, so import-time checks would false-fail on
// plain `node dist/main` runs. onModuleInit still aborts bootstrap before
// the server ever listens, so the fail-closed guarantee holds.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: process.env.JWT_ACCESS_SECRET }),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    EmployeesModule,
    AttendanceModule,
    BiometricModule,
    LeaveModule,
    PayrollModule,
    BillingModule,
    DashboardModule,
    ReportsModule,
    AdminModule,
    HealthModule,
    MailerModule,
    NotificationsModule,
  ],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    assertSecretsOrFail();
  }
}
