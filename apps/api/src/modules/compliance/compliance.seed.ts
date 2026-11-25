// What the Compliance and Risks module does at every boot, in order (design §10):
//
//   1. its indexes, FIRST — a folder's unique name index is the only race guard two racing
//      creates meet;
//   2. its two file categories, before any upload asks for them;
//   3. its ready-made roles, as managed roles;
//   4. the readers' grants, brought in line with the folders' lists (§4.2) — what a write that
//      could not change a grant left behind is put right here.
//
// It refuses nothing: a step that failed is a line in the log, and each is repeated where it is
// needed (the repositories' `ensureCollection`, the first upload's category, the next write's
// grant).
import { logger } from '../../infrastructure/logging/logger';
import { rbacService } from '../../platform/rbac';
import { reportLines, reportSummary, syncDeclaredIndexes } from '../../shared/base/index-sync';
import { complianceModels } from './compliance-indexes';
import { COMPLIANCE_ROLE_BUNDLES } from './compliance-roles';
import { reconcileReaderGrants } from './folders/reader-role';
import { ensureComplianceFileCategory } from './shared/file-categories';

export const seedCompliance = async (): Promise<void> => {
  const report = await syncDeclaredIndexes('apply', complianceModels);
  for (const line of [...reportLines(report), reportSummary(report)]) {
    logger[line.level]({ module: 'compliance', ...line.fields }, line.msg);
  }

  for (const which of ['documents', 'covers'] as const) {
    try {
      await ensureComplianceFileCategory(which);
    } catch (err) {
      logger.warn({ module: 'compliance', err, which }, 'a file category was not ensured');
    }
  }

  for (const bundle of COMPLIANCE_ROLE_BUNDLES) {
    await rbacService.ensureManagedRole(bundle.key, bundle.name, [...bundle.permissionKeys]);
  }

  try {
    await reconcileReaderGrants();
  } catch (err) {
    logger.warn({ module: 'compliance', err }, 'the readers’ grants were not reconciled');
  }
};
