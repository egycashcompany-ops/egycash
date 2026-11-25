// Pino is the only logger (ADR-012); console.* is lint-banned.
// PII fields are redacted here (Review R31). Sentry scrubs its own events — it does not read this
// list as a path list (see observability/sentry.ts), only the register field names below.
import { pino } from 'pino';
import { env, isTest } from '../config/env';
import { getRequestId } from '../http/request-context';

/**
 * The ATM register's secret fields (spec §5.4, D3): the sealed safe-door combination, the key
 * codes, the two notes columns, and the import's in-memory plaintext. Redacted at the same depth
 * set for every name. Depth is a backstop, not the rule: no register entry, entry DTO, request
 * body or parsed import row is ever passed to the logger.
 */
export const REGISTER_SECRET_FIELD_NAMES = [
  'safeCombination',
  'keys',
  'receiptNotes',
  'handoverNotes',
  'plaintextCombination',
] as const;

/**
 * A phone inside a list of contact people — an Administrative Affairs supplier's `contacts`
 * (administration-module-design-flows.md §6.8). `*.phone` reaches one level only, so a phone one
 * array deeper is listed at the same three depths as the register's names.
 */
export const CONTACT_PHONE_PATHS = [
  'contacts[*].phone',
  '*.contacts[*].phone',
  '*.*.contacts[*].phone',
] as const;

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
  ...CONTACT_PHONE_PATHS,
  '*.secret',
  // Root, one level and two levels deep — 15 paths.
  ...REGISTER_SECRET_FIELD_NAMES.flatMap((name) => [name, `*.${name}`, `*.*.${name}`]),
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
