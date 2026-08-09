// IT module manifest (frozen design docs/12-planning/it-module-design.md v1.2, slices IT-1…IT-5).
// Delivered incrementally exactly as HR and Fleet were: IT-1 registered the catalogs, vendors and
// the asset register; IT-2 added the custody lifecycle, its append-only history and the HR-exit
// subscription; IT-3 adds the help desk — priorities carrying their SLA targets, tickets, the one
// stream that is both history and conversation, and the SLA + auto-close sweeps; IT-4 adds
// maintenance — preventive plans, work orders and the spare-parts ledger (ADR-024); IT-5 adds the
// software register — products, installations, licences and the expiry sweep (ADR-025). IT-6 adds
// dashboards — extending THIS manifest, never adding a second one.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildItCatalogRouter } from './catalog-items';
import { buildItVendorsRouter } from './vendors';
import { buildItAssetsRouter, buildItAssignmentsRouter, itAssetCustodyService } from './assets';
import {
  buildItMaintenanceOrdersRouter,
  buildItMaintenancePlansRouter,
  preventiveMaintenanceSweep,
} from './maintenance';
import { buildItSparePartsRouter } from './spare-parts';
import { buildItSoftwareInstallationsRouter, buildItSoftwareProductsRouter } from './software';
import { buildItLicensesRouter } from './licenses';
import { expirySweep } from './shared/expiry-sweeps';
import { registerItSettings } from './it.settings';
import {
  buildItTicketPrioritiesRouter,
  buildItTicketsRouter,
  itFileEntityAuthorizers,
  slaBreachSweep,
  ticketAutoCloseSweep,
} from './tickets';

// Declared at module load, before boot resolves any value (the Fleet precedent).
registerItSettings();

const assetPermissions = declarePermissions(
  'it',
  'itAsset',
  { en: 'IT assets', ar: 'أصول تقنية المعلومات' },
  // No `print` grant by design (§7): a label shows nothing `view` cannot. `export` arrives with
  // IT-6, where the operation it gates exists — a grant is declared WITH its operation, never
  // ahead of it.
  ['view', 'create', 'edit', 'delete'],
  [
    // IT-2 custody (§7). ONE grant for assign + return + transfer: they are a single operational
    // surface — whoever hands an asset out is who takes it back — and the roster precedent says
    // one surface, one grant.
    {
      action: 'assign',
      name: { en: 'Assign, return and transfer IT assets', ar: 'تسليم واسترجاع ونقل الأصول' },
    },
    // Disposal is its OWN grant: writing an asset off is a different decision from moving it
    // between hands, it is terminal, and it is the one custody act that cannot be undone.
    {
      action: 'dispose',
      name: { en: 'Dispose of IT assets', ar: 'استبعاد الأصول' },
    },
  ],
);

const catalogPermissions = declarePermissions(
  'it',
  'itCatalog',
  { en: 'IT catalogs', ar: 'قوائم تقنية المعلومات' },
  [],
  [
    // One grant for both kinds (asset + ticket categories) — the fleetCatalog.manage precedent.
    { action: 'manage', name: { en: 'Manage IT catalogs', ar: 'إدارة قوائم تقنية المعلومات' } },
  ],
);

const vendorPermissions = declarePermissions(
  'it',
  'itVendor',
  { en: 'IT vendors', ar: 'موردو تقنية المعلومات' },
  ['view'],
  [{ action: 'manage', name: { en: 'Manage IT vendors', ar: 'إدارة موردي تقنية المعلومات' } }],
);

const ticketPermissions = declarePermissions(
  'it',
  'itTicket',
  { en: 'IT tickets', ar: 'تذاكر الدعم الفني' },
  // `view` is SCOPED — `own` is what makes FR-8 ("a requester always sees their own tickets") a
  // scope rather than special-case code. `edit` means WORK the ticket: its fields, its status, its
  // internal notes.
  ['view', 'create', 'edit'],
  [
    {
      // Dispatch is its own authority: deciding who does the work differs from doing it.
      action: 'assign',
      name: { en: 'Assign IT tickets', ar: 'إسناد تذاكر الدعم' },
    },
    {
      // Close + reopen + cancel — one grant for both directions (§7's both-directions precedent).
      // A requester cancelling their OWN open ticket needs none of this (FR-14).
      action: 'close',
      name: { en: 'Close, reopen and cancel IT tickets', ar: 'إغلاق وإعادة فتح وإلغاء التذاكر' },
    },
  ],
);

const slaPolicyPermissions = declarePermissions(
  'it',
  'itSlaPolicy',
  { en: 'IT SLA policy', ar: 'سياسة زمن الاستجابة' },
  [],
  [
    {
      // Behaviour-carrying settings get their own grant (the `fleetMaintenanceRule.manage`
      // precedent): the priority IS the SLA policy, so editing it changes what the help desk
      // promises.
      action: 'manage',
      name: { en: 'Manage priorities and SLA targets', ar: 'إدارة الأولويات وأزمنة الاستجابة' },
    },
  ],
);

const maintenancePermissions = declarePermissions(
  'it',
  'itMaintenance',
  { en: 'IT maintenance', ar: 'صيانة تقنية المعلومات' },
  // No `delete`: an order is a business record. It ends by completing or by cancelling, and both
  // are below. `edit` covers the planning fields AND starting the work — scheduling a repair and
  // beginning it are one operational surface (the `itAsset.assign` argument).
  ['view', 'create', 'edit'],
  [
    {
      // Complete + cancel — one grant for both ways an order ends (the `itTicket.close`
      // both-directions precedent). Completing is what consumes stock and releases the asset;
      // cancelling is the same decision reached the other way.
      action: 'complete',
      name: { en: 'Complete and cancel maintenance orders', ar: 'إنهاء وإلغاء أوامر الصيانة' },
    },
  ],
);

const maintenancePlanPermissions = declarePermissions(
  'it',
  'itMaintenancePlan',
  { en: 'IT maintenance plans', ar: 'خطط الصيانة الوقائية' },
  [],
  [
    {
      // Behaviour-carrying data gets its own grant (the `itSlaPolicy.manage` precedent): a plan
      // GENERATES work orders, so editing one changes what the module does on its own.
      action: 'manage',
      name: { en: 'Manage preventive maintenance plans', ar: 'إدارة خطط الصيانة الوقائية' },
    },
  ],
);

const sparePartPermissions = declarePermissions(
  'it',
  'itSparePart',
  { en: 'IT spare parts', ar: 'قطع غيار تقنية المعلومات' },
  ['view'],
  [
    {
      // Catalog AND receipts (§7). Consumption is deliberately NOT here: stock leaves the store
      // only through an order's completion, under `itMaintenance.complete` (FR-9).
      action: 'manage',
      name: { en: 'Manage spare parts and receipts', ar: 'إدارة قطع الغيار والتوريدات' },
    },
  ],
);

const softwarePermissions = declarePermissions(
  'it',
  'itSoftware',
  { en: 'IT software', ar: 'برمجيات تقنية المعلومات' },
  ['view'],
  [
    {
      // ONE grant for products AND installations (§7). They are a single operational surface —
      // whoever curates the catalogue is who records what runs where — and it deliberately does
      // NOT widen asset access: the service loads the asset through this grant's own scope.
      action: 'manage',
      name: { en: 'Manage software products and installations', ar: 'إدارة البرمجيات والتنصيبات' },
    },
  ],
);

const licensePermissions = declarePermissions(
  'it',
  'itLicense',
  { en: 'IT licences', ar: 'تراخيص البرمجيات' },
  // `view` returns the licence KEY in plain text — §13-Q5's adopted decision. The grant IS the
  // boundary, which is why no reveal endpoint exists to be gated separately.
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Manage software licences', ar: 'إدارة تراخيص البرمجيات' },
    },
  ],
);

export const itPermissions: PermissionDef[] = [
  ...assetPermissions,
  ...catalogPermissions,
  ...vendorPermissions,
  ...ticketPermissions,
  ...slaPolicyPermissions,
  ...maintenancePermissions,
  ...maintenancePlanPermissions,
  ...sparePartPermissions,
  ...softwarePermissions,
  ...licensePermissions,
];

export const itModule: ModuleManifest = {
  id: 'it',
  name: { en: 'IT', ar: 'تقنية المعلومات' },
  version: '0.1.0',
  requiresPlatform: '^2.1',
  permissions: itPermissions,
  routes: [
    { prefix: '/it/assets', router: buildItAssetsRouter() },
    { prefix: '/it/assignments', router: buildItAssignmentsRouter() },
    { prefix: '/it/catalog-items', router: buildItCatalogRouter() },
    { prefix: '/it/vendors', router: buildItVendorsRouter() },
    { prefix: '/it/tickets', router: buildItTicketsRouter() },
    { prefix: '/it/ticket-priorities', router: buildItTicketPrioritiesRouter() },
    { prefix: '/it/maintenance-orders', router: buildItMaintenanceOrdersRouter() },
    { prefix: '/it/maintenance-plans', router: buildItMaintenancePlansRouter() },
    { prefix: '/it/spare-parts', router: buildItSparePartsRouter() },
    { prefix: '/it/software-products', router: buildItSoftwareProductsRouter() },
    { prefix: '/it/software-installations', router: buildItSoftwareInstallationsRouter() },
    { prefix: '/it/licenses', router: buildItLicensesRouter() },
  ],
  collections: [
    'it_assets',
    'it_asset_assignments',
    'it_asset_events',
    'it_catalog_items',
    'it_vendors',
    'it_sequences',
    'it_tickets',
    'it_ticket_events',
    'it_ticket_priorities',
    'it_maintenance_plans',
    'it_maintenance_orders',
    'it_spare_parts',
    'it_spare_part_movements',
    'it_software_products',
    'it_software_installations',
    'it_licenses',
    // Operational bookkeeping, not business data (ADR-025) — declared because the manifest is the
    // module's honest inventory of what it writes, whatever the rows mean.
    'it_sweep_marks',
  ],
  scheduledTasks: [
    {
      // §4.5 — stamp the clocks that have run out, exactly once each. Idempotent by construction:
      // the stamp IS the mark, so overlapping runs and replays are safe without a marks collection.
      key: 'it.slaSweep',
      description: 'Stamp SLA response/resolution breaches exactly once per phase (§4.5, FR-6)',
      cron: '*/5 * * * *',
      ownerService: 'it',
      handler: async () => {
        await slaBreachSweep();
      },
    },
    {
      // §4.4 — close tickets that have sat `resolved` past the window. 0 days disables it.
      key: 'it.autoCloseSweep',
      description: 'Close resolved tickets older than it.ticket.autoCloseDays (§4.4)',
      cron: '30 4 * * *',
      ownerService: 'it',
      handler: async () => {
        await ticketAutoCloseSweep();
      },
    },
    {
      // §4.6 — generate one open preventive order per plan due within the horizon. Idempotent by
      // construction: a plan gets no second order while the one it generated is unfinished, so the
      // guard IS the mark and no sweep-marks collection is needed.
      key: 'it.preventiveSweep',
      description: 'Generate preventive maintenance orders for plans due within the horizon (§4.6)',
      cron: '25 4 * * *',
      ownerService: 'it',
      handler: async () => {
        await preventiveMaintenanceSweep();
      },
    },
    {
      // §4.8 — warranties and licences in one daily pass. A pure announcer: it changes no business
      // state and writes only its own marks, so running it twice announces nothing twice
      // (ADR-025). 04:20 sits before the two 04:2x/04:3x sweeps, as the design lays them out.
      key: 'it.expirySweep',
      description:
        'Announce warranties and licences that have expired or fall inside their warn window (§4.8)',
      cron: '20 4 * * *',
      ownerService: 'it',
      handler: async () => {
        await expirySweep();
      },
    },
  ],
  // ADR-023 — IT answers the Files service's "may this caller see the owning entity?" for its two
  // file-carrying types. Declaring them is what makes ticket and comment attachments safe on EVERY
  // path, including a direct file id and a download ticket.
  fileEntityAuthorizers: itFileEntityAuthorizers,
  eventSubscriptions: [
    {
      // Design §9.1 / FR-13 — leaving the company does NOT return the assets. The leaver's open
      // assignments are recorded so the exit checklist has a safety net; a human still records the
      // physical return, because an automatic one would write a custody fact that never happened.
      // Event-driven, no HR import (the Fleet precedent).
      event: 'hr.employee.exited',
      handlerId: 'it.flagAssetsHeldByExitedEmployee',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await itAssetCustodyService.flagAssetsHeldByExitedEmployee(payload.employeeId);
        }
      },
    },
  ],
};
