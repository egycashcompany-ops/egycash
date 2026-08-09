// Development/staging seed DATA (idempotent) — organization roles, dev users, a default file
// category, and the dev-login convenience below. Synthetic data only; production data never
// appears here (Security Architecture §6). No side effects on import: the runnable entrypoint is
// seed.ts. Exported so the login regression test exercises the REAL seed path (not a copy),
// keeping the seed ↔ login contract honest.
import { platformPermissions, SettingKeys } from '@ecms/contracts';
import { env } from './infrastructure/config/env';
import { rbacService } from './platform/rbac';
import { fileCategoryService } from './platform/files';
import { settingsService } from './platform/settings';
import { userService } from './platform/users';
import { seedBootstrapNavigation } from './seed-navigation';
import { parseIdentifierList, reconcileHrOnlyUsers } from './hr-only-access';
import { type AuthContext } from './shared/types';

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

export const seedDevData = async (): Promise<{ adminId: string; hrId: string }> => {
  // Super Admin holds THE WHOLE REGISTRY — platform plus every registered module — not just the
  // platform catalog.
  //
  // The distinction only shows up on a fresh database, and it used to be invisible. The boot sync
  // keeps this role equal to the catalog, but it can only update a role that already EXISTS, and on
  // a first run the role is created here, moments later. Seeding it from `platformPermissions` left
  // the administrator holding nothing in HR, Fleet or IT until the next API start re-ran the sync
  // and widened it — every module screen 403ing in between, on the one account that is supposed to
  // be able to open everything. Reading the registry instead closes that window: the seed grants
  // what boot just registered, which is the same set the sync would converge on anyway.
  const superAdminRole = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    rbacService.registeredPermissionKeys(),
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

  // Dev-login convenience: TOTP 2FA is enforced for privileged accounts by default (Review R13),
  // but every seeded account is privileged — so a fresh seed would force TOTP enrollment and
  // block a plain email/password login (and a real authenticator can't be used against a
  // non-real-time dev clock anyway). Disable enforcement at organization scope here so the seeded
  // logins work out of the box. Production keeps the default (true) and never runs this seed.
  const seedCtx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'ar',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 0,
    isPrivileged: true,
  };
  await settingsService.set(seedCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  await fileCategoryService.ensure({
    key: 'general',
    name: { ar: 'مستندات عامة', en: 'General documents' },
    allowedMimeTypes: ['application/pdf', 'image/*', 'text/plain'],
    maxSizeMb: 20,
    retentionDays: null,
  });

  // First-run navigation: default Application Categories + Applications, granted to the admin, so a
  // fresh install has a functional (fully data-driven) sidebar with no manual DB setup.
  await seedBootstrapNavigation(adminId);

  // HR-only accounts (see hr-only-access.ts). Re-asserted on EVERY seed run, which is the point:
  // the confinement is a state the platform maintains, not an edit somebody made once that the next
  // `npm run seed` — or the next role assignment — could quietly undo. Idempotent; unconfigured
  // (the default) it does nothing, and accounts the configuration names but this database does not
  // have are skipped with a warning.
  await reconcileHrOnlyUsers(parseIdentifierList(env.HR_ONLY_USER_IDENTIFIERS), {
    actorId: adminId,
    allowNameIdentifiers: env.HR_ONLY_ALLOW_NAME_IDENTIFIERS,
  });

  return { adminId, hrId };
};
