// Development/staging seed: organization profile, protected system roles, dev users.
// Synthetic data only — production data never appears here (Security Architecture §6).
import { platformPermissions } from '@ecms/contracts';
import { env } from './infrastructure/config/env';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { rbacService } from './platform/rbac';
import { userService } from './platform/users';

const ensureUser = async (
  email: string,
  password: string,
  names: { first: { ar: string; en: string }; last: { ar: string; en: string } },
): Promise<string> => {
  const existing = await userService.findByEmail(email);
  if (existing !== null) return String(existing._id);

  const { user } = await userService.create(
    {
      email,
      firstName: names.first,
      lastName: names.last,
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  // Seed accounts skip the invite flow: password set + activated directly.
  await userService.setPassword(String(user._id), password, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const main = async (): Promise<void> => {
  await bootPlatform({ modules: moduleManifests });

  const superAdminRole = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const platformAdminRole = await rbacService.ensureSystemRole(
    'platform-admin',
    { en: 'Platform Admin', ar: 'مدير المنصة' },
    platformPermissions.filter((p) => p.moduleId === 'platform').map((p) => p.key),
  );

  const adminId = await ensureUser(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD, {
    first: { ar: 'مدير', en: 'System' },
    last: { ar: 'النظام', en: 'Administrator' },
  });
  await rbacService.ensureAssignment(adminId, String(superAdminRole._id), 'organization');

  const hrId = await ensureUser(env.SEED_HR_EMAIL, env.SEED_HR_PASSWORD, {
    first: { ar: 'مسؤول', en: 'HR' },
    last: { ar: 'الموارد', en: 'Manager' },
  });
  await rbacService.ensureAssignment(hrId, String(platformAdminRole._id), 'organization');

  logger.info(
    { admin: env.SEED_ADMIN_EMAIL, hr: env.SEED_HR_EMAIL },
    'seed complete — dev logins ready',
  );
  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  process.exit(0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'seed failed');
  process.exit(1);
});
