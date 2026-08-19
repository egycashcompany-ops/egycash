// The operational area — the legacy `citys` collection (`models/cites.js`, contad_app.js:2033).
//
// WHAT IT ACTUALLY DOES IN LEGACY, which is smaller than its name suggests: it is the suggestion
// list behind the branch form's `area` field. `data_edit.ejs:924` renders it into a `<datalist>`,
// and the branch saves the STRING the user picked or typed — there is no foreign key. `/tashghela`
// also loads the list (contad_app.js:2367) and passes it to a template that never reads it (dead
// data). Nothing else in 6,144 lines consumes a city.
//
// So this is modelled as what it is: a NAME SUGGESTION for `bankBranch.opsAreaName`, kept as a
// small maintained list. Making it a foreign key would be a new rule — legacy branches carry free
// text and Q24 copies `area` into `area2` verbatim — and rewriting existing branch data to point
// at ids is not a migration this slice was asked for.
//
// Two legacy defects are NOT carried:
//   · ID generation was `countDocuments({}) + 1` (:2060) — not deleted-aware and not atomic, so
//     soft-deleted rows and concurrent inserts produced duplicate ids. ObjectIds have no such
//     failure mode.
//   · The duplicate check built a regex from unescaped user input (:2050). A unique index does
//     the same job without interpreting what the user typed.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsAreaDoc extends BaseDocFields {
  /** Legacy `city_name_ar` — the string a branch's `opsAreaName` actually stores. */
  name: string;
  /** Legacy `city_name_en`. Optional: legacy required it, but many rows carry the Arabic twice. */
  nameEn: string | null;
  /**
   * Legacy `governorate_id` — a numeric key into a separate `governorates` collection. Kept as
   * the plain governorate NAME: the legacy screen only ever used it to group the dropdown, and
   * ECMS has no governorate entity to point at (`EGYPT_GOVERNORATE_CODES` is a national-ID
   * decoding table, not an org structure).
   */
  governorate: string | null;
  isActive: boolean;
}

const areaSchema = new Schema<OperationsAreaDoc>(
  {
    name: { type: String, required: true },
    nameEn: { type: String, required: false, default: null },
    governorate: { type: String, required: false, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The uniqueness the legacy regex check was reaching for, enforced where it cannot be raced.
areaSchema.index(
  { name: 1 },
  { unique: true, name: 'ux_name', partialFilterExpression: { isDeleted: false } },
);

export const OperationsAreaModel = model<OperationsAreaDoc>(
  'OperationsArea',
  areaSchema,
  'operations_areas',
);
