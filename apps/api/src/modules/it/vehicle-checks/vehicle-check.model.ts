// `it_vehicle_checks` — one report of a car's devices («فحص أجهزة السيارة», FR-21;
// docs/12-planning/it-vehicle-checks-design.md §3): the screen, the eight cameras, the DVR and the
// radio, each «يعمل» / «لا يعمل» or unanswered, a note and up to five photos.
//
// The car's code and branch are a SNAPSHOT at filing, so a renamed, moved or disposed car keeps its
// old reports readable and under the branch the car had then. The branch is the data-scope anchor
// for the readers the dashboard brings.
//
// A report's car, day, answers and notes never change once filed. Only photos are added — by the
// reporter, within 24 hours of filing, five at most — through one atomic conditional update. A
// wrong report is corrected by filing a new one: the latest one counts.
//
// The record names a USER (the reporter), never an `employeeId`, so the workforce reset has
// nothing to do here.
import { Schema, model, type Types } from 'mongoose';
import {
  IT_VEHICLE_CHECK_ANSWERS,
  IT_VEHICLE_CHECK_ITEMS,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckItem,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** One photo — Files owns the bytes, the report owns the link. */
export interface ItVehicleCheckPhotoSub {
  /** Made by the phone per photo, so a retried upload whose answer was lost adds nothing. */
  clientPhotoId: string;
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

/** `null` is unanswered — also how a device the car does not have is recorded. */
export type ItVehicleCheckItemsSub = Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>;

export interface ItVehicleCheckDoc extends BaseDocFields {
  /** Fleet's car id. */
  vehicleId: Types.ObjectId;
  /** The car's code at filing. */
  vehicleCode: string;
  /** The car's branch at filing — `null` for a car Fleet holds with none. */
  branchId: Types.ObjectId | null;
  /** The Cairo calendar day the check is for, as that day's UTC midnight (date-only). */
  checkDate: Date;
  items: ItVehicleCheckItemsSub;
  /** Trimmed; an empty note is absent. */
  notes?: string | null;
  photos: ItVehicleCheckPhotoSub[];
  reportedByUserId: Types.ObjectId;
  /** The reporter's display name at filing, as the IT histories snapshot an actor. */
  reportedByName: string;
  /** Made by the form once per report; a repeated send returns the report that exists. */
  clientRequestId: string;
}

const answerPath = { type: String, enum: [...IT_VEHICLE_CHECK_ANSWERS, null], default: null };

const itemsSchema = new Schema<ItVehicleCheckItemsSub>(
  Object.fromEntries(IT_VEHICLE_CHECK_ITEMS.map((key) => [key, answerPath])),
  { _id: false },
);

const photoSchema = new Schema<ItVehicleCheckPhotoSub>(
  {
    clientPhotoId: { type: String, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const vehicleCheckSchema = new Schema<ItVehicleCheckDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    vehicleCode: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    checkDate: { type: Date, required: true },
    items: { type: itemsSchema, required: true, default: () => ({}) },
    notes: { type: String },
    photos: { type: [photoSchema], default: [] },
    reportedByUserId: { type: Schema.Types.ObjectId, required: true },
    // Not `required`: Mongoose refuses '' for a required string, and a context with no identity
    // snapshots no name (the IT timeline's `actorName` rule).
    reportedByName: { type: String, default: '' },
    clientRequestId: { type: String, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One request id, one report — over EVERY row, deleted ones included: an id once filed is that
// report's, so a repeated send (a lost answer on mobile data, a double tap) finds it instead of
// filing a second. The only unique index: several reports per car per day are allowed.
vehicleCheckSchema.index({ clientRequestId: 1 }, { unique: true, name: 'ux_client_request_id' });
// The latest report per car — the latest day, then the latest filing.
vehicleCheckSchema.index(
  { vehicleId: 1, checkDate: -1, createdAt: -1 },
  { name: 'ix_vehicle_latest' },
);
// A branch-scoped list, by day.
vehicleCheckSchema.index({ branchId: 1, checkDate: -1 }, { name: 'ix_branch_day' });

export const ItVehicleCheckModel = model<ItVehicleCheckDoc>(
  'ItVehicleCheck',
  vehicleCheckSchema,
  'it_vehicle_checks',
);
