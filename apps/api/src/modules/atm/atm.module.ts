// ATM Operations module manifest (design docs/12-planning/atm-operations-port.md).
//
// The Operations slice of the legacy standalone ATM system, ported by parity: the seven pages the
// owner scoped (/atm_replenishment ±done, /atm_maintenance ±done, /mail_maintenance ±log,
// /all_atm) plus /data_edit_atm, added to scope by the owner after approval. The other legacy ATM
// sections (efficiency, back office, vaults, supplies, review, preparation) are NOT here — this
// manifest grows with those slices exactly as Fleet's and Operations' did, never a second one.
//
// Legacy privilege strings → grants (port doc §7.3): atm-user = the operating bundle,
// atm-user-review = view+complete on the done surfaces, atm-admin = everything incl. the mail
// log, Efficiency-admin touches only the machine master. Roles carry the mapping; keys stay per
// resource. Every legacy POST was unauthenticated (contad_app.js:632 …) — closed here by RBAC,
// the port's one non-negotiable behaviour change (port doc T-auth).
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildAtmMachinesRouter } from './machines/machine.routes';
import { buildAtmRefLabelsRouter } from './catalogs/ref-label.routes';
import { buildAtmReplenishmentsRouter } from './replenishments/replenishment.routes';
import { buildAtmMaintenancesRouter } from './maintenances/maintenance.routes';
import { buildAtmMailTicketsRouter } from './mail-tickets/mail-ticket.routes';
import { buildAtmReportsRouter } from './reports/report.routes';
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
    // The whole /data_edit_atm surface — bulk add, delete, area reassign, bank/area label lists —
    // is one settings screen, not separately delegable decisions (the catalog-grant precedent).
    {
      action: 'manage',
      name: {
        en: 'Manage the machine master and its lists',
        ar: 'إدارة بيانات الماكينات وقوائمها',
      },
    },
  ],
  'atm.machines',
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
    { prefix: '/atm/ref-labels', router: buildAtmRefLabelsRouter() },
    { prefix: '/atm/replenishments', router: buildAtmReplenishmentsRouter() },
    { prefix: '/atm/maintenances', router: buildAtmMaintenancesRouter() },
    { prefix: '/atm/mail-tickets', router: buildAtmMailTicketsRouter() },
    // The daily report rides the existing view grants — no permission, no page (port doc D7).
    { prefix: '/atm/reports', router: buildAtmReportsRouter() },
  ],
  collections: [
    'atm_machines',
    'atm_ref_labels',
    'atm_replenishments',
    'atm_maintenances',
    'atm_mail_tickets',
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
  ],
  seed: seedAtm,
};
