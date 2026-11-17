// «أنواع التشغيل» — the crew board's «النوع» (Round 20).
//
// The legacy board held the list in its template (يومي، احتياطي، … مسائي). The owner approved the new
// board with «انا عاوز النوع يكون بيضاف من البيانات المرجعيه», so the list is reference data: a
// small catalog on the reference-data screen, kept like the currencies (dragged order, archived not
// deleted), and a crew row points at one of its rows by id.
import { Schema, model } from 'mongoose';
import { OPERATIONS_SHIFT_TYPE_COLOURS, type OperationsShiftTypeColour } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsShiftTypeDoc extends BaseDocFields {
  /** The Arabic name the board shows. */
  name: string;
  nameEn: string | null;
  colour: OperationsShiftTypeColour;
  /** The catalog's dragged order, 0 first; null until somebody arranges the list. */
  sortOrder?: number | null;
  /**
   * Which of the legacy nine the boot seeded this row as (`daily`, `reserve`, …), or null for a
   * type added on the screen. It is what makes the seed run once: the boot asks "is there a row
   * for `daily`?", never "is there a row named يومي?" — so a seeded type the owner renamed or
   * archived is never seeded a second time.
   */
  seedKey: string | null;
  isActive: boolean;
}

const shiftTypeSchema = new Schema<OperationsShiftTypeDoc>(
  {
    name: { type: String, required: true },
    nameEn: { type: String, required: false, default: null },
    colour: { type: String, required: true, enum: OPERATIONS_SHIFT_TYPE_COLOURS },
    sortOrder: { type: Number, default: null },
    seedKey: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Two types of one name would be two «يومي» tags on the board that count apart.
shiftTypeSchema.index(
  { name: 1 },
  { unique: true, name: 'ux_name', partialFilterExpression: { isDeleted: false } },
);
// The seed's identity. Unique, so two instances booting together cannot both insert «يومي»: the
// loser's upsert is an E11000 the seed logs and skips. Partial on a STRING key, so the types added
// on the screen (null) are not one shared value.
shiftTypeSchema.index(
  { seedKey: 1 },
  { unique: true, name: 'ux_seed_key', partialFilterExpression: { seedKey: { $type: 'string' } } },
);

export const OperationsShiftTypeModel = model<OperationsShiftTypeDoc>(
  'OperationsShiftType',
  shiftTypeSchema,
  'operations_shift_types',
);
