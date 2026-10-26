// A machine's cassette layout («فئات الكاسيتات») — one live document per machine (S-1, DS-2;
// docs/12-planning/atm-settlements-phase1.md §4.1).
//
// In its own collection, not on `atm_machines`: the map's precedent (`map/machine-location.model.ts`)
// — a layout write must never bump the master's `__v`, leak into its DTO or its audit snapshot.
// Every change is a new `revision`, and the same revision is appended to
// `atm_cassette_layout_versions` in the same transaction, so the history is always complete.
// `source` is the latest change's: an import (`'import'`) or a person (`'manual'`), which is what
// lets a second import leave a hand correction alone (DS-7 `changedManual`).
import { Schema, model, type Types } from 'mongoose';
import { ATM_LABEL_MAX, ATM_LAYOUT_SOURCES, type AtmCassetteSlot } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';
import { NO_CONTROL, cassetteSlotSchema } from '../shared/slot.schema';

export interface AtmCassetteLayoutDoc extends BaseDocFields {
  /** One live document per machine (DS-2). */
  machineId: Types.ObjectId;
  /** Copied from the machine; a machine's branch never changes. */
  branchId: Types.ObjectId;
  /** 4..8, `layoutIssues()` empty. */
  slots: AtmCassetteSlot[];
  /** ≤ 60, cleaned (DS-5): the Full list `Bank`. */
  typeLabel: string | null;
  /** ≤ 40, cleaned: the Full list `Deposit`. */
  featuresLabel: string | null;
  /** ≤ 60, cleaned: the Full list `Dep`. */
  hubLabel: string | null;
  /** DS-8; null → the bank's default. */
  standardLoadId: Types.ObjectId | null;
  /** 1 at creation, +1 per change; equals the latest version row. */
  revision: number;
  /** Of the latest change (DS-7). */
  source: 'import' | 'manual';
  changedByName: string | null;
  changedAt: Date;
}

const label = (max: number) => ({ type: String, default: null, maxlength: max, match: NO_CONTROL });

const layoutSchema = new Schema<AtmCassetteLayoutDoc>(
  {
    machineId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    slots: { type: [cassetteSlotSchema], required: true },
    typeLabel: label(ATM_LABEL_MAX.typeLabel),
    featuresLabel: label(ATM_LABEL_MAX.featuresLabel),
    hubLabel: label(ATM_LABEL_MAX.hubLabel),
    standardLoadId: { type: Schema.Types.ObjectId, default: null },
    revision: { type: Number, required: true, min: 1 },
    source: { type: String, required: true, enum: ATM_LAYOUT_SOURCES },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Exact names — `atm-indexes.ts` builds these at boot (§4.10).
layoutSchema.index(
  { machineId: 1 },
  { unique: true, name: 'ux_machine', partialFilterExpression: { isDeleted: false } },
);
layoutSchema.index({ branchId: 1 }, { name: 'ix_branch' });

export const AtmCassetteLayoutModel = model<AtmCassetteLayoutDoc>(
  'AtmCassetteLayout',
  layoutSchema,
  'atm_cassette_layouts',
);
