// ATM rollout — additive, boot-time, idempotent. The same answer, for the same reason, as
// operations.seed.ts: `ensureSystemRole` never widens an existing role, so on a database seeded
// before this module existed no account holds an `atm*` key and every endpoint answers 403.
// Strictly additive to `super-admin` only; a second run finds nothing to add.
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { atmPermissions } from './atm.module';

export const seedAtm = async (): Promise<void> => {
  const keys = atmPermissions.map((permission) => permission.key);
  const added = await rbacService.addSystemRoleGrants('super-admin', keys);
  if (added > 0) {
    logger.info(
      { added, keys: keys.length },
      'atm: super-admin widened with the ATM grants (pre-existing install)',
    );
  }
};
