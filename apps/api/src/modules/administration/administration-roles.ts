// The module's ready-made roles (design §6.5; OD-78 A), seeded as MANAGED roles (D-20): each boot
// brings their keys back to this list, a hand-added key going and a hand-trimmed one returning.
// Managed, not system: a system role makes its holders privileged, and a privileged account signs
// in with a second factor — not a thing a catalog clerk's role should impose.
//
// Here and not in the seed, so the formal-Arabic gate reads the titles (it skips `*.seed.ts`). A
// bundle joins with the first slice that gives it a key, and none is seeded empty: the master-data
// administrator with the catalog (P1a.1); the storekeeper, the procurement officer and manager, the
// Administrative Affairs manager and the auditor with the item keys (P1a.2), each with the keys
// §6.5 gives it so far — the warehouse keys joined them in P1a.3, the supplier keys in P1b.1; the
// department requester with the purchase-request keys (P2.2), which also joined four of the others
// (P2 plan §9.3). The titles are the design's candidates: OD-67's fallback, A (B, the owner's
// words, not yet given). `ensureManagedRole` writes a title only when it creates the role, so a
// title changed later is renamed by hand.
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

/**
 * What the procurement officer reads so far; the procurement manager holds it all, and more later.
 * The supplier register's writes are the master-data desk's, not the officer's: OD-04 A keeps
 * master data central, so §6.5's "+ create/edit if OD-04 gives suppliers to procurement" is not met.
 */
const PROCUREMENT_OFFICER_KEYS = [
  'administrationItem.view',
  'administrationWarehouse.view',
  'administrationSupplier.view',
  'administrationPurchaseRequest.view',
] as const;

export const ADMINISTRATION_ROLE_BUNDLES: readonly AdministrationRoleBundle[] = [
  {
    key: 'administration-storekeeper',
    name: { en: 'Storekeeper', ar: 'أمين المخزن' },
    // Assigned in the branch of the keeper's warehouses, which its scope reads fail-closed; items
    // and suppliers are read whole whatever the scope.
    permissionKeys: [
      'administrationWarehouse.view',
      'administrationItem.view',
      'administrationSupplier.view',
    ],
  },
  {
    key: 'administration-department-requester',
    name: { en: 'Department requester', ar: 'منسق طلبات الإدارة' },
    // A department's focal point (OD-16 A): assigned at department scope, over the requester's own
    // department copy, where it raises, edits and reads that department's purchase requests.
    permissionKeys: [
      'administrationPurchaseRequest.view',
      'administrationPurchaseRequest.create',
      'administrationPurchaseRequest.edit',
    ],
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
    // Every view key, and every approve key, as each ships — at organization scope, the
    // organization rungs (§6.5).
    permissionKeys: [
      'administrationItem.view',
      'administrationWarehouse.view',
      'administrationSupplier.view',
      'administrationPurchaseRequest.view',
      'administrationPurchaseRequest.approve',
    ],
  },
  {
    key: 'administration-master-data',
    name: { en: 'Master-data administrator', ar: 'مسؤول البيانات الأساسية' },
    // Assigned at organization scope (§6.7): the master-data writes refuse every narrower one, and
    // the warehouse writes then reach every branch.
    permissionKeys: [
      'administrationWarehouse.view',
      'administrationWarehouse.create',
      'administrationWarehouse.edit',
      'administrationItem.view',
      'administrationItem.create',
      'administrationItem.edit',
      'administrationCatalog.manage',
      'administrationSupplier.view',
      'administrationSupplier.create',
      'administrationSupplier.edit',
    ],
  },
  {
    key: 'administration-auditor',
    name: { en: 'Internal auditor', ar: 'المراجع الداخلي' },
    // Every view key, as each ships; nothing that writes.
    permissionKeys: [
      'administrationItem.view',
      'administrationWarehouse.view',
      'administrationSupplier.view',
      'administrationPurchaseRequest.view',
    ],
  },
];
