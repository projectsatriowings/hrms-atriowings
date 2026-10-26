import { Inject, Injectable, Optional } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

/** DI token for an explicitly provided nodemailer transport. Production
 * wiring provides none, so the service builds one from env on first use.
 * Tests inject a stream/capture transport through this token (or pass it
 * directly to the constructor) so no real mailbox is ever touched. */
export const MAILER_TRANSPORTER = "MAILER_TRANSPORTER";

export interface SendMailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * SMTP mailer, configured ONLY by environment:
 *   SMTP_HOST, SMTP_PORT (default 587, 465 implies implicit TLS),
 *   SMTP_USER, SMTP_PASS, SMTP_FROM.
 * No credentials live in the repo. isConfigured() is true only when a host
 * and a from address are set; sendMail() throws `email_not_configured`
 * when it is not. Callers that must never fail a business transaction
 * (notifications, password-reset delivery) catch that error themselves —
 * see NotificationService, which swallows all mail failures.
 */
@Injectable()
export class MailerService {
  private transporter?: Transporter;

  constructor(@Optional() @Inject(MAILER_TRANSPORTER) injected?: Transporter) {
    this.transporter = injected;
  }

  isConfigured(): boolean {
    return Boolean(this.transporter ?? (process.env.SMTP_HOST && process.env.SMTP_FROM));
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const host = process.env.SMTP_HOST;
      const from = process.env.SMTP_FROM;
      if (!host || !from) throw new Error("email_not_configured");
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });
    }
    return this.transporter;
  }

  async sendMail(input: SendMailInput): Promise<void> {
    if (!this.isConfigured()) throw new Error("email_not_configured");
    const from = process.env.SMTP_FROM ?? "";
    await this.getTransporter().sendMail({ from, ...input });
  }
}
