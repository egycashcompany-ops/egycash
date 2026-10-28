// A line's preparation («الشوالات والسيلزات») — the bag QRs and the cassette seals Preparation scans
// while closing the bags; one live document per issued line (S-7, DS-14;
// docs/12-planning/atm-settlements-phase1.md §4.6).
//
// Its own collection: a different writer (Preparation, not Settlements), a different realtime key,
// and seals kept out of the Settlements DTO, so a capture never collides with a line version.
// `value` / `qr` are what was scanned (cleaned, §3.5); `key` / `qrKey` are `sealKey(value)`, used ONLY
// to find duplicates. Values are never unique-indexed: duplicates warn and never block (S-7). The
// two multikey indexes serve the duplicate lookups (§6.8).
//
// A cancel bumps this document's `__v` (a capture in flight then fails) and keeps it, so its values
// stay searchable as duplicates (GS-7); a reopen soft-deletes it.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_BAG_QR_MAX,
  ATM_BANK_CODE_PATTERN,
  ATM_LAYOUT_SLOTS_MAX,
  ATM_SEAL_VALUE_MAX,
  type AtmBankCode,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AtmPreparationBag {
  bag: 1 | 2;
  slots: number[];
  qr: string | null;
  qrKey: string | null;
}

export interface AtmPreparationSeal {
  slot: number;
  value: string | null;
  key: string | null;
}

export interface AtmLinePreparationDoc extends BaseDocFields {
  lineId: Types.ObjectId;
  planId: Types.ObjectId;
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  replenishDate: string;
  /** From `bagAllocation`. */
  bags: AtmPreparationBag[];
  /** One per bagged slot. */
  seals: AtmPreparationSeal[];
  status: 'open' | 'prepared';
  lastCapturedAt: Date | null;
  lastCapturedByName: string | null;
  preparedAt: Date | null;
  preparedBy: Types.ObjectId | null;
  preparedByName: string | null;
}

const bagSchema = new Schema<AtmPreparationBag>(
  {
    bag: { type: Number, required: true, enum: [1, 2] },
    slots: { type: [Number], required: true },
    qr: { type: String, default: null, maxlength: ATM_BAG_QR_MAX },
    qrKey: { type: String, default: null },
  },
  { _id: false },
);

const sealSchema = new Schema<AtmPreparationSeal>(
  {
    slot: { type: Number, required: true, min: 1, max: ATM_LAYOUT_SLOTS_MAX },
    value: { type: String, default: null, maxlength: ATM_SEAL_VALUE_MAX },
    key: { type: String, default: null },
  },
  { _id: false },
);

const linePreparationSchema = new Schema<AtmLinePreparationDoc>(
  {
    lineId: { type: Schema.Types.ObjectId, required: true },
    planId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    // A catalog code (DEC-35): the SHAPE only — a bank added at runtime must be storable here; that
    // it exists and is enabled is the service's check (`requireEnabledBank`).
    bankCode: { type: String, required: true, match: ATM_BANK_CODE_PATTERN },
    replenishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    bags: { type: [bagSchema], required: true },
    seals: { type: [sealSchema], required: true },
    status: { type: String, required: true, enum: ['open', 'prepared'] },
    lastCapturedAt: { type: Date, default: null },
    lastCapturedByName: { type: String, default: null },
    preparedAt: { type: Date, default: null },
    preparedBy: { type: Schema.Types.ObjectId, default: null },
    preparedByName: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

linePreparationSchema.index(
  { lineId: 1 },
  { unique: true, name: 'ux_line', partialFilterExpression: { isDeleted: false } },
);
linePreparationSchema.index({ planId: 1 }, { name: 'ix_plan' });
linePreparationSchema.index(
  { 'bags.qrKey': 1, createdAt: -1 },
  { name: 'ix_bag_qr_key', partialFilterExpression: { isDeleted: false } },
);
linePreparationSchema.index(
  { 'seals.key': 1, createdAt: -1 },
  { name: 'ix_seal_key', partialFilterExpression: { isDeleted: false } },
);

export const AtmLinePreparationModel = model<AtmLinePreparationDoc>(
  'AtmLinePreparation',
  linePreparationSchema,
  'atm_line_preparations',
);
