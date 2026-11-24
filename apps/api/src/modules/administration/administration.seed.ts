// What the Administrative Affairs module does at every boot, in order (design §3.2, §15.3.2):
//
//   1. its indexes, FIRST — a unique index is the only race guard for one-name-one-row, and later
//      steps (the item counter's floor upsert, P1a.2) are safe only once theirs exist;
//   2. its ready-made roles (OD-78 A), as managed roles.
//
// It holds no state and refuses nothing: a build that failed is a line in the log, and the write
// that needed it is refused by its repository's `ensureCollection`, which tries the build again.
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { reportLines, reportSummary, syncDeclaredIndexes } from '../../shared/base/index-sync';
import { administrationModels } from './administration-indexes';
import { ADMINISTRATION_ROLE_BUNDLES } from './administration-roles';

export const seedAdministration = async (): Promise<void> => {
  const report = await syncDeclaredIndexes('apply', administrationModels);
  // Built at info; anything left unbuilt or unlike its declaration at warn — no field values.
  for (const line of [...reportLines(report), reportSummary(report)]) {
    logger[line.level]({ module: 'administration', ...line.fields }, line.msg);
  }

  for (const bundle of ADMINISTRATION_ROLE_BUNDLES) {
    await rbacService.ensureManagedRole(bundle.key, bundle.name, [...bundle.permissionKeys]);
  }
};
