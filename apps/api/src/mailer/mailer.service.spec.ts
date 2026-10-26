import { createTransport } from "nodemailer";
import { MailerService } from "./mailer.service";

/** Capture transport: nodemailer stream transport buffers the MIME message
 * instead of delivering it — no real mailbox or credentials involved. */
function captureMailer() {
  const sent: { to: unknown; subject: unknown; message: string }[] = [];
  const transport = createTransport({ streamTransport: true, newline: "unix", buffer: true });
  const origSend = transport.sendMail.bind(transport);
  const capturing = {
    sendMail: jest.fn(async (mail: { to: unknown; subject: unknown; text?: string; html?: string }) => {
      const info = await origSend(mail as never);
      const message = info.message as unknown;
      sent.push({ to: mail.to, subject: mail.subject, message: Buffer.isBuffer(message) ? message.toString() : String(message) });
      return info;
    }),
  };
  return { sent, service: new MailerService(capturing as never) };
}

describe("MailerService (stream/capture transport, no real SMTP)", () => {
  const OLD_HOST = process.env.SMTP_HOST;
  const OLD_FROM = process.env.SMTP_FROM;
  afterEach(() => {
    if (OLD_HOST === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = OLD_HOST;
    if (OLD_FROM === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = OLD_FROM;
  });

  test("isConfigured() is true with an injected transport and sends a buffered message", async () => {
    const { sent, service } = captureMailer();
    expect(service.isConfigured()).toBe(true);
    await service.sendMail({ to: "asha@example.com", subject: "Hello", text: "body text" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("asha@example.com");
    expect(sent[0].subject).toBe("Hello");
    expect(sent[0].message).toContain("body text");
  });

  test("isConfigured() is false without a transport and without SMTP env", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    expect(new MailerService().isConfigured()).toBe(false);
  });

  test("isConfigured() is true from env alone (host + from)", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "noreply@example.test";
    expect(new MailerService().isConfigured()).toBe(true);
  });

  test("sendMail() rejects with email_not_configured when unconfigured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    await expect(new MailerService().sendMail({ to: "a@b.c", subject: "x", text: "y" }))
      .rejects.toThrow("email_not_configured");
  });
});
