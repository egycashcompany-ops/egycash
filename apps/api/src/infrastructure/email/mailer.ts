// SMTP transport (Sprint 3.3 plan §2b) behind one tiny interface — the notifications
// email channel adapter is the only caller. Dev/prod use real SMTP (Mailpit locally,
// per docker-compose); tests use nodemailer's json transport (captures the message
// instead of sending — no live SMTP server needed in CI, the same stated limitation
// as Sprint 3.1's cloud storage drivers: configuration-tested, not live-tested).
import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../config/env';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter !== null) return transporter;
  transporter = isTest
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER === '' ? undefined : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      });
  return transporter;
};

export const sendMail = async (input: SendMailInput): Promise<void> => {
  await getTransporter().sendMail({
    from: env.NOTIFICATIONS_EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
};

/** Test-only: force a fresh transport (jsonTransport is stateless, but keeps parity). */
export const resetMailer = (): void => {
  transporter = null;
};
