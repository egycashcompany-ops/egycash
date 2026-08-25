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
   * ATM maintenance mailbox (ATM-6) — the ONE central reader that replaces the legacy's
   * per-branch Node services. All four UNSET = no source registers and the poll task is inert,
   * which is every install that has no mailbox.
   *
   * `ATM_MAIL_GRAPH_CLIENT_SECRET` accepts either a plaintext secret or a JSON `SecretRef` the
   * platform secret store can open — plaintext stays supported because that is what the legacy
   * deployment has today, and a migration that demands a secret-store rollout first is one that
   * does not happen.
   */
  ATM_MAIL_GRAPH_TENANT_ID: z.string().min(1).optional(),
  ATM_MAIL_GRAPH_CLIENT_ID: z.string().min(1).optional(),
  ATM_MAIL_GRAPH_CLIENT_SECRET: z.string().min(1).optional(),
  ATM_MAIL_GRAPH_USER: z.string().min(1).optional(),
  ATM_MAIL_GRAPH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),

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
    // Exactly 32 bytes (AES-256) once base64-decoded — the previous default decoded to 35 and
    // left `cryptoService.available()` false, which silently disabled the credential store in dev.
    .default('dev1:ZGV2LW9ubHkta2V5LW5vdC1mb3ItcHJvZHVjdGlvbiE='),
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
  /**
   * Live entity-change signals over the existing Socket.IO server (ADR-029). Off restores
   * today's behaviour exactly: no topic rooms are joined and no `entity.changed` is published;
   * personal notification pushes (`notification:new`) are NOT behind this flag.
   */
  REALTIME_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
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
  N8N_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  /** Transport-failure retries INSIDE one dispatch (BullMQ retries the job on top of this). */
  N8N_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * Deployment secret the per-workflow webhook signature is derived from (design §2.2), letting n8n
   * reject a trigger that did not come from ECMS. Optional: absent, triggers are sent unsigned,
   * which is the A-5 behaviour and the right trade for a private-network n8n.
   */
  N8N_WEBHOOK_SECRET: z.string().min(16).optional(),

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
  /**
   * Hand the browser the object store's OWN presigned URL instead of this app's signed endpoint.
   *
   * Off by default, and the default is the load-bearing part. A presigned URL is absolute and on
   * the store's origin, so the app ends up telling the browser to load a resource its own
   * Content-Security-Policy does not allow — `img-src 'self' data: blob:` refuses it, no request
   * reaches any server, and every screen that shows a stored image falls back to its empty state.
   * The policy and the URL are decided by the same process from the same configuration, and
   * neither knew about the other.
   *
   * Serving the bytes through this app keeps the URL same-origin under every driver, so what works
   * on a disk works on S3. It costs one hop of egress; for this platform's file sizes (capped by
   * `MAX_UPLOAD_MB`) that is not a trade worth a broken image. Turn it on only where the store's
   * origin is genuinely allowed by the deployed CSP.
   */
  STORAGE_PRESIGNED_URLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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

  /**
   * Web Push (VAPID). Generate a pair once per deployment with `npx web-push generate-vapid-keys`
   * and keep the private key secret — it is what proves to Google's and Mozilla's push services
   * that a delivery came from this server.
   *
   * BOTH EMPTY BY DEFAULT, AND THAT IS A WORKING STATE. With no pair the push channel reports
   * itself unconfigured, `notify()` puts no push row on any notification, and the browser is never
   * asked for a permission it would then have nothing to receive on. Dev, CI and any deployment
   * that has not set this up keep behaving exactly as they did before push existed. A HALF pair is
   * different and is refused at boot: it is a typo, not a decision.
   *
   * The subject identifies the sender to the push service — a `mailto:` or an https URL it can
   * reach a human on if this server starts misbehaving.
   */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:egycash.company@gmail.com'),

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

  /**
   * Accounts confined to the HR module (see `hr-only-access.ts`): comma-separated EMAILS or
   * USERNAMES — the two identifiers this system holds unique.
   *
   * The default names the four accounts this confinement was decided for, IN CODE rather than only
   * in a deployment's environment. A restriction that has to be re-entered by hand to survive a new
   * environment is a restriction that eventually is not there: the point of reconciling on every
   * seed and every boot is that it cannot be forgotten, and a value only present in one `.env` can
   * be. An email is exact and unique, so a default list reaches these four accounts and no others.
   *
   * Override it here (or set it empty) for a deployment these people do not belong to. An
   * identifier matching no account is a logged warning rather than a boot failure — the same
   * configuration reaches environments that legitimately do not have them (a fresh dev database has
   * none), and failing there would be noise rather than a signal.
   */
  HR_ONLY_USER_IDENTIFIERS: z
    .string()
    .default(
      'mohamed.mustafa@egycash.com.eg,samer.mohammed@egycash.com.eg,mohamed.essam@egycash.com.eg,saif.aldin@egycash.com.eg',
    ),

  /**
   * Opt in to `name:<full English name>` identifiers in the list above — a FALLBACK for a database
   * whose logins are not known yet, off by default (see `hr-only-policy.ts`). Even when enabled, a
   * name matching more than one account is refused rather than guessed.
   */
  HR_ONLY_ALLOW_NAME_IDENTIFIERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
