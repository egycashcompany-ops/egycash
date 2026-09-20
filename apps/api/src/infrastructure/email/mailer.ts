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

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/**
 * The real transport, built from explicit options rather than `env` so a spec can point it at a
 * fake SMTP server on a loopback port and prove the handshake — the one thing about nodemailer
 * a major upgrade could quietly change, and the one thing `jsonTransport` never exercises.
 */
export const createSmtpTransport = (options: SmtpOptions): Transporter =>
  nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.user === '' ? undefined : { user: options.user, pass: options.password },
  });

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter !== null) return transporter;
  transporter = isTest
    ? nodemailer.createTransport({ jsonTransport: true })
    : createSmtpTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
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
