// The module's ready-made roles (design §4.1), seeded as MANAGED roles: each boot brings their keys
// back to this list. Managed, not system — a system role makes its holders privileged, and a
// privileged account signs in with a second factor.
//
//   * the RESPONSIBLE PERSON's role — an administrator gives it to whoever keeps the shelf;
//   * the READER's role — nobody gives it by hand. The module gives it, at `own` scope, to a person
//     the first time a folder is shared with them, and takes that grant back when no folder is
//     shared with them any more (§4.2). It is what puts «الملفات» in their sidebar; it opens no
//     folder by itself.
import { type LocalizedString } from '@ecms/contracts';

export interface ComplianceRoleBundle {
  /** Found by this key at every boot — renaming it would seed a second role. */
  key: string;
  name: LocalizedString;
  permissionKeys: readonly string[];
}

export const COMPLIANCE_MANAGER_ROLE: ComplianceRoleBundle = {
  key: 'compliance-files-manager',
  name: { en: 'Compliance files officer', ar: 'مسؤول ملفات الالتزام والمخاطر' },
  permissionKeys: ['complianceFile.manage', 'complianceFile.view'],
};

export const COMPLIANCE_READER_ROLE: ComplianceRoleBundle = {
  key: 'compliance-files-reader',
  name: { en: 'Compliance files reader', ar: 'قارئ ملفات الالتزام والمخاطر' },
  permissionKeys: ['complianceFile.view'],
};

export const COMPLIANCE_ROLE_BUNDLES: readonly ComplianceRoleBundle[] = [
  COMPLIANCE_MANAGER_ROLE,
  COMPLIANCE_READER_ROLE,
];
