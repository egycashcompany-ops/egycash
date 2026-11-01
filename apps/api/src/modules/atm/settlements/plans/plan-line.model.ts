// A plan line — one machine (or one spare set) to replenish, with its run, its time and its notes
// per cassette (S-3…S-6, S-9; docs/12-planning/atm-settlements-phase1.md §4.5).
//
// NOT a replenishment-board row (DS-9): phase 1 never opens or closes one. A line keeps a SNAPSHOT
// of the machine and of the layout it was filled from, and the standard counts it was given
// (DS-29): "the id links, the snapshot is the record a closed day keeps saying"
// (`replenishments/replenishment.model.ts`). A draft can be refreshed; an issued line never
// changes.
//
// STATUS (DS-10): draft → issued → prepared, plus cancelled. Issuing gives the running Note serial
// (DS-11) and the bags; a reopen voids the serial onto `voidedSerials` and resets the print count.
// `ux_plan_machine_run` is the race guard for two users adding the same machine to the same run, and
// for a PATCH moving a line into an occupied run.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_BANK_CODE_PATTERN,
  ATM_LABEL_MAX,
  ATM_PLAN_LINE_KINDS,
  ATM_PLAN_LINE_STATUSES,
  ATM_PLAN_RUNS,
  ATM_SCHEDULE_TIME,
  type AtmBankCode,
  type AtmDenominationNotes,
  type AtmPlanLineKind,
  type AtmPlanLineStatus,
  type AtmPlanRun,
  type AtmPlanSlot,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';
import { NO_CONTROL, planSlotSchema } from '../shared/slot.schema';

export interface AtmSpareUse {
  machineId: Types.ObjectId;
  machineCode: string;
  machineName: string;
  at: Date;
  by: Types.ObjectId;
  byName: string | null;
}

export interface AtmVoidedSerial {
  serial: number;
  printCount: number;
  at: Date;
  byName: string | null;
  reason: string;
}

export interface AtmPlanLineDoc extends BaseDocFields {
  planId: Types.ObjectId;
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  /** Copied from the plan, for day queries. */
  replenishDate: string;
  kind: AtmPlanLineKind;
  /** Null for a spare line. */
  machineId: Types.ObjectId | null;
  machineCode: string | null;
  machineName: string | null;
  area: string | null;
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  /** The layout revision copied; null for a spare line. */
  layoutRevision: number | null;
  /** Spare only (DS-27), ≤ 20. */
  spareCode: string | null;
  spareUse: AtmSpareUse | null;
  run: AtmPlanRun;
  /** 'HH:mm'. */
  scheduleTime: string | null;
  /** Insertion order within the plan. */
  position: number;
  status: AtmPlanLineStatus;
  /** Set at issue (DS-11). */
  serial: number | null;
  voidedSerials: AtmVoidedSerial[];
  /** The layout snapshot + notes + bag (the bag is set at issue). */
  slots: AtmPlanSlot[];
  countsSource: 'standard' | 'manual';
  /** The profile the counts came from. */
  standardLoadId: Types.ObjectId | null;
  /**
   * The user chose that profile for the line (S15, S16 step 2); false when it came from the layout
   * or the bank default, so a refresh follows the layout's profile again (S16 step 1).
   */
  standardLoadChosen: boolean;
  /** What that profile gave (DS-8). */
  standardNotes: AtmDenominationNotes[] | null;
  /** `lineEgpTotalMinor(slots)`, stored (DS-28). */
  egpTotalMinor: number;
  issuedAt: Date | null;
  issuedBy: Types.ObjectId | null;
  issuedByName: string | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  /** DS-10; reset by a reopen. */
  notePrintCount: number;
  notePrintedAt: Date | null;
}

const spareUseSchema = new Schema<AtmSpareUse>(
  {
    machineId: { type: Schema.Types.ObjectId, required: true },
    machineCode: { type: String, required: true },
    machineName: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true },
    byName: { type: String, default: null },
  },
  { _id: false },
);

const voidedSerialSchema = new Schema<AtmVoidedSerial>(
  {
    serial: { type: Number, required: true, min: 1 },
    printCount: { type: Number, required: true, min: 0 },
    at: { type: Date, required: true },
    byName: { type: String, default: null },
    reason: { type: String, required: true, maxlength: 300 },
  },
  { _id: false },
);

const standardNotesSchema = new Schema<AtmDenominationNotes>(
  {
    denomination: { type: Number, required: true },
    notes: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const label = (max: number) => ({ type: String, default: null, maxlength: max, match: NO_CONTROL });

const planLineSchema = new Schema<AtmPlanLineDoc>(
  {
    planId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    // A catalog code (DEC-35): the SHAPE only — a bank added at runtime must be storable here; that
    // it exists and is enabled is the service's check (`requireEnabledBank`).
    bankCode: { type: String, required: true, match: ATM_BANK_CODE_PATTERN },
    replenishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    kind: { type: String, required: true, enum: ATM_PLAN_LINE_KINDS },
    machineId: { type: Schema.Types.ObjectId, default: null },
    machineCode: { type: String, default: null },
    machineName: { type: String, default: null },
    area: { type: String, default: null },
    typeLabel: label(ATM_LABEL_MAX.typeLabel),
    featuresLabel: label(ATM_LABEL_MAX.featuresLabel),
    hubLabel: label(ATM_LABEL_MAX.hubLabel),
    layoutRevision: { type: Number, default: null },
    spareCode: label(20),
    spareUse: { type: spareUseSchema, default: null },
    run: { type: Number, required: true, enum: ATM_PLAN_RUNS },
    scheduleTime: { type: String, default: null, match: ATM_SCHEDULE_TIME },
    position: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: ATM_PLAN_LINE_STATUSES },
    serial: { type: Number, default: null },
    voidedSerials: { type: [voidedSerialSchema], default: [] },
    slots: { type: [planSlotSchema], required: true },
    countsSource: { type: String, required: true, enum: ['standard', 'manual'] },
    standardLoadId: { type: Schema.Types.ObjectId, default: null },
    standardLoadChosen: { type: Boolean, default: false },
    standardNotes: { type: [standardNotesSchema], default: null },
    egpTotalMinor: { type: Number, required: true, min: 0 },
    issuedAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, default: null },
    issuedByName: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledByName: { type: String, default: null },
    cancelReason: { type: String, default: null, maxlength: 300 },
    notePrintCount: { type: Number, required: true, default: 0, min: 0 },
    notePrintedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

planLineSchema.index({ planId: 1, status: 1 }, { name: 'ix_plan_status' });
planLineSchema.index(
  { branchId: 1, bankCode: 1, serial: 1 },
  {
    unique: true,
    name: 'ux_branch_bank_serial',
    partialFilterExpression: { serial: { $gt: 0 }, isDeleted: false },
  },
);
planLineSchema.index(
  { planId: 1, machineId: 1, run: 1 },
  {
    unique: true,
    name: 'ux_plan_machine_run',
    partialFilterExpression: {
      kind: 'machine',
      status: { $in: ['draft', 'issued', 'prepared'] },
      isDeleted: false,
    },
  },
);
planLineSchema.index({ 'voidedSerials.serial': 1, branchId: 1 }, { name: 'ix_voided_serial' });
planLineSchema.index({ branchId: 1, replenishDate: 1 }, { name: 'ix_branch_date' });
planLineSchema.index({ machineId: 1, replenishDate: 1 }, { name: 'ix_machine_date' });

export const AtmPlanLineModel = model<AtmPlanLineDoc>(
  'AtmPlanLine',
  planLineSchema,
  'atm_plan_lines',
);
