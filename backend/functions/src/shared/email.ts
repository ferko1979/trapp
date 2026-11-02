import nodemailer from "nodemailer";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";

export type EmailProviderConfig =
  | {
      provider: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      fromEmail: string;
      fromName: string;
    }
  | {
      provider: "ses";
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      fromEmail: string;
      fromName: string;
    };

export function createTransporter(config: EmailProviderConfig): nodemailer.Transporter {
  if (config.provider === "ses") {
    const ses = new SESClient({
      region: config.region || "eu-west-1",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    // nodemailer SES transport with AWS SDK v3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return nodemailer.createTransport({ SES: { ses, aws: { SendRawEmailCommand } } } as any);
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
}

export function getSmtpConfigFromEnv(): EmailProviderConfig {
  return {
    provider: "smtp",
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    fromEmail: process.env.SMTP_FROM_EMAIL ?? "",
    fromName: process.env.SMTP_FROM_NAME ?? "PlayTrap",
  };
}

export function getMailer(): nodemailer.Transporter {
  return createTransporter(getSmtpConfigFromEnv());
}

export async function sendVerificationEmail(params: {
  toEmail: string;
  toName?: string | null;
  verificationLink: string;
}) {
  const transporter = getMailer();
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? "";
  const fromName = process.env.SMTP_FROM_NAME || "PlayTrap";

  const displayName = params.toName?.trim() || "Player";

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: params.toEmail,
    subject: "Verify your PlayTrap email address",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Verify your email address</h2>
        <p>Hello ${displayName},</p>
        <p>Please verify your PlayTrap email address by clicking the button below.</p>
        <p>
          <a href="${params.verificationLink}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">
            Verify Email
          </a>
        </p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p>${params.verificationLink}</p>
      </div>
    `,
    text: `Verify your PlayTrap email address:\n\n${params.verificationLink}`,
  });
}