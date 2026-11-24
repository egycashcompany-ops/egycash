// Who may write the module's master data (design §6.7; OD-04 A, central): units, categories,
// items and suppliers — a supplier's papers included, since linking one is an edit of the record. One item master and one supplier register serve
// every branch, so a branch-scoped holder of these keys editing a row would be editing it for
// everybody — the key must be held at ORGANIZATION scope. That also keeps delegates out: a
// delegated grant is never organization-wide. Reads are untouched: any holder reads the register.
//
// A wrapper of the shared `assertOrganizationScope` (PC-12), as ATM's settings and bank rules are,
// naming only this module's keys, so a caller cannot ask it about another module's.
import { assertOrganizationScope } from '../../../shared/base/org-authority';
import { type AuthContext } from '../../../shared/types';

/** The module's keys that write organization-wide master data. Grows with each master's slice. */
export const ADMINISTRATION_ORG_KEYS = [
  'administrationCatalog.manage',
  'administrationItem.create',
  'administrationItem.edit',
  'administrationSupplier.create',
  'administrationSupplier.edit',
] as const;
export type AdministrationOrgKey = (typeof ADMINISTRATION_ORG_KEYS)[number];

/** 403 unless the caller holds `key` company-wide. */
export const assertAdministrationOrgAuthority = (
  ctx: AuthContext,
  key: AdministrationOrgKey,
): void => {
  assertOrganizationScope(ctx, key, 'master data is one register for the whole company');
};
