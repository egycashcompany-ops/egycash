// The module's ready-made roles (design §6.5; OD-78 A), seeded as MANAGED roles (D-20): each boot
// brings their keys back to this list, a hand-added key going and a hand-trimmed one returning.
// Managed, not system: a system role makes its holders privileged, and a privileged account signs
// in with a second factor — not a thing a catalog clerk's role should impose.
//
// Here and not in the seed, so the formal-Arabic gate reads the titles (it skips `*.seed.ts`). A
// bundle joins with the first slice that gives it a key, and none is seeded empty: the master-data
// administrator with the catalog (P1a.1); the storekeeper, the procurement officer and manager, the
// Administrative Affairs manager and the auditor with the item keys (P1a.2), each with the keys
// §6.5 gives it so far — the warehouse keys join in P1a.3. The titles are the design's candidates:
// OD-67's fallback, A (B, the owner's words, not yet given). `ensureManagedRole` writes a title
// only when it creates the role, so a title changed later is renamed by hand.
//
// Listed in §6.5's order, so a later bundle takes its place in it: the count team member and the
// department requester after the storekeeper, the finance reader after the auditor.
import { type LocalizedString } from '@ecms/contracts';

export interface AdministrationRoleBundle {
  /** Found by this key at every boot — renaming it would seed a second role. */
  key: string;
  name: LocalizedString;
  permissionKeys: readonly string[];
}

/** What the procurement officer reads in P1a; the procurement manager holds it all, and more later. */
const PROCUREMENT_OFFICER_KEYS = ['administrationItem.view'] as const;

export const ADMINISTRATION_ROLE_BUNDLES: readonly AdministrationRoleBundle[] = [
  {
    key: 'administration-storekeeper',
    name: { en: 'Storekeeper', ar: 'أمين المخزن' },
    // Assigned in the branch of the keeper's warehouses; items are read whole whatever the scope.
    permissionKeys: ['administrationItem.view'],
  },
  {
    key: 'administration-procurement-officer',
    name: { en: 'Procurement officer', ar: 'موظف المشتريات' },
    permissionKeys: [...PROCUREMENT_OFFICER_KEYS],
  },
  {
    key: 'administration-procurement-manager',
    name: { en: 'Procurement manager', ar: 'مدير المشتريات' },
    // The officer's keys; the manager's own (cancel, award, close) ship with P2–P4.
    permissionKeys: [...PROCUREMENT_OFFICER_KEYS],
  },
  {
    key: 'administration-affairs-manager',
    name: { en: 'Administrative Affairs manager', ar: 'مدير الشئون الإدارية' },
    // Every view key, and every approve key, as each ships.
    permissionKeys: ['administrationItem.view'],
  },
  {
    key: 'administration-master-data',
    name: { en: 'Master-data administrator', ar: 'مسؤول البيانات الأساسية' },
    // Assigned at organization scope (§6.7): the master-data writes refuse every narrower one.
    permissionKeys: [
      'administrationItem.view',
      'administrationItem.create',
      'administrationItem.edit',
      'administrationCatalog.manage',
    ],
  },
  {
    key: 'administration-auditor',
    name: { en: 'Internal auditor', ar: 'المراجع الداخلي' },
    // Every view key, as each ships; nothing that writes.
    permissionKeys: ['administrationItem.view'],
  },
];
