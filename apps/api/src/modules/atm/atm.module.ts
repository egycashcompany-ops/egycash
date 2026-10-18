// ATM Operations module manifest (design docs/12-planning/atm-operations-port.md).
//
// The Operations slice of the legacy standalone ATM system, ported by parity: the seven pages the
// owner scoped (/atm_replenishment ±done, /atm_maintenance ±done, /mail_maintenance ±log,
// /all_atm) plus /data_edit_atm, added to scope by the owner after approval. The Efficiency &
// Investigations slice is here too (docs/12-planning/atm-efficiency-register.md): the machine
// register and its Data Report, from the owner's workbook. The other legacy ATM sections (back
// office, vaults, supplies, review, preparation) are NOT here — this manifest grows with those
// slices exactly as Fleet's and Operations' did, never a second one.
//
// Legacy privilege strings → grants (port doc §7.3): atm-user = the operating bundle,
// atm-user-review = view+complete on the done surfaces, atm-admin = everything incl. the mail
// log, Efficiency-admin = the register keys (`atmRegister.*`, `atmRegisterReport.view`) — the
// register now controls which machines exist (D2). Roles carry the mapping; keys stay per
// resource. Every legacy POST was unauthenticated (contad_app.js:632 …) — closed here by RBAC,
// the port's one non-negotiable behaviour change (port doc T-auth).
// The machine map and its owner-drawn zones sit here too (docs/12-planning/atm-map-zones.md).
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildAtmMachinesRouter } from './machines/machine.routes';
import { buildAtmRefLabelsRouter } from './catalogs/ref-label.routes';
import { buildAtmReplenishmentsRouter } from './replenishments/replenishment.routes';
import { buildAtmMaintenancesRouter } from './maintenances/maintenance.routes';
import { buildAtmMailTicketsRouter } from './mail-tickets/mail-ticket.routes';
import { buildAtmReportsRouter } from './reports/report.routes';
import { buildAtmRegisterRouter } from './register/register.routes';
import { buildAtmRegisterImportRouter } from './register/import/register-import.routes';
import { buildAtmMapRouter } from './map/map.routes';
import { rotateRegisterCombinationKeys } from './register/register-secrets';
import { registerAtmSettings } from './atm.settings';
import { seedAtm } from './atm.seed';
import { pollAtmMailbox } from './mail-tickets/mail-poll.service';
import { registerGraphMailSource } from './mail-tickets/graph-mail.source';

const replenishmentPermissions = declarePermissions(
  'atm',
  'atmReplenishment',
  { en: 'ATM replenishments', ar: 'تغذيات الصراف الآلي' },
  ['view', 'create', 'edit', 'delete'],
  [
    // ONE grant, both directions (the operations-shipment precedent): the legacy closed from the
    // live page and REOPENED from the done page's double-click (contad_app.js:782, :1032) — one
    // authority over the same fact.
    {
      action: 'complete',
      name: { en: 'Close or reopen a replenishment', ar: 'إغلاق التغذية أو إعادة فتحها' },
    },
  ],
  'atm.replenishments',
);

const maintenancePermissions = declarePermissions(
  'atm',
  'atmMaintenance',
  { en: 'ATM maintenance', ar: 'صيانات الصراف الآلي' },
  ['view', 'create', 'edit', 'delete'],
  [
    {
      action: 'complete',
      name: { en: 'Close or reopen a maintenance', ar: 'إغلاق الصيانة أو إعادة فتحها' },
    },
  ],
  'atm.maintenance',
);

const mailTicketPermissions = declarePermissions(
  'atm',
  'atmMailTicket',
  { en: 'ATM maintenance mail', ar: 'رسائل صيانة الصراف الآلي' },
  ['view'],
  [
    // Accept and reject are one screen and one authority — the two-direction-cell precedent.
    {
      action: 'decide',
      name: { en: 'Accept or reject a maintenance mail', ar: 'قبول رسالة الصيانة أو رفضها' },
    },
    // The legacy log page had a strictly smaller privilege set than the pending page
    // (contad_app.js:2901 admin-only vs :2634) — a separate grant is that fact, kept.
    {
      action: 'viewLog',
      name: { en: 'View the mail decisions log', ar: 'عرض سجل قرارات الرسائل' },
    },
  ],
  'atm.mail-tickets',
);

const machinePermissions = declarePermissions(
  'atm',
  'atmMachine',
  { en: 'ATM machines', ar: 'ماكينات الصراف الآلي' },
  ['view'],
  [
    // The administrator's half of /data_edit_atm — add, bulk add, delete-by-codes, archive,
    // reassign, label delete. Since the register controls which machines exist (D2), Operations
    // keep only the keys below and `atmRefLabel.*`.
    {
      action: 'manage',
      name: {
        en: 'Manage the machine master and its lists',
        ar: 'إدارة بيانات الماكينات وقوائمها',
      },
    },
    // Legacy «نقل ماكينة لمنطقة» (contad_app.js:2529-2541), kept for Operations (D2): the area
    // only, through its own route (DEC-3); the machine's open register entries move with it.
    {
      action: 'moveArea',
      name: { en: 'Move a machine to another area', ar: 'نقل ماكينة لمنطقة' },
    },
  ],
  'atm.machines',
);

// The bank and area label lists on their own resource (DEC-2): a role may add or rename a label
// without any authority over machines. Deleting a label stays `atmMachine.manage`.
const refLabelPermissions = declarePermissions(
  'atm',
  'atmRefLabel',
  { en: 'ATM bank and area lists', ar: 'قوائم البنوك والمناطق للصراف الآلي' },
  ['create', 'edit'],
  [],
  'atm.machines',
);

// The Efficiency register (D1–D8). Reading is per branch (DEC-29); the three specials are the
// owner's own actions beside the standard ones: hand a machine back, see its keys and reveal the
// combination (an audited read — D3), and import the workbook (D8).
const registerPermissions = declarePermissions(
  'atm',
  'atmRegister',
  { en: 'ATM register', ar: 'سجل الماكينات' },
  ['view', 'create', 'edit', 'delete', 'export'],
  [
    {
      action: 'handover',
      name: { en: 'Hand a machine back to the bank', ar: 'تسليم ماكينة للبنك' },
    },
    {
      action: 'viewSecrets',
      name: {
        en: 'View machine keys and reveal the safe-door combination',
        ar: 'عرض مفاتيح الماكينة وكشف الرقم السري لباب الخزينة',
      },
    },
    {
      action: 'import',
      name: { en: 'Import the register workbook', ar: 'استيراد ملف سجل الماكينات' },
    },
  ],
  'atm.register',
);

// The Data Report on a key of its own (D7): a report reader need not see one register row.
const registerReportPermissions = declarePermissions(
  'atm',
  'atmRegisterReport',
  { en: 'ATM Data Report', ar: 'تقرير بيانات الماكينات' },
  ['view'],
  [],
  'atm.register-report',
);

// The machine map (docs/12-planning/atm-map-zones.md): reading is per branch, finer scopes narrow
// to it and `own` reads nothing (DM-10).
const mapPermissions = declarePermissions(
  'atm',
  'atmMap',
  { en: 'ATM machine map', ar: 'خريطة الماكينات' },
  ['view'],
  [],
  'atm.map',
);

// Zones are drawn for ONE branch, the top bar's (D-M6); every write asks that the key reach it.
const zonePermissions = declarePermissions(
  'atm',
  'atmZone',
  { en: 'ATM map zones', ar: 'قطاعات خريطة الماكينات' },
  [],
  [
    {
      action: 'manage',
      name: {
        en: 'Draw, edit, delete and reorder map zones',
        ar: 'رسم القطاعات وتعديلها وحذفها وترتيبها',
      },
    },
  ],
  'atm.map',
);

// Placing a machine on the map sits on the map page, beside the zones (DM-42).
const locatePermissions = declarePermissions(
  'atm',
  'atmMachine',
  { en: 'ATM machines', ar: 'ماكينات الصراف الآلي' },
  [],
  [
    {
      action: 'locate',
      name: {
        en: 'Place, move or approve a machine location on the map',
        ar: 'تحديد موقع الماكينة على الخريطة وتعديله واعتماده',
      },
    },
  ],
  'atm.map',
);

registerAtmSettings();
// Opt-in and silent when no mailbox is configured (the OCR-sidecar precedent): without the four
// `ATM_MAIL_GRAPH_*` settings nothing registers and the poll task below does nothing at all.
registerGraphMailSource();

export const atmPermissions: PermissionDef[] = [
  ...replenishmentPermissions,
  ...maintenancePermissions,
  ...mailTicketPermissions,
  ...machinePermissions,
  ...refLabelPermissions,
  ...registerPermissions,
  ...registerReportPermissions,
  ...mapPermissions,
  ...zonePermissions,
  ...locatePermissions,
];

export const atmPages: PageDef[] = [
  {
    id: 'atm.replenishments',
    moduleId: 'atm',
    name: { en: 'Replenishments', ar: 'التغذيات' },
    route: '/atm/replenishments',
    sortOrder: 10,
  },
  {
    id: 'atm.maintenance',
    moduleId: 'atm',
    name: { en: 'Maintenance', ar: 'الصيانات' },
    route: '/atm/maintenance',
    sortOrder: 20,
  },
  {
    id: 'atm.mail-tickets',
    moduleId: 'atm',
    name: { en: 'Maintenance mail', ar: 'رسائل الصيانة' },
    route: '/atm/mail-tickets',
    sortOrder: 30,
  },
  {
    id: 'atm.machines',
    moduleId: 'atm',
    name: { en: 'Machines', ar: 'الماكينات' },
    route: '/atm/machines',
    sortOrder: 40,
  },
  {
    id: 'atm.map',
    moduleId: 'atm',
    name: { en: 'Machines map', ar: 'خريطة الماكينات' },
    route: '/atm/map',
    sortOrder: 45,
  },
  {
    id: 'atm.register',
    moduleId: 'atm',
    name: { en: 'ATM register', ar: 'سجل الماكينات' },
    route: '/atm/register',
    sortOrder: 50,
  },
  {
    id: 'atm.register-report',
    moduleId: 'atm',
    name: { en: 'Data Report', ar: 'تقرير البيانات' },
    route: '/atm/register/report',
    sortOrder: 60,
  },
];

export const atmModule: ModuleManifest = {
  id: 'atm',
  name: { en: 'ATM Operations', ar: 'عمليات الصراف الآلي' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: atmPermissions,
  pages: atmPages,
  routes: [
    { prefix: '/atm/machines', router: buildAtmMachinesRouter() },
    { prefix: '/atm/map', router: buildAtmMapRouter() },
    { prefix: '/atm/ref-labels', router: buildAtmRefLabelsRouter() },
    { prefix: '/atm/replenishments', router: buildAtmReplenishmentsRouter() },
    { prefix: '/atm/maintenances', router: buildAtmMaintenancesRouter() },
    { prefix: '/atm/mail-tickets', router: buildAtmMailTicketsRouter() },
    // The daily report rides the existing view grants — no permission, no page (port doc D7).
    { prefix: '/atm/reports', router: buildAtmReportsRouter() },
    // The import BEFORE the register: its prefix sits inside the register's.
    { prefix: '/atm/register/import', router: buildAtmRegisterImportRouter() },
    { prefix: '/atm/register', router: buildAtmRegisterRouter() },
  ],
  collections: [
    'atm_machines',
    'atm_ref_labels',
    'atm_replenishments',
    'atm_maintenances',
    'atm_mail_tickets',
    'atm_register_entries',
    'atm_register_import_runs',
    'atm_machine_locations',
    'atm_map_zone_sets',
    'atm_map_zones',
  ],
  eventSubscriptions: [],
  scheduledTasks: [
    {
      // The legacy reader polled every 60s (Automation/src/index.js:237); one minute is also the
      // finest a 5-field cron expresses, so the cadence is carried exactly. Inert without a
      // configured mailbox, and idempotent with one: a message already ingested is recognised by
      // its `providerMessageId` and costs one indexed read.
      key: 'atm.mailPoll',
      description: "Read the maintenance mailbox and file each mail under its machine's branch",
      cron: '* * * * *',
      ownerService: 'atm',
      handler: async () => {
        await pollAtmMailbox();
      },
    },
    {
      // DEC-33, the `automation.rotateCredentialKeys` shape: the documented key rotation drops the
      // old key after the re-wrap, so without this sweep every reveal would fail afterwards.
      key: 'atm.rotateRegisterCombinationKeys',
      description:
        'Re-wrap register safe-door combinations still sealed under a retired key. Touches the data key only — no plaintext exists at any point.',
      // Nightly, after the automation sweep at 02:30.
      cron: '45 2 * * *',
      ownerService: 'atm',
      handler: async () => {
        await rotateRegisterCombinationKeys();
      },
    },
  ],
  seed: seedAtm,
};
