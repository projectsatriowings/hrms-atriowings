import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MailerService } from "../mailer/mailer.service";

export interface LeaveDecisionNotification {
  companyId: string;
  employeeEmail: string | null | undefined;
  employeeName: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  decision: "approved" | "rejected";
  comment?: string | null;
}

export type PayrollTransitionStatus = "submitted" | "approved" | "finalized";

export interface PayrollTransitionNotification {
  companyId: string;
  year: number;
  month: number;
  status: PayrollTransitionStatus;
}

/**
 * Transactional email notifications, sent via MailerService.
 *
 * BEST-EFFORT CONTRACT: every public method catches its own failures
 * (mailer unconfigured, SMTP error, recipient lookup error) and only logs
 * them. A notification failure must NEVER fail the business transaction
 * that triggered it — leave decisions and payroll transitions commit
 * regardless of whether the email went out. Call sites additionally wrap
 * the call in try/catch as belt-and-braces.
 *
 * All recipient lookups are company-scoped: leave mail goes to the
 * requesting employee's work email; payroll mail goes to every ACTIVE
 * hr/md user in the same company.
 */
@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  private async sendSafe(to: string[], subject: string, text: string, context: string): Promise<void> {
    const recipients = [...new Set(to.map((t) => t?.trim().toLowerCase()).filter(Boolean))];
    if (recipients.length === 0) return;
    try {
      if (!this.mailer.isConfigured()) return;
      await this.mailer.sendMail({ to: recipients, subject, text });
    } catch (err) {
      console.warn(`[notifications] failed to send ${context} email to ${recipients.join(", ")}:`, err instanceof Error ? err.message : err);
    }
  }

  async notifyLeaveDecided(input: LeaveDecisionNotification): Promise<void> {
    if (!input.employeeEmail) return;
    const verdict = input.decision === "approved" ? "approved" : "rejected";
    const subject = `Attenza: your leave request was ${verdict}`;
    const lines = [
      `Hi ${input.employeeName},`,
      ``,
      `Your leave request (${input.leaveTypeName}, ${input.fromDate} to ${input.toDate}) was ${verdict}.`,
      ...(input.comment ? [`Reviewer comment: ${input.comment}`] : []),
      ``,
      `— Attenza`,
    ];
    await this.sendSafe([input.employeeEmail], subject, lines.join("\n"), "leave-decision");
  }

  async notifyPayrollTransition(input: PayrollTransitionNotification): Promise<void> {
    let recipients: { email: string }[];
    try {
      recipients = await this.prisma.user.findMany({
        where: { companyId: input.companyId, role: { in: ["hr", "md"] }, status: "active" },
        select: { email: true },
      });
    } catch (err) {
      console.warn(`[notifications] failed to look up HR/MD recipients for payroll ${input.status}:`, err instanceof Error ? err.message : err);
      return;
    }
    const label = `${input.year}-${String(input.month).padStart(2, "0")}`;
    const subject = `Attenza: payroll ${label} ${input.status}`;
    const text = [
      `Payroll for ${label} was ${input.status}.`,
      ``,
      `— Attenza`,
    ].join("\n");
    await this.sendSafe(recipients.map((r) => r.email), subject, text, `payroll-${input.status}`);
  }
}
