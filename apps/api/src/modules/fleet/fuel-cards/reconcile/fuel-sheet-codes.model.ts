// What a fuel company's sheet calls a car — «suz 62» for 62, «m g 3» for MG 3, «194» for 288,
// «سفر 1» for the travel card on no car. One row per spelling the sheets use, keyed by the
// spelling FOLDED (NFKC, trimmed, case-folded, no spaces), pointing at a car (its id, or its code
// for the go-live rows) or at a label.
//
// Seeded at boot from the go-live sheet, INSERT-ONLY (`source: 'goLive'`), and taught by the owner
// with «تذكّر هذا الكود» on the reconciliation page (`source: 'owner'`) — the seed never overwrites
// what he taught. Soft only: nothing deletes a row.
import { Schema, model, type Types } from 'mongoose';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export const FUEL_SHEET_CODE_SOURCES = ['goLive', 'owner'] as const;
export type FuelSheetCodeSource = (typeof FUEL_SHEET_CODE_SOURCES)[number];

export interface FleetFuelSheetCodeDoc extends BaseDocFields {
  /** As the sheet prints it. */
  sheetCode: string;
  /** Folded — what a sheet's code is looked up by. */
  key: string;
  /** The car, when the owner picked it; `null` for a label or a go-live row (see `vehicleCode`). */
  vehicleId: Types.ObjectId | null;
  /** The registry code a go-live row names. */
  vehicleCode: string | null;
  /** A card on no car — «سفر 1», «اسبير». */
  label: string | null;
  source: FuelSheetCodeSource;
}

const sheetCodeSchema = new Schema<FleetFuelSheetCodeDoc>(
  {
    sheetCode: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    label: { type: String, default: null },
    source: { type: String, enum: FUEL_SHEET_CODE_SOURCES, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One meaning per spelling. Partial, so a row soft-deleted by hand frees its spelling.
sheetCodeSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_fuel_sheet_code_key', partialFilterExpression: { isDeleted: false } },
);

export const FleetFuelSheetCodeModel = model<FleetFuelSheetCodeDoc>(
  'FleetFuelSheetCode',
  sheetCodeSchema,
  'fleet_fuel_sheet_codes',
);
