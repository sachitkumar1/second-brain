import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import { getSettings } from "../settings";

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  return !!env.gmailAppPassword() || !!process.env.EMAIL_DUMP_DIR;
}

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.gmailSender(), pass: env.gmailAppPassword() },
  });
  return transporter;
}

/** Sends from the agent mailbox (GMAIL_SENDER) to the address in Settings unless `to` is given. */
export async function sendEmail(msg: { subject: string; html: string; text: string; to?: string }): Promise<boolean> {
  if (!emailConfigured()) {
    console.warn("[email] GMAIL_APP_PASSWORD not set; skipping:", msg.subject);
    return false;
  }
  const to = msg.to ?? (await getSettings()).notifyEmail;
  // Local development: write emails to disk instead of sending them.
  if (process.env.EMAIL_DUMP_DIR && process.env.NODE_ENV !== "production") {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(process.env.EMAIL_DUMP_DIR, { recursive: true });
    const name = `${Date.now()}-${msg.subject.replace(/[^\w]+/g, "-").slice(0, 60)}`;
    await writeFile(`${process.env.EMAIL_DUMP_DIR}/${name}.html`, msg.html);
    await writeFile(`${process.env.EMAIL_DUMP_DIR}/${name}.txt`, `To: ${to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    return true;
  }
  await getTransporter().sendMail({
    from: { name: "Apollo", address: env.gmailSender() },
    to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  return true;
}
