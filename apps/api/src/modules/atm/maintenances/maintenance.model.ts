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
import { OPEN_OPERATION_INDEX_NAMES, openOperationPartialFilter } from '../shared/open-operation';

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
   * is held by (shared/open-operation.ts). Null on a row stored before the field existed.
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
// The per-day rule's QUESTION — "is this code open on that day?" — asks by the open time's day range
// (so a row stored before `openDay` existed still counts), which the unique index below cannot
// answer: its filter needs `openDay`. This one is what that company-wide query runs on, instead of
// a scan of the whole log (`openMachineCodes`, shared/operation-log.repository.ts).
maintenanceSchema.index(
  { machineCode: 1, openedAt: 1 },
  { name: 'ix_open_code_opened', partialFilterExpression: { closedAt: null, isDeleted: false } },
);
// The owner's rule (2026-10-13, narrowed to the day 2026-10-27 — port doc OD-1): at most ONE open
// maintenance per machine code PER DAY, company-wide — the race-proof half of the service check
// (maintenance.service.ts); the mail `duplication` question asks the same thing of the ticket's
// day. It replaces `ix_branch_machine_open` (the legacy's per-branch "open TODAY" form of that
// question, contad_app.js:2674 — a database that built it keeps it unused) and the rule's any-day
// index of the first form, which the boot drops. Built at boot by atm-indexes.ts; where existing
// rows already violate it the boot names this collection and skips the index, and the service
// check still refuses every new duplicate.
maintenanceSchema.index(
  { machineCode: 1, openDay: 1 },
  {
    unique: true,
    name: OPEN_OPERATION_INDEX_NAMES.maintenance,
    partialFilterExpression: openOperationPartialFilter(),
  },
);

export const AtmMaintenanceModel = model<AtmMaintenanceDoc>(
  'AtmMaintenance',
  maintenanceSchema,
  'atm_maintenances',
);
