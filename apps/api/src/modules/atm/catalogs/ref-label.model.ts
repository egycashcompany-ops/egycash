// The ATM-owned bank and area label lists — legacy `atm_data_lists.bank[]` / `.area[]`
// (models/atm_data_lists.js, written at contad_app.js:2477-2524).
//
// One collection, discriminated by `kind`, because the two lists have IDENTICAL behaviour (add a
// name if absent, remove a name) and their rows are labels, not entities. Deliberately NOT the
// operations bank catalog: the legacy kept `atm_data_lists` beside `data_lists` as a separate
// list with a separate administrator, and /data_edit_atm ADDS and REMOVES entries — a write no
// module may perform on another module's collection (port doc decision D1).
//
// The legacy stored the lists as arrays on a SINGLETON document — `Event11.find({})[0]`
// (:2408-2409), a second document being silently invisible. Rows with a unique index carry the
// same duplicate rule (:2473, :2485 — "موجود قبل كدا") without the singleton failure mode.
//
// Since the bank catalog (DEC-35) a `bank` row is an OPERATIONS SPELLING of a catalog bank
// (`NBE FOREX` → NBE, a legacy text …), still per branch, and carries the `bankCode` it stands for
// (null = not mapped yet; the boot backfill `backfillBankLabelCodes` fills rows written before the
// field). An `area` row gains display names in both languages and the canonical names it had
// (DEC-38). Every new field defaults so a row written before it reads as it always meant.
import { Schema, model, type Types } from 'mongoose';
import { ATM_REF_LABEL_ORIGINS, type AtmRefLabelOrigin } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export const ATM_REF_LABEL_KINDS = ['bank', 'area'] as const;
export type AtmRefLabelKind = (typeof ATM_REF_LABEL_KINDS)[number];

export interface AtmRefLabelDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  kind: AtmRefLabelKind;
  name: string;
  /** Areas: display names only — `name` stays what machines and operations store. */
  nameAr: string | null;
  nameEn: string | null;
  /** Areas: earlier canonical names, so a renamed name is never re-created by a later save. */
  formerNames: string[];
  /** Banks: the catalog bank this spelling stands for; null = unmapped. Areas: null. */
  bankCode: string | null;
  origin: AtmRefLabelOrigin;
  isActive: boolean;
}

const refLabelSchema = new Schema<AtmRefLabelDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true, enum: ATM_REF_LABEL_KINDS },
    name: { type: String, required: true },
    nameAr: { type: String, default: null },
    nameEn: { type: String, default: null },
    formerNames: { type: [String], default: [] },
    bankCode: { type: String, default: null },
    origin: { type: String, required: true, enum: ATM_REF_LABEL_ORIGINS, default: 'manual' },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

refLabelSchema.index(
  { branchId: 1, kind: 1, name: 1 },
  { unique: true, name: 'ux_branch_kind_name', partialFilterExpression: { isDeleted: false } },
);

export const AtmRefLabelModel = model<AtmRefLabelDoc>(
  'AtmRefLabel',
  refLabelSchema,
  'atm_ref_labels',
);
