import nodemailer, { type Transporter } from 'nodemailer';
import { optionalEnv, numberEnv, boolEnv } from '@utils/env';
import logger from '@utils/logger';

// Transactional email (password-reset codes today). OPTIONAL: with no SMTP_HOST
// configured, sendEmail is a no-op that returns false — the server still runs and
// the reset endpoints still succeed (they never reveal whether an email exists).

let transporter: Transporter | null = null;
let initialized = false;

const getTransporter = (): Transporter | null => {
  if (initialized) return transporter;
  initialized = true;

  const host = optionalEnv('SMTP_HOST');
  if (!host) {
    logger.warn('SMTP_HOST not set — email sending disabled.');
    return null;
  }
  const user = optionalEnv('SMTP_USER');
  transporter = nodemailer.createTransport({
    host,
    port: numberEnv('SMTP_PORT', 587),
    secure: boolEnv('SMTP_SECURE', false),
    auth: user ? { user, pass: optionalEnv('SMTP_PASSWORD') } : undefined,
  });
  logger.info('SMTP transport initialized — email enabled.');
  return transporter;
};

export const isEmailConfigured = (): boolean => getTransporter() !== null;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const sendEmail = async (msg: EmailMessage): Promise<boolean> => {
  const t = getTransporter();
  if (!t) return false;
  const from = optionalEnv('EMAIL_FROM', 'Social Commerce <no-reply@localhost>');
  try {
    await t.sendMail({ from, ...msg });
    return true;
  } catch (err) {
    logger.error({ err }, 'email send failed');
    return false;
  }
};
