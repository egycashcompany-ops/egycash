// Gold & Precious-Metals Vault — module manifest.
//
// This module is a PORT of the standalone gold-vault system into ECMS. Its business rules,
// numbering, document lifecycle and screens are the ones that system already had; what changed is
// the scaffolding around them — auth, RBAC, navigation, audit and data scoping are now the
// platform's, and three facts it used to own are read from ECMS instead:
//
//   1. عمليات الدخول carry the crew leader and the vehicle. Both were free text; the leader is now
//      an ECMS employee and the vehicle an ECMS Fleet vehicle, each stored with a display snapshot.
//   2. أمناء الخزن — the two vault custodians on every receipt, delivery and transfer — were names
//      from a gold-owned `supervisors` collection. That collection is gone; both are ECMS
//      employees.
//   3. الفروع — the gold-owned `branches` collection is gone. Every gold document carries an ECMS
//      organization branch, and the module's visibility is the platform's branch scope.
//
// WHAT DID NOT COME ACROSS, and why:
//   · gold `users`, `roles`, `audit_logs`, `notifications` — the platform owns all four. The gold
//     role catalog is expressed as the permissions below; every mutation writes to the platform
//     audit trail, which has its own screens.
//   · gold `supervisors` and `branches` — integrations 2 and 3 above.
//   · the customer PORTAL (`portal_users` and its login) — it is a second authentication system
//     for people who are not ECMS users. Bringing it in as-is would stand up an auth stack beside
//     the platform's, which is precisely what integrating this module was meant to stop. It is
//     deliberately out of this port and needs its own decision (see the port notes in
//     docs/12-planning/gold-module-port.md §6).
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildGoldCompaniesRouter } from './companies';
import { buildGoldRepresentativesRouter } from './representatives';
import { buildGoldFloorsRouter } from './floors';
import { buildGoldDrawersRouter, buildGoldVaultsRouter } from './vaults';
import { buildGoldBarsRouter } from './bars';
import { buildGoldReceivingRouter } from './receiving';
import { buildGoldDeliveryRouter } from './delivery';
import { buildGoldTransfersRouter } from './transfers';
import { buildGoldKeysRouter } from './keys';
import { buildGoldDashboardRouter } from './dashboard';
import { buildGoldReportsRouter } from './reports';

// The grants below ARE the gold system's own permission catalog (`config/permissions.js`,
// PERMISSION_CATALOG), resource by resource and action by action. Its `branches`, `users`, `roles`
// and `audit` groups are absent because ECMS owns those surfaces now.

const vaultPermissions = declarePermissions(
  'gold',
  'goldVault',
  { en: 'Gold vaults', ar: 'خزائن الذهب' },
  // Floors ride these grants too: a floor groups vaults on the board, and the gold system gated it
  // on the same authority rather than making "which shelf" a separate delegation.
  ['view', 'create', 'edit', 'delete'],
  [],
  'gold.vaults',
);

const barPermissions = declarePermissions(
  'gold',
  'goldBar',
  { en: 'Gold bars', ar: 'السبائك' },
  // No `create` and no `delete` by design: a bar is BORN from a confirmed receiving receipt and
  // LEAVES through a delivery. Bringing one into existence by hand is not an authority the gold
  // system granted, and the Bars screen says so.
  ['view', 'edit'],
  [],
  'gold.bars',
);

/** The three documents share a lifecycle, so they share a grant shape. */
const documentSpecials = (label: string, labelAr: string) => [
  {
    // Approving is the moment the document becomes fact — bars appear, leave, or change owner.
    // It is the single most consequential act in the module and is never bundled with `edit`.
    action: 'confirm',
    name: { en: `Confirm ${label}`, ar: `اعتماد ${labelAr}` },
  },
  {
    // Undoing an approved document. Separate from `confirm` for the same reason `dispose` is
    // separate from `assign` in IT: reversing a fact is a different decision from creating it.
    action: 'revert',
    name: { en: `Revert ${label}`, ar: `التراجع عن ${labelAr}` },
  },
];

const receivingPermissions = declarePermissions(
  'gold',
  'goldReceiving',
  { en: 'Gold receiving', ar: 'عمليات الدخول' },
  ['view', 'create', 'edit', 'print'],
  [
    ...documentSpecials('receiving receipts', 'إيصالات الدخول'),
    {
      // Bulk intake from a spreadsheet. The parsing happens in the browser and the rows arrive as
      // ordinary lines, so this grant has no endpoint of its own — it gates the control, exactly
      // as it did in the gold system.
      action: 'import',
      name: { en: 'Import bars from a spreadsheet', ar: 'استيراد السبائك من ملف' },
    },
  ],
  'gold.receiving',
);

const deliveryPermissions = declarePermissions(
  'gold',
  'goldDelivery',
  { en: 'Gold delivery', ar: 'عمليات الخروج' },
  ['view', 'create', 'edit', 'print'],
  documentSpecials('delivery orders', 'أوامر الخروج'),
  'gold.delivery',
);

const transferPermissions = declarePermissions(
  'gold',
  'goldTransfer',
  { en: 'Gold transfers', ar: 'عمليات التحويل' },
  ['view', 'create', 'edit', 'print'],
  documentSpecials('ownership transfers', 'أوامر التحويل'),
  'gold.transfers',
);

const keyPermissions = declarePermissions(
  'gold',
  'goldKey',
  { en: 'Drawer keys', ar: 'مفاتيح الأدراج' },
  ['view', 'create', 'delete', 'print'],
  [
    {
      // Taking a key BACK is its own grant, as it was in the gold catalog: handing a customer the
      // key to a drawer and closing that out are decisions different people make.
      action: 'return',
      name: { en: 'Take drawer keys back', ar: 'استرجاع المفاتيح' },
    },
  ],
  'gold.keys',
);

const companyPermissions = declarePermissions(
  'gold',
  'goldCompany',
  { en: 'Metal owners', ar: 'الشركات والصناديق' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'gold.companies',
);

const representativePermissions = declarePermissions(
  'gold',
  'goldRepresentative',
  { en: 'Owner delegates', ar: 'مندوبو الشركات' },
  ['view', 'create', 'edit', 'delete'],
  [],
  'gold.representatives',
);

const reportPermissions = declarePermissions(
  'gold',
  'goldReport',
  { en: 'Vault reports', ar: 'تقارير الخزينة' },
  // ONE grant for the board and the printed statements: they answer the same question at two
  // resolutions, and the gold system gated both on its single `view_reports` permission.
  ['view'],
  [],
  'gold.dashboard',
);

export const goldPermissions: PermissionDef[] = [
  ...reportPermissions,
  ...vaultPermissions,
  ...barPermissions,
  ...receivingPermissions,
  ...deliveryPermissions,
  ...transferPermissions,
  ...keyPermissions,
  ...companyPermissions,
  ...representativePermissions,
];

/**
 * The administration surfaces this module owns — the middle layer of the role matrix.
 * Organizational only: nothing authorizes on a page.
 */
export const goldPages: PageDef[] = [
  {
    id: 'gold.dashboard',
    moduleId: 'gold',
    name: { en: 'Dashboard and reports', ar: 'لوحة التحكم والتقارير' },
    route: '/gold',
    sortOrder: 10,
  },
  {
    id: 'gold.vaults',
    moduleId: 'gold',
    name: { en: 'Vaults', ar: 'الخزائن' },
    route: '/gold/vaults',
    sortOrder: 20,
  },
  {
    id: 'gold.bars',
    moduleId: 'gold',
    name: { en: 'Bars', ar: 'السبائك' },
    route: '/gold/bars',
    sortOrder: 30,
  },
  {
    id: 'gold.receiving',
    moduleId: 'gold',
    name: { en: 'Receiving', ar: 'عمليات الدخول' },
    route: '/gold/receiving',
    sortOrder: 40,
  },
  {
    id: 'gold.delivery',
    moduleId: 'gold',
    name: { en: 'Delivery', ar: 'عمليات الخروج' },
    route: '/gold/delivery',
    sortOrder: 50,
  },
  {
    id: 'gold.transfers',
    moduleId: 'gold',
    name: { en: 'Transfers', ar: 'عمليات التحويل' },
    route: '/gold/transfers',
    sortOrder: 60,
  },
  {
    id: 'gold.keys',
    moduleId: 'gold',
    name: { en: 'Drawer keys', ar: 'المفاتيح' },
    route: '/gold/keys',
    sortOrder: 70,
  },
  {
    id: 'gold.companies',
    moduleId: 'gold',
    name: { en: 'Owners', ar: 'الشركات والصناديق' },
    route: '/gold/companies',
    sortOrder: 80,
  },
  {
    id: 'gold.representatives',
    moduleId: 'gold',
    name: { en: 'Delegates', ar: 'المندوبون' },
    route: '/gold/representatives',
    sortOrder: 90,
  },
];

export const goldModule: ModuleManifest = {
  id: 'gold',
  name: { en: 'Gold Vault', ar: 'خزائن الذهب' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: goldPermissions,
  pages: goldPages,
  routes: [
    { prefix: '/gold/dashboard', router: buildGoldDashboardRouter() },
    { prefix: '/gold/reports', router: buildGoldReportsRouter() },
    { prefix: '/gold/vaults', router: buildGoldVaultsRouter() },
    { prefix: '/gold/drawers', router: buildGoldDrawersRouter() },
    { prefix: '/gold/floors', router: buildGoldFloorsRouter() },
    { prefix: '/gold/bars', router: buildGoldBarsRouter() },
    { prefix: '/gold/receiving', router: buildGoldReceivingRouter() },
    { prefix: '/gold/delivery', router: buildGoldDeliveryRouter() },
    { prefix: '/gold/transfers', router: buildGoldTransfersRouter() },
    { prefix: '/gold/keys', router: buildGoldKeysRouter() },
    { prefix: '/gold/companies', router: buildGoldCompaniesRouter() },
    { prefix: '/gold/representatives', router: buildGoldRepresentativesRouter() },
  ],
  collections: [
    'gold_companies',
    'gold_representatives',
    'gold_floors',
    'gold_vaults',
    'gold_drawers',
    'gold_bars',
    'gold_receiving_receipts',
    'gold_delivery_receipts',
    'gold_transfers',
    'gold_key_handovers',
  ],
  // The gold system emitted nothing and listened to nothing, and the port does not invent traffic
  // it never had. When the vault needs to react to an HR exit or announce a movement, that is a
  // decision to take on purpose, with a payload somebody designed.
  eventSubscriptions: [],
};
