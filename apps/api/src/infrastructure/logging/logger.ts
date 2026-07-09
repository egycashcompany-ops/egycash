// Pino is the only logger (ADR-012); console.* is lint-banned.
// PII fields are redacted here — the same path list Sentry scrubbing reuses (Review R31).
import { pino } from 'pino';
import { env, isTest } from '../config/env';
import { getRequestId } from '../http/request-context';

export const PII_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.refreshToken',
  '*.nationalId',
  '*.phone',
  '*.secret',
];

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: PII_REDACTION_PATHS, censor: '[REDACTED]' },
  base: null,
  mixin() {
    const requestId = getRequestId();
    return requestId === undefined ? {} : { requestId };
  },
});
