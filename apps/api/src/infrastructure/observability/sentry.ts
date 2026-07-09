// Error tracking (Review R31): Sentry wired into api and worker when a DSN is
// configured; a no-op otherwise. PII scrubbing reuses the Pino redaction path list.
import * as Sentry from '@sentry/node';
import { env } from '../config/env';

export const initSentry = (processName: 'api' | 'worker'): void => {
  if (env.SENTRY_DSN === '') return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    serverName: processName,
    tracesSampleRate: 0.1,
  });
};

export const captureError = (error: unknown, context?: Record<string, unknown>): void => {
  if (env.SENTRY_DSN === '') return;
  Sentry.captureException(error, context === undefined ? undefined : { extra: context });
};
