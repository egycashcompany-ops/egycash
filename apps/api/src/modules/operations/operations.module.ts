// Operations / Cash Transfer module manifest (design docs/12-planning/operations-module-design.md).
//
// Delivered incrementally exactly as Fleet was. OP-1 registered the module and the domain
// vocabulary; OP-2 (this slice) adds the reference data the legacy "customer/location" model
// normalizes into (banks, bank branches, currencies — discovery §11) and the cash-shipment core
// (the legacy `transactions` row after the approved SPLIT — design §15). Later slices add the
// operations day, crew assignment, vault custody, sequencing, captain execution and reports —
// each extending THIS manifest, never adding a second one.
//
// Boundary (frozen, fleet-module-design.md §9.4): Fleet owns (vehicle, drivers, mission type) per
// day in `fleet_duty_assignments`; Operations attaches its cash-crew and work to that row by id
// and never re-models the roster. Business behaviour is ported from the legacy system by parity
// (operations-legacy-discovery.md) — legacy parity first, improvements second.
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildOperationsBanksRouter } from './banks/bank.routes';
import { buildOperationsBankBranchesRouter } from './bank-branches/bank-branch.routes';
import { buildOperationsCurrenciesRouter } from './currencies/currency.routes';
import { buildOperationsAreasRouter } from './areas/area.routes';
import { buildOperationsShipmentsRouter } from './shipments/shipment.routes';
import { buildOperationsDaysRouter } from './days/day.routes';
import { buildOperationsCrewRouter } from './crew/crew.routes';
import { buildOperationsStandingCrewRouter } from './standing-crew/standing-crew.routes';
import { registerOperationsSettings } from './operations.settings';
import { buildOperationsSecuredRouter } from './secured/secured.routes';
import { buildOperationsAssignmentsRouter } from './assignments/assignment.routes';
import { buildOperationsMobileRouter } from './mobile/mobile.routes';
import { buildOperationsReportsRouter } from './reports/report.routes';
import { seedOperations } from './operations.seed';
// Registers the interim vault-custody provider on the Treasury port at module load
// (see ./treasury-boundary.ts). Importing for the side effect is the platform seam convention.
import './vault/vault-custody.service';

const shipmentPermissions = declarePermissions(
  'operations',
  'operationsShipment',
  { en: 'cash shipments', ar: 'شحنات نقل الأموال' },
  ['view', 'create', 'edit', 'delete'],
  [
    // ONE grant, both directions (the fleet accident close/reopen precedent): the legacy receive
    // toggle confirmed AND un-confirmed delivery from the same cell (contad_app.js:553-566).
    {
      action: 'complete',
      name: { en: 'Complete or reopen a shipment', ar: 'تأكيد تسليم الشحنة أو التراجع عنه' },
    },
  ],
  'operations.shipments',
);

const catalogPermissions = declarePermissions(
  'operations',
  'operationsCatalog',
  { en: 'operations reference data', ar: 'البيانات المرجعية للعمليات' },
  [],
  [
    // One grant for the whole reference surface (the fleet-catalog precedent): banks, branches
    // and currencies are one settings screen, not separately delegable decisions.
    {
      action: 'manage',
      name: { en: 'Manage banks, branches and currencies', ar: 'إدارة البنوك والفروع والعملات' },
    },
  ],
  'operations.catalogs',
);

const crewPermissions = declarePermissions(
  'operations',
  'operationsCrew',
  { en: 'crew board', ar: 'لوحة التشغيلة' },
  ['view'],
  [
    // One grant covers the whole planning surface — assigning, moving and clearing are the same
    // operation on the same board (the fleet-roster precedent).
    { action: 'plan', name: { en: 'Plan the daily crew', ar: 'تخطيط تشغيلة اليوم' } },
    // A separate grant from `plan` (design §16.2): moving a captain's stops around is a decision
    // about EXECUTION ORDER, not about who crews which vehicle.
    {
      action: 'reorder',
      name: { en: "Reorder a captain's shipments", ar: 'إعادة ترتيب شحنات القائد' },
    },
  ],
  'operations.crew-board',
);

const dayPermissions = declarePermissions(
  'operations',
  'operationsDay',
  { en: 'operating days', ar: 'أيام التشغيل' },
  [],
  [
    // Create/open/close are one management decision surface (design §16.2 opsDay.manage).
    { action: 'manage', name: { en: 'Open and close operating days', ar: 'فتح وإغلاق أيام التشغيل' } },
  ],
  'operations.crew-board',
);

const vaultPermissions = declarePermissions(
  'operations',
  'operationsVault',
  { en: 'vault custody', ar: 'عهدة الخزينة' },
  ['view'],
  [
    // The treasury's own two acts. Separate from the Operations grants by design: the legacy
    // screens had different owners, and the Treasury port exists to keep them different.
    { action: 'receive', name: { en: 'Receive into the vault', ar: 'استلام في الخزينة' } },
    { action: 'dispatch', name: { en: 'Release and dispatch from the vault', ar: 'صرف من الخزينة' } },
  ],
  'operations.vault',
);

const executionPermissions = declarePermissions(
  'operations',
  'operationsExecution',
  { en: 'captain execution', ar: 'تنفيذ القائد' },
  [],
  [
    // The captain's OWN work and only their own — the service resolves "own" from the token's
    // employee, so this grant can never widen into somebody else's day (design §16.2).
    {
      action: 'own',
      name: { en: "Read and run one's own assigned route", ar: 'قراءة وتنفيذ مسار القائد نفسه' },
    },
  ],
  'operations.my-day',
);

registerOperationsSettings();

export const operationsPermissions: PermissionDef[] = [
  ...shipmentPermissions,
  ...catalogPermissions,
  ...crewPermissions,
  ...dayPermissions,
  ...vaultPermissions,
  ...executionPermissions,
];

export const operationsPages: PageDef[] = [
  {
    id: 'operations.shipments',
    moduleId: 'operations',
    name: { en: 'Cash shipments', ar: 'شحنات نقل الأموال' },
    route: '/operations/shipments',
    sortOrder: 10,
  },
  {
    id: 'operations.crew-board',
    moduleId: 'operations',
    name: { en: 'Daily crew board', ar: 'لوحة التشغيلة اليومية' },
    route: '/operations/crew-board',
    sortOrder: 20,
  },
  {
    id: 'operations.vault',
    moduleId: 'operations',
    name: { en: 'Vault custody', ar: 'عهدة الخزينة' },
    route: '/operations/vault',
    sortOrder: 30,
  },
  {
    id: 'operations.my-day',
    moduleId: 'operations',
    name: { en: "Captain's day", ar: 'يوم القائد' },
    route: '/operations/my-day',
    sortOrder: 40,
  },
  {
    id: 'operations.catalogs',
    moduleId: 'operations',
    name: { en: 'Operations reference data', ar: 'البيانات المرجعية للعمليات' },
    route: '/operations/catalogs',
    sortOrder: 90,
  },
];

export const operationsModule: ModuleManifest = {
  id: 'operations',
  name: { en: 'Operations', ar: 'العمليات' },
  // B5 added the two reports under a new `/operations/reports` prefix. They ride the EXISTING
  // `operationsShipment.view` grant — a report is a read of shipments the caller can already see —
  // and store nothing, so no permission or page was added.
  //
  // B6 completes the surface: the vault roll-up joins the reports prefix under the EXISTING
  // `operationsVault.view` grant, and the legacy `/data_edit` city list arrives as
  // `operations_areas` under the EXISTING catalog grants. One new prefix, one new collection, and
  // still no new permission or page — the catalogs page already owns the reference surface.
  //
  // The standing crew (الطاقم الثابت) follows the same shape a third time: one new prefix, one new
  // collection, no new permission and no new page. It rides `operationsCrew.view` / `.plan`,
  // because deciding who crews which vehicle is one authority whether it is said once or daily.
  version: '0.10.0',
  requiresPlatform: '^2.2',
  permissions: operationsPermissions,
  pages: operationsPages,
  routes: [
    { prefix: '/operations/shipments', router: buildOperationsShipmentsRouter() },
    { prefix: '/operations/banks', router: buildOperationsBanksRouter() },
    { prefix: '/operations/bank-branches', router: buildOperationsBankBranchesRouter() },
    { prefix: '/operations/currencies', router: buildOperationsCurrenciesRouter() },
    { prefix: '/operations/areas', router: buildOperationsAreasRouter() },
    { prefix: '/operations/days', router: buildOperationsDaysRouter() },
    { prefix: '/operations/crew-board', router: buildOperationsCrewRouter() },
    { prefix: '/operations/standing-crew', router: buildOperationsStandingCrewRouter() },
    { prefix: '/operations/secured', router: buildOperationsSecuredRouter() },
    { prefix: '/operations/assignments', router: buildOperationsAssignmentsRouter() },
    { prefix: '/operations/mobile', router: buildOperationsMobileRouter() },
    { prefix: '/operations/reports', router: buildOperationsReportsRouter() },
  ],
  collections: [
    'operations_shipments',
    'operations_banks',
    'operations_bank_branches',
    'operations_currencies',
    'operations_areas',
    'operations_days',
    'operations_crew_assignments',
    'operations_crew_requirements',
    'operations_standing_crews',
    'operations_vault_custody',
    'operations_shipment_assignments',
  ],
  eventSubscriptions: [],
  // Widens the seeded `super-admin` role with this module's grants on a database that ran the
  // platform seed before Operations existed. See operations.seed.ts — without it, no account on
  // such an install holds an `operations*` key and every endpoint here answers 403.
  seed: seedOperations,
};
