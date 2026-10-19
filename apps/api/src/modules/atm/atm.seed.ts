// ATM rollout — additive, boot-time, idempotent. The same answer, for the same reason, as
// operations.seed.ts: `ensureSystemRole` never widens an existing role, so on a database seeded
// before this module existed no account holds an `atm*` key and every endpoint answers 403.
// Strictly additive to `super-admin` only; a second run finds nothing to add.
//
// Then the two deploy steps the register needs (spec §5.11), in this order: the indexes the ATM
// schemas declare (DEC-26 — `autoIndex` is off in production, and `ux_open_period_per_code` is what
// D6 rests on), and the legacy master rows' missing `__v`/timestamps (DEC-23). No role other than
// `super-admin` is widened here: granting the new Operations and Efficiency keys is an
// administrator's step (lead override O-1, rollout §12.2).
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { atmPermissions } from './atm.module';
import { migrateAtmIndexes } from './atm-indexes';
import { migrateAtmLegacyTimestamps } from './machines/machine.migration';

export const seedAtm = async (): Promise<void> => {
  const keys = atmPermissions.map((permission) => permission.key);
  const added = await rbacService.addSystemRoleGrants('super-admin', keys);
  if (added > 0) {
    logger.info(
      // `grants`, not `keys`: the logger redacts any `keys` field (the register's key codes, §5.4).
      { added, grants: keys.length },
      'atm: super-admin widened with the ATM grants (pre-existing install)',
    );
  }
  await migrateAtmIndexes();
  const backfilled = await migrateAtmLegacyTimestamps();
  if (backfilled.versioned > 0 || backfilled.timestamped > 0) {
    logger.info(
      backfilled,
      'atm: legacy machine and label rows given their version and timestamps',
    );
  }
};
