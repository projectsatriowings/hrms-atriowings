import { Global, Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";

/**
 * Global so LeaveService and PayrollService can inject NotificationService
 * without edits to their feature modules. Depends on MailerModule (also
 * global) for the actual SMTP transport.
 */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
