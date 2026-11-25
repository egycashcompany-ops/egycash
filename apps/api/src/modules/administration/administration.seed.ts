// What the Administrative Affairs module does at every boot, in order (design §3.2, §15.3.2):
//
//   1. its indexes, FIRST — a unique index is the only race guard for one-name-one-row, and the
//      counter's upsert is safe only once `ux_counter_key` exists;
//   2. its counters (OD-05 A): the item code's and the supplier code's, each raised to the highest
//      code of its own already given;
//   3. its file categories: the suppliers' papers (OD-11 A), before any upload asks for it;
//   4. its ready-made roles (OD-78 A), as managed roles.
//
// It holds no state and refuses nothing: a build that failed is a line in the log, and the write
// that needed it is refused by its repository's `ensureCollection`, which tries the build again.
// The counter and category steps are the same: every create repeats its counter's before its
// transaction, and the first upload ensures the category.
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { reportLines, reportSummary, syncDeclaredIndexes } from '../../shared/base/index-sync';
import { administrationModels } from './administration-indexes';
import { ADMINISTRATION_ROLE_BUNDLES } from './administration-roles';
import { ensureItemCodeCounter } from './catalog/items';
import {
  ensureSupplierCodeCounter,
  ensureSupplierDocumentsCategory,
} from './procurement/suppliers';

export const seedAdministration = async (): Promise<void> => {
  const report = await syncDeclaredIndexes('apply', administrationModels);
  // Built at info; anything left unbuilt or unlike its declaration at warn — no field values.
  for (const line of [...reportLines(report), reportSummary(report)]) {
    logger[line.level]({ module: 'administration', ...line.fields }, line.msg);
  }

  // After the index step, so `ux_counter_key` exists before the first upsert and two processes
  // booting on a fresh database cannot write two counters. A counter the seed could not raise is a
  // line in the log, as an index it could not build is: every create raises it again first.
  try {
    await ensureItemCodeCounter();
  } catch (err) {
    logger.warn({ module: 'administration', err }, 'the item code counter was not ensured');
  }
  try {
    await ensureSupplierCodeCounter();
  } catch (err) {
    logger.warn({ module: 'administration', err }, 'the supplier code counter was not ensured');
  }
  try {
    await ensureSupplierDocumentsCategory();
  } catch (err) {
    logger.warn({ module: 'administration', err }, 'the supplier papers category was not ensured');
  }

  for (const bundle of ADMINISTRATION_ROLE_BUNDLES) {
    await rbacService.ensureManagedRole(bundle.key, bundle.name, [...bundle.permissionKeys]);
  }
};
