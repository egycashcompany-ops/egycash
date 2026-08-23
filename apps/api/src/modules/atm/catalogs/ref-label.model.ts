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
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export const ATM_REF_LABEL_KINDS = ['bank', 'area'] as const;
export type AtmRefLabelKind = (typeof ATM_REF_LABEL_KINDS)[number];

export interface AtmRefLabelDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  kind: AtmRefLabelKind;
  name: string;
  isActive: boolean;
}

const refLabelSchema = new Schema<AtmRefLabelDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, required: true, enum: ATM_REF_LABEL_KINDS },
    name: { type: String, required: true },
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
