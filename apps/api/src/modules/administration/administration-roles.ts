// The module's ready-made roles (design §6.5; OD-78 A), seeded as MANAGED roles (D-20): each boot
// brings their keys back to this list, a hand-added key going and a hand-trimmed one returning.
// Managed, not system: a system role makes its holders privileged, and a privileged account signs
// in with a second factor — not a thing a catalog clerk's role should impose.
//
// Here and not in the seed, so the formal-Arabic gate reads the titles (it skips `*.seed.ts`). A
// bundle joins with the first slice that gives it a key, and none is seeded empty: the master-data
// administrator now, with the catalog; the storekeeper, the procurement officer and manager, the
// Administrative Affairs manager and the auditor with the item keys (P1a.2). The titles are the
// design's candidates (OD-67 A, the owner's own words not yet given). `ensureManagedRole` writes a
// title only when it creates the role, so a title changed later is renamed by hand.
import { type LocalizedString } from '@ecms/contracts';

export interface AdministrationRoleBundle {
  /** Found by this key at every boot — renaming it would seed a second role. */
  key: string;
  name: LocalizedString;
  permissionKeys: readonly string[];
}

export const ADMINISTRATION_ROLE_BUNDLES: readonly AdministrationRoleBundle[] = [
  {
    key: 'administration-master-data',
    name: { en: 'Master-data administrator', ar: 'مسؤول البيانات الأساسية' },
    // Assigned at organization scope (§6.7): the catalog's writes refuse every narrower one.
    permissionKeys: ['administrationCatalog.manage'],
  },
];
