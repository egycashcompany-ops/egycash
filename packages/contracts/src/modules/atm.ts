// ATM Operations — the domain vocabulary, DTOs and input schemas (module `atm`).
//
// This file is the normalized form of the legacy standalone ATM system
// (`egycashcompany-ops/ATM`: contad_app.js + models/ + views/events/*.ejs), ported by parity:
// the legacy behaviour is the specification, and every deliberate deviation is recorded in
// docs/12-planning/atm-operations-port.md (the gold-module-port precedent). File:line references
// below point into that repo.
//
// The legacy encodes an operation's lifecycle as `end: 0|1` plus a vestigial `status` that is
// written 0 at creation and never changed (models/atm_rep_log.js:19). Here the open state IS
// `closedAt: null` — the fleet maintenance-visit precedent ("no status field to forget to flip").
import { z } from 'zod';
import { PaginationQuerySchema, booleanQuery, listQuery, objectId } from '../common/index.js';

// ── Machine identity ────────────────────────────────────────────────────────────────────────────

/**
 * The one code rule every legacy entry point applies: trim, then strip leading zeros — the form
 * does it per line (`atm_replenishment.ejs:2025-2028`) and the mail reader does it on both email
 * formats (`Automation/src/index.js:73,85`). Shared here so client, server and the mail parser
 * cannot disagree about what "the same machine" means.
 */
export const normalizeAtmMachineCode = (raw: string): string => raw.trim().replace(/^0+/, '');

/**
 * Multi-line textarea → machine codes, in input order. The legacy multi-row forms split on
 * newlines and align sibling textareas BY LINE NUMBER (contad_app.js:640-641, 1897-1899); blank
 * lines are kept as empty strings there, so alignment survives — parsing is shared for the same
 * reason the code rule is.
 */
export const splitAtmFormLines = (raw: string): string[] =>
  raw.split('\n').map((line) => line.trim());

// ── Mail ticket status ──────────────────────────────────────────────────────────────────────────

/** Legacy `atm_mails.status`: 0 = pending (unread), 1 = accepted, 2 = rejected — both terminal. */
export const ATM_MAIL_TICKET_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export const AtmMailTicketStatusSchema = z.enum(ATM_MAIL_TICKET_STATUSES);
export type AtmMailTicketStatus = z.infer<typeof AtmMailTicketStatusSchema>;

/** Numeric legacy encoding (contad_app.js:2773 reject=2, :2836 accept=1), for migration parity. */
export const LEGACY_ATM_MAIL_STATUS_BY_CODE: Record<number, AtmMailTicketStatus> = {
  0: 'pending',
  1: 'accepted',
  2: 'rejected',
};

// ── Maintenance source ──────────────────────────────────────────────────────────────────────────

/**
 * Where a maintenance operation came from: typed on the page (contad_app.js:1896) or accepted
 * from a mail ticket (:2829). NEW as a stored field — legacy rows are indistinguishable after the
 * fact, which is exactly why the port keeps the provenance.
 */
export const ATM_MAINTENANCE_SOURCES = ['manual', 'mail'] as const;
export const AtmMaintenanceSourceSchema = z.enum(ATM_MAINTENANCE_SOURCES);
export type AtmMaintenanceSource = z.infer<typeof AtmMaintenanceSourceSchema>;

// ── Timer thresholds (UI behaviour, preserved verbatim) ─────────────────────────────────────────

/**
 * The live "Taken Time" colour ladder on the open replenishment rows
 * (atm_replenishment.ejs:1915-1921): ≥1h green, ≥2h yellow, ≥3h crimson. Data here so the web
 * timer and its spec share one source.
 */
export const ATM_TIMER_THRESHOLD_HOURS = { green: 1, yellow: 2, red: 3 } as const;

// ── Machine (legacy `atm` master) ───────────────────────────────────────────────────────────────

export interface AtmMachineDto {
  id: string;
  /**
   * NEW: the ECMS organization branch. Legacy had no branch field — a branch WAS a separate
   * deployment (one server+DB per branch, contad_app.js:221-224); one central database makes the
   * branch explicit, and it is resolved server-side from the caller, never trusted from a form.
   */
  branchId: string;
  /** Legacy `bank` — a label from the ATM-owned bank list, stored verbatim on the machine. */
  bankName: string;
  /** Legacy `mach_id` — the machine identity every screen joins on. Normalized (no leading zeros). */
  machineCode: string;
  name: string;
  /** Legacy `zone` — written as '' by every live code path (contad_app.js:2443); kept for parity. */
  zone: string;
  /** Legacy `area` — the operational grouping the leader cascade works over. */
  area: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The legacy bulk add (contad_app.js:2412-2466): code+name line pairs plus one bank and one area
 * for the whole batch. Codes already registered are skipped, not errors (:2429-2451) — the result
 * names them so the operator finally SEES the skip the legacy performed silently.
 */
export const BulkCreateAtmMachinesSchema = z
  .object({
    bankName: z.string().min(1),
    area: z.string().min(1),
    machines: z
      .array(z.object({ machineCode: z.string().min(1), name: z.string().min(1) }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export type BulkCreateAtmMachines = z.infer<typeof BulkCreateAtmMachinesSchema>;

export interface BulkCreateAtmMachinesResultDto {
  created: AtmMachineDto[];
  /** Codes already present (active) in the caller's branch — skipped exactly as legacy did. */
  skippedCodes: string[];
}

/**
 * Legacy machine delete (contad_app.js:2494-2508): soft delete AND rename the code to
 * `<code>-D`, which is what lets the same code be registered again later. Both preserved.
 */
export const BulkDeleteAtmMachinesSchema = z
  .object({ machineCodes: z.array(z.string().min(1)).min(1).max(500) })
  .strict();
export type BulkDeleteAtmMachines = z.infer<typeof BulkDeleteAtmMachinesSchema>;

export interface BulkDeleteAtmMachinesResultDto {
  deletedCodes: string[];
  /** Codes with no active machine in the caller's branch — legacy ignored these silently. */
  unknownCodes: string[];
}

/**
 * Single machine add — the per-item entry the data-edit screen offers alongside the legacy bulk
 * paste. Same fields the bulk form sets per row, plus the bank and area that the bulk form fixes
 * for the whole batch. `zone` is not offered: every legacy write stored '' (contad_app.js:2443).
 */
export const CreateAtmMachineSchema = z
  .object({
    bankName: z.string().min(1),
    area: z.string().min(1),
    machineCode: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type CreateAtmMachine = z.infer<typeof CreateAtmMachineSchema>;

/**
 * Edit one machine. `machineCode` is IDENTITY and is not editable — every operation row snapshots
 * it and the mail reader matches on it, so changing it would silently orphan history; a machine
 * registered under the wrong code is deleted (freeing the code via the `-D` rename) and re-added.
 *
 * `isActive` is the archive switch: an inactive machine disappears from the open forms and the
 * mail matcher (both read active only) while its code stays taken and its history stays readable
 * — which is the difference between this and delete.
 */
export const UpdateAtmMachineSchema = z
  .object({
    bankName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    area: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmMachine = z.infer<typeof UpdateAtmMachineSchema>;

/** Legacy "نقل ماكينة لمنطقة" (contad_app.js:2529-2541): rebase one machine onto another area. */
export const ReassignAtmMachineAreaSchema = z
  .object({ machineCode: z.string().min(1), area: z.string().min(1) })
  .strict();
export type ReassignAtmMachineArea = z.infer<typeof ReassignAtmMachineAreaSchema>;

export const ListAtmMachinesQuerySchema = PaginationQuerySchema.extend({
  isActive: booleanQuery().optional(),
  search: z.string().optional(),
  bankName: z.string().optional(),
  area: z.string().optional(),
}).strict();
export type ListAtmMachinesQuery = z.infer<typeof ListAtmMachinesQuerySchema>;

// ── Reference labels (legacy `atm_data_lists.bank[]` / `.area[]`) ───────────────────────────────
//
// The legacy singleton document held seven arrays; only `bank` and `area` are read or written by
// any live code path (contad_app.js:2477-2524 write them; data_edit_atm.ejs renders them). The
// other five (`zone`, `leaders`, `ops_emp`, `rep`, `maint`) are dead and are not carried —
// port doc GAP G4. These are ATM-OWNED lists, deliberately not the operations bank catalog:
// the legacy kept `atm_data_lists` separate from `data_lists`, the lists are administered by
// different teams, and `data_edit_atm` ADDS and REMOVES entries — a write no module may perform
// on another module's collection (port doc decision D1).

export interface AtmRefLabelDto {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateAtmRefLabelSchema = z.object({ name: z.string().min(1) }).strict();

/**
 * Edit one label. Renaming is deliberate and NOT a cascade: machines store the bank and area as
 * text (the legacy denormalized both, contad_app.js:2443), so a rename changes the list the forms
 * offer from now on and leaves already-registered machines saying what they said. `isActive`
 * archives instead of removing — the list stops offering it, the machines keep it.
 */
export const UpdateAtmRefLabelSchema = z
  .object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmRefLabel = z.infer<typeof UpdateAtmRefLabelSchema>;
export type CreateAtmRefLabel = z.infer<typeof CreateAtmRefLabelSchema>;

export const ListAtmRefLabelsQuerySchema = PaginationQuerySchema.extend({
  isActive: booleanQuery().optional(),
}).strict();
export type ListAtmRefLabelsQuery = z.infer<typeof ListAtmRefLabelsQuerySchema>;

// ── Operations (replenishment + maintenance) shared shapes ──────────────────────────────────────

/** Bulk id selection — the checkbox multi-select every legacy grid action supports. */
export const AtmOperationIdsSchema = z
  .object({ ids: z.array(objectId()).min(1).max(200) })
  .strict();
export type AtmOperationIds = z.infer<typeof AtmOperationIdsSchema>;

/**
 * Open replenishment/maintenance list — bank/area narrowing. The legacy stored these per user in
 * a `filters` collection (models/filters.js) and applied them server-side; the port carries them
 * as query parameters and lets the client persist its own choice, which keeps the same visible
 * behaviour without a server-side preference store (port doc §7.4).
 */
export const ListAtmOpenOperationsQuerySchema = PaginationQuerySchema.extend({
  banks: listQuery(z.string().min(1)),
  areas: listQuery(z.string().min(1)),
}).strict();
export type ListAtmOpenOperationsQuery = z.infer<typeof ListAtmOpenOperationsQuerySchema>;

/** Distinct bank/area values of the OPEN rows — the legacy filter dropdowns (contad_app.js:261-262). */
export interface AtmOperationFacetsDto {
  banks: string[];
  areas: string[];
}

/**
 * Done pages — `close_time` day range, both ends inclusive, defaulting to today when absent
 * (contad_app.js:941-964). Calendar dates, resolved against Africa/Cairo by the server.
 */
export const ListAtmDoneOperationsQuerySchema = PaginationQuerySchema.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
}).strict();
export type ListAtmDoneOperationsQuery = z.infer<typeof ListAtmDoneOperationsQuerySchema>;

// ── Replenishment (legacy `atm_rep_log`) ────────────────────────────────────────────────────────

export interface AtmReplenishmentDto {
  id: string;
  branchId: string;
  /** The master row the snapshot came from — the snapshot fields stay the record (gold precedent). */
  machineId: string;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: string;
  closedAt: string | null;
  /** Legacy `schedule_time` — free text, one per line of the open form. */
  scheduleTime: string | null;
  /** Legacy `leader` — free text on replenishments (atm_replenishment.ejs:1265). */
  leaderName: string | null;
  /** Legacy `ops_emp` ("Added By") — now the authenticated opener, snapshotted at write. */
  openedByName: string | null;
  /** Legacy `ops_emp2` ("Closed By"). Survives a reopen exactly as legacy left it. */
  closedByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The multi-row open form (contad_app.js:637-768): one line per machine with its schedule text.
 * `forceDate` today/absent → opened now; another date → opened at 06:00 Africa/Cairo of that day
 * (:726, normalized from the legacy's fake-UTC composition — port doc quirk T1).
 */
export const OpenAtmReplenishmentsSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            machineCode: z.string().min(1),
            scheduleTime: z.string().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    forceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type OpenAtmReplenishments = z.infer<typeof OpenAtmReplenishmentsSchema>;

/** Codes with no active machine are reported back, not silently shared state (quirk G-race). */
export interface OpenAtmReplenishmentsResultDto {
  opened: AtmReplenishmentDto[];
  unknownCodes: string[];
}

export const UpdateAtmReplenishmentSchema = z
  .object({
    scheduleTime: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    /**
     * Setting a DIFFERENT leader cascades to every open replenishment of the same area within the
     * same shift window (06:00–16:00 / 16:00–06:00 Cairo — contad_app.js:854-868), exactly as
     * legacy. The cascade fires only when `openedAt` is not being changed in the same submit —
     * the legacy's own precedence (:854-859), preserved.
     */
    leaderName: z.string().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmReplenishment = z.infer<typeof UpdateAtmReplenishmentSchema>;

/** Checked-rows edit (contad_app.js:870-889): schedule/open time on all, leader on all if changed. */
export const BulkUpdateAtmReplenishmentsSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(200),
    scheduleTime: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    leaderName: z.string().nullable().optional(),
  })
  .strict();
export type BulkUpdateAtmReplenishments = z.infer<typeof BulkUpdateAtmReplenishmentsSchema>;

// ── Maintenance (legacy `atm_maint_log`) ────────────────────────────────────────────────────────

export interface AtmMaintenanceDto {
  id: string;
  branchId: string;
  machineId: string;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: string;
  closedAt: string | null;
  /** Legacy `service_type` — per-line on the open form; the mail issue text on accepted tickets. */
  serviceType: string | null;
  notes: string | null;
  referenceNumber: string | null;
  source: AtmMaintenanceSource;
  /** The accepted mail ticket behind a `mail` row — the join the legacy lost after acceptance. */
  mailTicketId: string | null;
  /**
   * Closing a maintenance REQUIRES assigning an employee (contad_app.js:1972, the modal's
   * required datalist at atm_maintenance.ejs:1186-1194) — the one structural difference from
   * replenishment close. The edit dialog may also write the display name as free text (:1627).
   */
  leaderEmployeeId: string | null;
  leaderName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The maintenance open form (contad_app.js:1896-1957): per-line service type and reference
 * number, and a free datetime (datetime-local) instead of replenishment's date-only.
 * `openedAt` absent → now.
 */
export const OpenAtmMaintenancesSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            machineCode: z.string().min(1),
            serviceType: z.string().nullable().default(null),
            referenceNumber: z.string().nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    openedAt: z.coerce.date().nullable().default(null),
  })
  .strict();
export type OpenAtmMaintenances = z.infer<typeof OpenAtmMaintenancesSchema>;

export interface OpenAtmMaintenancesResultDto {
  opened: AtmMaintenanceDto[];
  unknownCodes: string[];
}

/** Close: single or checked set, always with the assigned employee (contad_app.js:1963-1983). */
export const CloseAtmMaintenancesSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(200),
    leaderEmployeeId: objectId(),
  })
  .strict();
export type CloseAtmMaintenances = z.infer<typeof CloseAtmMaintenancesSchema>;

export const UpdateAtmMaintenanceSchema = z
  .object({
    serviceType: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    openedAt: z.coerce.date().optional(),
    /** Cascades by area+shift like replenishment, but with NO time-unchanged guard (:2019-2032). */
    leaderName: z.string().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmMaintenance = z.infer<typeof UpdateAtmMaintenanceSchema>;

/**
 * Checked-rows maintenance edit. Legacy also wrote `schedule_time` here (contad_app.js:2042-2044)
 * — a field the maintenance schema never declared, so Mongoose strict mode dropped it silently on
 * every submit. A write that never landed is not behaviour; it is not carried (port doc T6).
 */
export const BulkUpdateAtmMaintenancesSchema = z
  .object({
    ids: z.array(objectId()).min(1).max(200),
    leaderName: z.string().nullable(),
  })
  .strict();
export type BulkUpdateAtmMaintenances = z.infer<typeof BulkUpdateAtmMaintenancesSchema>;

/** One row of the close modal's employee datalist (atm_maintenance.ejs:1189-1193). */
export interface AtmLeaderOptionDto {
  employeeId: string;
  name: string;
}

// ── Mail tickets (legacy `atm_mails`) ───────────────────────────────────────────────────────────

export interface AtmMailTicketDto {
  id: string;
  branchId: string;
  /** Null when the machine matched at ingest was later deleted; the snapshot fields remain. */
  machineId: string | null;
  machineCode: string;
  bankName: string;
  machineName: string;
  area: string;
  /** Legacy `open_time` — when the reader stored the mail. */
  receivedAt: string;
  status: AtmMailTicketStatus;
  /** Legacy `status_txt` — the ticket issue extracted from the email body. */
  issueText: string;
  senderEmail: string;
  /** Legacy `found` — machine existed in the master at ingest. Stored, never rendered (GAP G2). */
  foundInMaster: boolean;
  /**
   * Legacy `duplication` — an open maintenance existed for this machine TODAY. Recomputed at
   * every pending-list read exactly as the legacy GET did (contad_app.js:2674-2698); the ingest-
   * time value is kept on the row for parity but the list serves the live answer (decision D5).
   */
  duplication: boolean;
  /** Legacy `action_by` + NEW `actionAt` — the legacy log never recorded WHEN (GAP G1). */
  actionByName: string | null;
  actionAt: string | null;
  /** Graph message id — the ingest idempotency key. Null on rows migrated from legacy. */
  providerMessageId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Accept/reject a checked set (or one row) — mail_maintenance.ejs:884-936. */
export const DecideAtmMailTicketsSchema = z
  .object({ ids: z.array(objectId()).min(1).max(200) })
  .strict();
export type DecideAtmMailTickets = z.infer<typeof DecideAtmMailTicketsSchema>;

/** The log page range — legacy filters `open_time`, default today (contad_app.js:2909-2928). */
export const ListAtmMailLogQuerySchema = PaginationQuerySchema.extend({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
}).strict();
export type ListAtmMailLogQuery = z.infer<typeof ListAtmMailLogQuerySchema>;

/** The unread badge every legacy ATM page renders (contad_app.js:266-268). */
export interface AtmMailUnreadCountDto {
  count: number;
}

// ── Mail ingestion (the automation seam — contract now, transport later) ────────────────────────

/**
 * What the central mail reader hands ECMS per message. Parsing, machine matching, branch
 * resolution and the found/duplication flags are ECMS's job (the ingestion service), so the
 * transport stays a dumb pipe — port doc §9. `providerMessageId` is the idempotency key: the same
 * message delivered twice creates one ticket.
 */
export const AtmMailIngestSchema = z
  .object({
    providerMessageId: z.string().min(1),
    receivedAt: z.coerce.date(),
    senderEmail: z.string().min(1),
    subject: z.string().default(''),
    bodyText: z.string().min(1),
  })
  .strict();
export type AtmMailIngest = z.infer<typeof AtmMailIngestSchema>;

/**
 * `created` — ticket stored, message may be marked read + branch-categorized.
 * `duplicateMessage` — this providerMessageId was already ingested; nothing new stored.
 * `unmatched` — no machine code / no active machine matched. THE MESSAGE MUST STAY UNREAD in the
 * mailbox (the owner's rule), and unlike the legacy reader — which dropped these on the floor
 * (Automation/src/index.js:199-201) — the outcome says so explicitly.
 */
export const ATM_MAIL_INGEST_OUTCOMES = ['created', 'duplicateMessage', 'unmatched'] as const;
export const AtmMailIngestOutcomeSchema = z.enum(ATM_MAIL_INGEST_OUTCOMES);
export type AtmMailIngestOutcome = z.infer<typeof AtmMailIngestOutcomeSchema>;

export interface AtmMailIngestResultDto {
  outcome: AtmMailIngestOutcome;
  ticketId: string | null;
  /**
   * The branch the ticket was filed under — THE machine's branch, which is the whole of "classify
   * by branch" in one central reader. The transport reads it to tag the message with that branch's
   * mailbox colour; null when nothing was filed.
   */
  branchId: string | null;
  /** Why an `unmatched` message did not match — for the reader's log, never for the mailbox. */
  reason: string | null;
}

// ── Module settings ─────────────────────────────────────────────────────────────────────────────

export const AtmSettingKeys = {
  /**
   * HR department ids whose employees populate the maintenance close-modal's assignee list. The
   * legacy hardcoded the Arabic department NAME — `department: "الصراف الالى"`
   * (contad_app.js:1110-1112); a name cannot be hardcoded against ECMS's org chart, so the port
   * of that constant is this setting (the operations CrewDepartmentIds precedent). DEFAULT EMPTY,
   * meaning an unconfigured install offers nobody — closing maintenance names a real employee or
   * does not happen, which is the legacy rule.
   */
  MaintenanceLeaderDepartmentIds: 'atm.maintenanceLeaderDepartmentIds',
  /**
   * branchId → the mailbox category name that marks a mail as that branch's.
   *
   * The legacy reader tagged every message it stored with one hard-coded "Green Category"
   * (Automation/src/index.js:224) — which was enough when each branch had its own reader and its
   * own mailbox. One central reader serving every branch needs the tag to say WHICH branch, which
   * is the owner's "كل Branch يتم تمييزه بالـcolor الخاص به". Empty means nothing is tagged;
   * messages are still marked read, because the tag is a convenience and the ticket is the record.
   */
  MailBranchCategories: 'atm.mail.branchCategories',
} as const;

// ── Daily report (legacy /reports_atm) ──────────────────────────────────────────────────────────
//
// The legacy screen (contad_app.js:2208-2351, views/events/reports_atm.ejs) is ONE number pair per
// bank, for TODAY, for each of the two operation kinds: `not_end` (still open, painted red) over
// `all` (everything opened that day, painted green) — grouped by the `bank` string, deleted rows
// excluded. That is the whole report; there is no range, no drill-down and nothing stored.
//
// One read-only widening (port doc D7): the day is a PARAMETER defaulting to today. The legacy
// could only ever show today, which made "what did yesterday look like" a question the screen
// could not answer; a date on a read changes no behaviour and stores nothing.

export interface AtmBankCountsDto {
  /** The `bank` label the operations were opened under — the legacy `_id` of the $group. */
  bankName: string;
  /** Legacy `all` — every non-deleted operation opened that day. */
  total: number;
  /** Legacy `not_end` — those still open. */
  open: number;
}

export interface AtmDailyReportDto {
  /** The Cairo calendar day the counts cover (`YYYY-MM-DD`). */
  date: string;
  /** Empty when the caller may not read that half — the report never leaks past a grant. */
  replenishments: AtmBankCountsDto[];
  maintenances: AtmBankCountsDto[];
}

export const AtmDailyReportQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export type AtmDailyReportQuery = z.infer<typeof AtmDailyReportQuerySchema>;
