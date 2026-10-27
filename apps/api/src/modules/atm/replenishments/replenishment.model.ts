// A replenishment operation — legacy `atm_rep_log` (models/atm_rep_log.js).
//
// The machine fields are a SNAPSHOT taken at open (contad_app.js:679-699 copies bank/mach_id/
// name/zone/area verbatim) — id + snapshot, the gold-port rule: the id links, the snapshot is the
// record a closed day keeps saying. `closedAt: null` IS the open state; the legacy `end: 0|1`
// maps onto it and the vestigial `status` (always 0, :693) is not carried (port doc GAP G3).
// `service_type` existed on the legacy schema and was written '' by every replenishment path
// (:691) — not carried either.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { OPEN_OPERATION_INDEX_NAMES, openOperationPartialFilter } from '../shared/open-operation';

export interface AtmReplenishmentDoc extends BaseDocFields {
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
  scheduleTime: string | null;
  /** Legacy `leader` — free text on replenishments, written by the edit cascade. */
  leaderName: string | null;
  openedById: Types.ObjectId | null;
  openedByName: string | null;
  /** Legacy `ops_emp2`. A reopen clears `closedAt` ONLY — these survive, as legacy left them. */
  closedById: Types.ObjectId | null;
  closedByName: string | null;
}

const replenishmentSchema = new Schema<AtmReplenishmentDoc>(
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
    scheduleTime: { type: String, default: null },
    leaderName: { type: String, default: null },
    openedById: { type: Schema.Types.ObjectId, default: null },
    openedByName: { type: String, default: null },
    closedById: { type: Schema.Types.ObjectId, default: null },
    closedByName: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The open board reads open rows by branch (sorted by area); the done page reads a closedAt day
// range; the leader cascade selects open rows of one area inside a time window.
replenishmentSchema.index({ branchId: 1, closedAt: 1, area: -1 }, { name: 'ix_branch_open_area' });
replenishmentSchema.index({ branchId: 1, closedAt: -1 }, { name: 'ix_branch_closed' });
replenishmentSchema.index({ branchId: 1, area: 1, openedAt: 1 }, { name: 'ix_branch_area_opened' });
// The per-day rule's QUESTION — "is this code open on that day?" — asks by the open time's day range
// (so a row stored before `openDay` existed still counts), which the unique index below cannot
// answer: its filter needs `openDay`. This one is what that company-wide query runs on, instead of
// a scan of the whole log (`openMachineCodes`, shared/operation-log.repository.ts).
replenishmentSchema.index(
  { machineCode: 1, openedAt: 1 },
  { name: 'ix_open_code_opened', partialFilterExpression: { closedAt: null, isDeleted: false } },
);
// The owner's rule (2026-10-13, narrowed to the day 2026-10-27 — port doc OD-1): at most ONE open
// replenishment per machine code PER DAY, company-wide — the race-proof half of the service check
// (replenishment.service.ts). Built at boot by atm-indexes.ts, which also drops the rule's
// any-day index of the first form; where existing rows already violate it the boot names this
// collection and skips the index, and the service check still refuses every new duplicate.
replenishmentSchema.index(
  { machineCode: 1, openDay: 1 },
  {
    unique: true,
    name: OPEN_OPERATION_INDEX_NAMES.replenishment,
    partialFilterExpression: openOperationPartialFilter(),
  },
);

export const AtmReplenishmentModel = model<AtmReplenishmentDoc>(
  'AtmReplenishment',
  replenishmentSchema,
  'atm_replenishments',
);
