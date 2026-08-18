// Operations rollout — additive, boot-time, idempotent.
//
// WHY THIS EXISTS, and why its absence was invisible.
//
// `ensureSystemRole` deliberately never touches a role that already exists (rbac.service.ts:932):
// a re-seed must not silently revert an administrator's edit. That is the right rule, and it has
// one consequence every module shipping AFTER the first seed has to answer for — the seeded
// `super-admin` role was created with the permission registry as it stood THEN, and no later boot
// widens it. On a database seeded before Operations existed, no account holds a single
// `operations*` key, so every Operations endpoint answers 403 and every table in the module renders
// its error state.
//
// A fresh database never shows this: `ensureSystemRole` creates the role from the CURRENT registry,
// which is why every integration test in this repository passes while an existing install is
// locked out. That gap is the whole reason this file exists.
//
// HR hit the same wall when Attendance shipped its self-service keys and answered it with
// `addSystemRoleGrants` (attendance.migration.ts, AT-6). This is the same answer for the same
// reason: strictly additive, never removing, and idempotent — the second run finds nothing to add
// and writes nothing. Holders' cached permission snapshots are invalidated by the call itself, so
// the grants take effect on the next request rather than the next login.
//
// It widens `super-admin` ONLY. `platform-admin` and `employee-self-service` are deliberately left
// alone: nothing in Operations is a platform-administration concern, and a captain reaches their
// own day through `operationsExecution.own`, which is a role an administrator assigns rather than
// something a self-service bundle should carry by default.
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { operationsPermissions } from './operations.module';

export const seedOperations = async (): Promise<void> => {
  // The module's OWN declared keys — read from the manifest rather than restated, so a permission
  // added by a later slice cannot be forgotten here.
  const keys = operationsPermissions.map((permission) => permission.key);

  const added = await rbacService.addSystemRoleGrants('super-admin', keys);
  if (added > 0) {
    logger.info(
      { added, keys: keys.length },
      'operations: super-admin widened with the Operations grants (pre-existing install)',
    );
  }
};
