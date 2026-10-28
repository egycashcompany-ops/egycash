// The daily replenishment plan («خطة التغذية») — one per branch × bank × replenishment date (S-5,
// DS-1; docs/12-planning/atm-settlements-phase1.md §4.4).
//
// The plan holds no line: its lines are `atm_plan_lines`. `lastPosition` is the insertion counter
// AND the serialisation point of concurrent adds — every add `$inc`s it first, inside its
// transaction, so two adds meet a write conflict here and the loser is retried (§6.5 S14).
// `receiptPrint` / `handoverPrint` record what the last «بيان التغذية» / «سيلزات» covered; they are
// print tracking, written with `$set` and no `__v` bump (§6.7).
import { Schema, model, type Types } from 'mongoose';
import { ATM_BANK_CODE_PATTERN, type AtmBankCode } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AtmPlanPrintRecord {
  at: Date;
  byName: string | null;
  serials: number[];
}

export interface AtmReplenishmentPlanDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  /** 'YYYY-MM-DD', a Cairo calendar day. */
  replenishDate: string;
  /** 0; `$inc` when lines are added. */
  lastPosition: number;
  /** The last «بيان التغذية». */
  receiptPrint: AtmPlanPrintRecord | null;
  /** The last «سيلزات». */
  handoverPrint: AtmPlanPrintRecord | null;
}

const printSchema = new Schema<AtmPlanPrintRecord>(
  {
    at: { type: Date, required: true },
    byName: { type: String, default: null },
    serials: { type: [Number], default: [] },
  },
  { _id: false },
);

const planSchema = new Schema<AtmReplenishmentPlanDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    // A catalog code (DEC-35): the SHAPE only — a bank added at runtime must be storable here; that
    // it exists and is enabled is the service's check (`requireEnabledBank`).
    bankCode: { type: String, required: true, match: ATM_BANK_CODE_PATTERN },
    replenishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    lastPosition: { type: Number, required: true, default: 0, min: 0 },
    receiptPrint: { type: printSchema, default: null },
    handoverPrint: { type: printSchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

planSchema.index(
  { branchId: 1, bankCode: 1, replenishDate: 1 },
  {
    unique: true,
    name: 'ux_branch_bank_date',
    partialFilterExpression: { isDeleted: false },
  },
);

export const AtmReplenishmentPlanModel = model<AtmReplenishmentPlanDoc>(
  'AtmReplenishmentPlan',
  planSchema,
  'atm_replenishment_plans',
);
