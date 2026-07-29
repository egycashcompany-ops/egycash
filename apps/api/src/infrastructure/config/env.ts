// Environment configuration, validated at boot (ADR-007).
// Misconfiguration fails the boot with a readable report instead of a runtime mystery.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGO_URI: z
    .string()
    .min(1)
    .default('mongodb://localhost:27017/ecms?replicaSet=rs0&directConnection=true'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /**
   * Local National-ID OCR sidecar (OQ-30). UNSET = the null stub stays registered and OCR reports
   * `available: false`, which is the pre-existing behaviour. Set it only where the offline
   * `nid-ocr` container actually runs, e.g. `http://nid-ocr:8099`.
   */
  NATIONAL_ID_OCR_URL: z.string().url().optional(),
  NATIONAL_ID_OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

  /**
   * Automation Service (ADR-018). OFF by default: the null provider stays registered, dispatches
   * are recorded as `skipped`, and the module's navigation entry is hidden — which is what lets
   * slices A-0..A-13 merge to `main` without a user ever seeing a half-built feature.
   */
  AUTOMATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Which provider to construct when enabled. `n8n` arrives at A-6. */
  AUTOMATION_PROVIDER: z.enum(['null', 'n8n']).default('null'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  SENTRY_DSN: z.string().default(''),
  SLOW_QUERY_MS: z.coerce.number().int().min(1).default(200),

  /**
   * Single-service deployment (Railway guide): path of the built web bundle to serve
   * same-origin from the api (SPA fallback included). Empty (default) keeps the api
   * headless — dev and split deployments are unaffected.
   */
  WEB_STATIC_DIR: z.string().default(''),
  /**
   * Subpath deployment (e.g. https://egycash.com.eg/ecms): every HTTP surface — the api,
   * the static web, the refresh-cookie path — mounts under this prefix. The web build
   * must match (VITE_BASE_PATH + VITE_API_BASE_URL). Empty (default) = root. Health
   * endpoints stay additionally reachable at the root for platform probes.
   */
  BASE_PATH: z
    .string()
    .default('')
    .transform((v) => {
      const trimmed = v.trim().replace(/\/+$/, '');
      if (trimmed === '' || trimmed === '/') return '';
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }),

  // ── File storage (ADR-010) ────────────────────────────────────────────────
  STORAGE_DRIVER: z.enum(['local', 'railway', 's3', 'minio', 'azure']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  /** Injected by Railway when a volume is attached; falls back to STORAGE_LOCAL_ROOT. */
  RAILWAY_VOLUME_MOUNT_PATH: z.string().default(''),
  STORAGE_SIGNING_SECRET: z.string().min(16).default('dev-only-file-signing-secret'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  /** Absolute base URL of the api — used to build app-signed download URLs. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(25),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  /** Custom S3 endpoint — required for MinIO, optional for S3-compatible stores. */
  S3_ENDPOINT: z.string().default(''),
  AZURE_STORAGE_CONNECTION_STRING: z.string().default(''),
  AZURE_STORAGE_CONTAINER: z.string().default('ecms-files'),

  // ── Notifications (Sprint 3.3) ────────────────────────────────────────────
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  NOTIFICATIONS_EMAIL_FROM: z.string().default('EGYCASH <no-reply@ecms.local>'),

  // ── Credentials delivery (auth design §12 R3/R9) ──────────────────────────
  /** Absolute base URL of the web app — the login link in credential messages. */
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** WhatsApp transport driver: 'disabled' keeps dev/CI hermetic (logs + not-delivered). */
  WHATSAPP_PROVIDER: z.enum(['disabled', 'meta', 'twilio']).default('disabled'),
  /** meta: Cloud API access token · twilio: auth token. */
  WHATSAPP_API_TOKEN: z.string().default(''),
  /** meta: phone-number id · twilio: account SID. */
  WHATSAPP_ACCOUNT_ID: z.string().default(''),
  /** twilio only: the sending WhatsApp number (E.164). */
  WHATSAPP_FROM_NUMBER: z.string().default(''),

  /** Contracts D8/Q1 — chromium binary for worker-side PDF rendering; '' disables. */
  CHROMIUM_PATH: z.string().default(''),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@ecms.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin#2026!ecms'),
  SEED_HR_EMAIL: z.string().email().default('hr@ecms.local'),
  SEED_HR_PASSWORD: z.string().min(8).default('HrUser#2026!ecms'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const report = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Environment validation failed:\n${report}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProduction && env.JWT_ACCESS_SECRET === 'dev-only-access-secret-change-me') {
  throw new Error('JWT_ACCESS_SECRET must be set to a real secret in production');
}
if (isProduction && env.STORAGE_SIGNING_SECRET === 'dev-only-file-signing-secret') {
  throw new Error('STORAGE_SIGNING_SECRET must be set to a real secret in production');
}
