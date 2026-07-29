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
   * Envelope-encryption key ring — `id:base64,id:base64`, 32-byte keys (A-1).
   *
   * More than one so rotation has an overlap window: the retired key still decrypts what has not
   * been re-wrapped, while everything new is sealed under the active one. A single-key scheme
   * forces a big-bang migration, which is how rotations get postponed indefinitely.
   *
   * The dev default is a published, worthless key. `assertProductionSecrets()` refuses to boot
   * production with it — a dev key silently reaching production is the failure this guards.
   */
  PLATFORM_ENCRYPTION_KEYS: z
    .string()
    .default('dev1:ZGV2LW9ubHkta2V5LW5vdC1mb3ItcHJvZHVjdGlvbi0zMmI='),
  PLATFORM_ENCRYPTION_ACTIVE_KEY: z.string().default('dev1'),

  /**
   * Automation Service (ADR-018). OFF by default: the null provider stays registered, dispatches
   * are recorded as `skipped`, and the module's navigation entry is hidden — which is what lets
   * slices A-0..A-13 merge to `main` without a user ever seeing a half-built feature.
   */
  AUTOMATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Which provider to construct when enabled. The trigger path to `n8n` lands at A-5. */
  AUTOMATION_PROVIDER: z.enum(['null', 'n8n']).default('null'),

  // ── n8n provider (A-5 trigger path) ─────────────────────────────────────────
  // All of these are configuration, never hardcoded. Without N8N_BASE_URL the n8n provider
  // declines to register and the null provider stays active — so an environment that has not
  // wired n8n behaves exactly as before.
  /** Base URL of the n8n instance, e.g. `https://n8n.example.up.railway.app`. No trailing slash. */
  N8N_BASE_URL: z.string().url().optional(),
  /** API key sent as `X-N8N-API-KEY`. Absent = unauthenticated calls (dev / open webhooks only). */
  N8N_API_KEY: z.string().min(1).optional(),
  /** Per-request budget. A stuck n8n must not hold a worker; the dispatch degrades instead. */
  N8N_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  /** Transport-failure retries INSIDE one dispatch (BullMQ retries the job on top of this). */
  N8N_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

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
// The dev key is published in this repository. Reaching production with it would mean every
// stored credential is readable by anyone who can read the source — fail the boot instead.
if (isProduction && env.PLATFORM_ENCRYPTION_KEYS.includes('dev1:')) {
  throw new Error('PLATFORM_ENCRYPTION_KEYS must be set to real keys in production');
}
