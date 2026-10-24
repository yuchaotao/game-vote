import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

export type Mail = { to: string; subject: string; text: string; html?: string };

let transporter: Transporter | undefined;

/**
 * Sends an email via SMTP. Without SMTP configured (local development) the
 * message is printed to the server log instead.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (!e.SMTP_HOST) {
    console.log(
      `[mail] SMTP not configured; would send to ${mail.to}: ${mail.subject}\n${mail.text}`,
    );
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({ from: e.MAIL_FROM ?? e.SMTP_USER, ...mail });
}
