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
