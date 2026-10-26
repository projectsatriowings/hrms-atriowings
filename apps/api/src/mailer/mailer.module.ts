import { Global, Module } from "@nestjs/common";
import { MailerService } from "./mailer.service";

/**
 * Global so AuthService, LeaveService and PayrollService can inject
 * MailerService/NotificationService without edits to their feature modules.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
