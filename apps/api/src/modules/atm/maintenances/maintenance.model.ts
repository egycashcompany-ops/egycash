// A maintenance operation — legacy `atm_maint_log` (models/atm_maint_log.js). NOT a copy of
// replenishment: per-line service type and reference number at open, free notes, a free
// datetime open, and a close that REQUIRES assigning an employee (contad_app.js:1963-1983).
//
// `source`/`mailTicketId` are NEW fields recording where the row came from — typed on the page
// or accepted from a mail ticket (:2829) — provenance the legacy discarded at acceptance.
// The legacy multi-edit's write of `schedule_time` was silently dropped by its own schema
// (:2042-2044 vs models/atm_maint_log.js — no such field) and is not carried (port doc T6).
import { Schema, model, type Types } from 'mongoose';
import { ATM_MAINTENANCE_SOURCES, type AtmMaintenanceSource } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AtmMaintenanceDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  machineId: Types.ObjectId;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: Date;
  /**
   * The Cairo day of `openedAt` (`YYYY-MM-DD`), written with it — the key the owner's per-day rule
   * was held by until it was lifted (OD-1c, shared/open-operation.ts). Null on a row stored before
   * the field existed.
   */
  openDay: string | null;
  closedAt: Date | null;
  serviceType: string | null;
  notes: string | null;
  referenceNumber: string | null;
  source: AtmMaintenanceSource;
  mailTicketId: Types.ObjectId | null;
  /** The employee assigned at close; `leaderName` is the display string the grid shows. */
  leaderEmployeeId: Types.ObjectId | null;
  leaderName: string | null;
  openedById: Types.ObjectId | null;
  openedByName: string | null;
  closedById: Types.ObjectId | null;
  closedByName: string | null;
}

/** The unique index that admits one live maintenance per mail ticket (see its declaration). */
export const MAINTENANCE_PER_MAIL_TICKET_INDEX_NAME = 'ux_maintenance_per_mail_ticket';

/**
 * The rows that index covers: live (not soft-deleted) and opened from a ticket — `mailTicketId` an
 * ObjectId, so the null of every manual and imported row is outside it. A fresh object per call —
 * Mongoose keeps the options it is handed.
 */
export const maintenancePerMailTicketFilter = (): Record<string, unknown> => ({
  mailTicketId: { $type: 'objectId' },
  isDeleted: false,
});

const maintenanceSchema = new Schema<AtmMaintenanceDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    machineId: { type: Schema.Types.ObjectId, required: true },
    machineCode: { type: String, required: true },
    bankName: { type: String, required: true },
    machineName: { type: String, required: true },
    // NOT `required`: every live write stores '' (the legacy wrote '' on every path,
    // contad_app.js:2443) and Mongoose's String required-validator rejects an empty string,
    // so `required: true` here made every ATM insert fail validation. `default: ''` already
    // guarantees a string, which is what the `zone: string` interface promises.
    zone: { type: String, default: '' },
    area: { type: String, required: true },
    openedAt: { type: Date, required: true },
    openDay: { type: String, default: null },
    closedAt: { type: Date, default: null },
    serviceType: { type: String, default: null },
    notes: { type: String, default: null },
    referenceNumber: { type: String, default: null },
    source: { type: String, required: true, enum: ATM_MAINTENANCE_SOURCES, default: 'manual' },
    mailTicketId: { type: Schema.Types.ObjectId, default: null },
    leaderEmployeeId: { type: Schema.Types.ObjectId, default: null },
    leaderName: { type: String, default: null },
    openedById: { type: Schema.Types.ObjectId, default: null },
    openedByName: { type: String, default: null },
    closedById: { type: Schema.Types.ObjectId, default: null },
    closedByName: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

maintenanceSchema.index({ branchId: 1, closedAt: 1, area: -1 }, { name: 'ix_branch_open_area' });
maintenanceSchema.index({ branchId: 1, closedAt: -1 }, { name: 'ix_branch_closed' });
maintenanceSchema.index({ branchId: 1, area: 1, openedAt: 1 }, { name: 'ix_branch_area_opened' });
// Open rows by code and open time — what the mail `duplication` question runs on ("does this
// machine have an open maintenance on the ticket's day?", `openMachineCodes` in
// shared/operation-log.repository.ts), company-wide, instead of a scan of the whole log. It asks
// by the open time's day range, so a row stored before `openDay` existed still counts. The flag is
// a warning only since OD-1c (2026-11-02): a machine may have several open maintenances, and no
// unique index holds one per machine and day any more — atm-indexes.ts drops the one an older
// database built (`ux_open_maintenance_per_code_day`). A database that built the legacy-shaped
// `ix_branch_machine_open` (contad_app.js:2674) keeps it unused.
maintenanceSchema.index(
  { machineCode: 1, openedAt: 1 },
  { name: 'ix_open_code_opened', partialFilterExpression: { closedAt: null, isDeleted: false } },
);
// ONE LIVE MAINTENANCE PER MAIL TICKET — what keeps two concurrent accepts of the same mail (a
// double click, two people on one screen) from opening two maintenances for it. Until OD-1c the
// per-day index refused the second as a side effect; with it gone, this is the race-proof half of
// accept's "an already-decided ticket is skipped": the loser's insert is refused, nothing of it is
// written, and accept skips the ticket (mail-ticket.service.ts). Covers CLOSED rows too — a ticket
// whose maintenance is closed stays accepted (the restore refuses to take it back) — and leaves
// DELETED rows out, so a ticket restored to pending (its maintenance soft-deleted) is accepted
// again. Manual and imported rows carry no ticket (`mailTicketId: null`) and are outside it. The
// log's only unique index besides `_id`. Built at boot by atm-indexes.ts, which reports and skips
// it if stored rows already violate it.
maintenanceSchema.index(
  { mailTicketId: 1 },
  {
    unique: true,
    name: MAINTENANCE_PER_MAIL_TICKET_INDEX_NAME,
    partialFilterExpression: maintenancePerMailTicketFilter(),
  },
);

export const AtmMaintenanceModel = model<AtmMaintenanceDoc>(
  'AtmMaintenance',
  maintenanceSchema,
  'atm_maintenances',
);
