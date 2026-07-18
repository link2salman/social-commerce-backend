import pino from 'pino';
import { isDevelopment } from './env';

const dev = isDevelopment();

// Secrets and PII that must never reach the log sink. pino wildcards match one
// level, so keys are registered at the depths structured logs actually use.
const SENSITIVE = [
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token_hash',
  'authorization',
  'jwt_secret',
  'paymentToken',
  'payment_token',
  'email',
];

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE.flatMap(key => [key, `*.${key}`, `*.*.${key}`]),
];

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (dev ? 'debug' : 'info'),
    formatters: {
      level: label => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths, censor: '[redacted]' },
  },
  dev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      })
    : undefined
);

export default logger;
