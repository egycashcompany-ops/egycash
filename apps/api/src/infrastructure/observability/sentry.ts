// Error tracking (Review R31): Sentry wired into api and worker when a DSN is
// configured; a no-op otherwise.
//
// What it scrubs, and how (DEC-34): `@sentry/node` attaches incoming request bodies to error events
// by default (`maxIncomingRequestBodySize: 'medium'`), and `captureError` runs on every unexpected
// error. So the HTTP integration never captures a body on the ATM register's routes (entries and
// the workbook upload — combinations and key codes), and `beforeSend` removes the register's secret
// field names from every event, at any depth, in case one reached `extra` or `contexts` another way.
// The Pino redaction PATHS are not read here; only the field names are shared with the logger.
import * as Sentry from '@sentry/node';
import { env } from '../config/env';
import { REGISTER_SECRET_FIELD_NAMES } from '../logging/logger';

const SECRET_NAMES: ReadonlySet<string> = new Set(REGISTER_SECRET_FIELD_NAMES);

/** Every register route, the import upload included, under any `BASE_PATH`. */
export const isSecretBodyUrl = (url: string): boolean => url.includes('/api/v1/atm/register');

/** A copy of `value` without any property named in `SECRET_NAMES`, at any depth. */
const withoutSecretNames = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => withoutSecretNames(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_NAMES.has(key)) continue;
    out[key] = withoutSecretNames(inner, seen);
  }
  return out;
};

const scrub = <T>(value: T): T => withoutSecretNames(value, new WeakSet()) as T;

/** A body Sentry kept as text: scrubbed when it is JSON, otherwise left as it is. */
const scrubBody = (data: unknown): unknown => {
  if (typeof data !== 'string') return scrub(data);
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(scrub(parsed)) : data;
  } catch {
    return data;
  }
};

export const scrubSentryEvent = <E extends Sentry.Event>(event: E): E => {
  const request = event.request;
  if (request !== undefined) {
    if (typeof request.url === 'string' && isSecretBodyUrl(request.url)) {
      delete request.data;
    } else if (request.data !== undefined) {
      request.data = scrubBody(request.data);
    }
  }
  if (event.extra !== undefined) event.extra = scrub(event.extra);
  if (event.contexts !== undefined) event.contexts = scrub(event.contexts);
  return event;
};

export const initSentry = (processName: 'api' | 'worker'): void => {
  if (env.SENTRY_DSN === '') return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    serverName: processName,
    tracesSampleRate: 0.1,
    integrations: [Sentry.httpIntegration({ ignoreIncomingRequestBody: isSecretBodyUrl })],
    beforeSend: scrubSentryEvent,
  });
};

export const captureError = (error: unknown, context?: Record<string, unknown>): void => {
  if (env.SENTRY_DSN === '') return;
  Sentry.captureException(error, context === undefined ? undefined : { extra: context });
};
