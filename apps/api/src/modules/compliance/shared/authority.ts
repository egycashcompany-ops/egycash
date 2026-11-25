// Who is the responsible person, and who only reads (design §4).
//
// The responsible person holds `complianceFile.manage`, at whatever scope it was given: the folders
// are not a branch's records, they are one shelf for the company, and the key's holder keeps all of
// it. Everyone else reaches a folder only by being on its list — the reader key opens the page, it
// never opens a folder.
import { ForbiddenError } from '../../../shared/errors';
import { hasPermission, type AuthContext } from '../../../shared/types';

export const COMPLIANCE_MANAGE_KEY = 'complianceFile.manage';
export const COMPLIANCE_VIEW_KEY = 'complianceFile.view';

/** Both keys that open the page: the routes every reader reaches take either. */
export const COMPLIANCE_PAGE_KEYS: readonly [string, ...string[]] = [
  COMPLIANCE_MANAGE_KEY,
  COMPLIANCE_VIEW_KEY,
];

export const isComplianceManager = (ctx: AuthContext): boolean =>
  hasPermission(ctx, COMPLIANCE_MANAGE_KEY);

/** 403 unless the caller is the responsible person — the guard every write repeats. */
export const assertComplianceManager = (ctx: AuthContext): void => {
  if (!isComplianceManager(ctx)) {
    throw new ForbiddenError(`${COMPLIANCE_MANAGE_KEY} is required`);
  }
};
