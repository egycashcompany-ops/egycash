// The history of a machine's cassette layout — APPEND-ONLY: nothing updates or deletes a row
// (S-1 "every change keeps history"; docs/12-planning/atm-settlements-phase1.md §4.2, DS-2).
//
// Readable with the layout key: the platform's audit history needs `activityLog.view` /
// `auditLog.view` (G-2), and S-1 wants Settlements to see who changed a machine's denominations.
// A version takes effect when it is saved (GS-26).
import { Schema, model, type Types } from 'mongoose';
import { ATM_LABEL_MAX, ATM_LAYOUT_SOURCES, type AtmCassetteSlot } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';
import { NO_CONTROL, cassetteSlotSchema } from '../shared/slot.schema';

export interface AtmCassetteLayoutVersionDoc extends BaseDocFields {
  layoutId: Types.ObjectId;
  machineId: Types.ObjectId;
  branchId: Types.ObjectId;
  revision: number;
  slots: AtmCassetteSlot[];
  typeLabel: string | null;
  featuresLabel: string | null;
  hubLabel: string | null;
  standardLoadId: Types.ObjectId | null;
  source: 'import' | 'manual';
  /** ≤ 300; a manual save's reason. */
  reason: string | null;
  importRunId: Types.ObjectId | null;
  changedBy: Types.ObjectId;
  changedByName: string | null;
  changedAt: Date;
}

const label = (max: number) => ({ type: String, default: null, maxlength: max, match: NO_CONTROL });

const versionSchema = new Schema<AtmCassetteLayoutVersionDoc>(
  {
    layoutId: { type: Schema.Types.ObjectId, required: true },
    machineId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    revision: { type: Number, required: true, min: 1 },
    slots: { type: [cassetteSlotSchema], required: true },
    typeLabel: label(ATM_LABEL_MAX.typeLabel),
    featuresLabel: label(ATM_LABEL_MAX.featuresLabel),
    hubLabel: label(ATM_LABEL_MAX.hubLabel),
    standardLoadId: { type: Schema.Types.ObjectId, default: null },
    source: { type: String, required: true, enum: ATM_LAYOUT_SOURCES },
    reason: { type: String, default: null, maxlength: 300, match: NO_CONTROL },
    importRunId: { type: Schema.Types.ObjectId, default: null },
    changedBy: { type: Schema.Types.ObjectId, required: true },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

versionSchema.index({ machineId: 1, revision: 1 }, { unique: true, name: 'ux_machine_revision' });

export const AtmCassetteLayoutVersionModel = model<AtmCassetteLayoutVersionDoc>(
  'AtmCassetteLayoutVersion',
  versionSchema,
  'atm_cassette_layout_versions',
);
