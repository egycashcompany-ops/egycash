// A receipt (إيصال) the driver brought back — fuel, tyres or washing — and what paid for it.
//
// «في حاله الوقود تبع الفيزا ... بيخصم من الفيز / في حاله الوقود تبع العهدة ... بيخصم من العهده /
// كاوتش او غسيل ... بيخصم من العهدة». The SOURCE is stored, not derived, so the custody screen can
// sum the fund's side in the database; for a card it is also the card's own `receipt` movement,
// written with this row in one transaction (see `receipt.service.ts`).
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_FUEL_TYPES,
  FLEET_RECEIPT_KINDS,
  FLEET_RECEIPT_SOURCES,
  type FleetFuelType,
  type FleetReceiptKind,
  type FleetReceiptSource,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetReceiptImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

export interface FleetReceiptDoc extends BaseDocFields {
  date: Date;
  vehicleId: Types.ObjectId;
  driverEmployeeId: Types.ObjectId | null;
  /** The name as shown — a snapshot for a known driver, the typed text otherwise. */
  driverName: string | null;
  kind: FleetReceiptKind;
  source: FleetReceiptSource;
  cardId: Types.ObjectId | null;
  fuelType: FleetFuelType | null;
  /** The per-litre price the litres were computed with — the setting on the day. */
  pricePerLitre: number | null;
  litres: number | null;
  amount: number;
  image: FleetReceiptImage | null;
}

const imageSchema = new Schema<FleetReceiptImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const receiptSchema = new Schema<FleetReceiptDoc>(
  {
    date: { type: Date, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    driverEmployeeId: { type: Schema.Types.ObjectId, default: null },
    driverName: { type: String, default: null, trim: true },
    kind: { type: String, enum: FLEET_RECEIPT_KINDS, required: true },
    source: { type: String, enum: FLEET_RECEIPT_SOURCES, required: true },
    cardId: { type: Schema.Types.ObjectId, default: null },
    fuelType: { type: String, enum: [...FLEET_FUEL_TYPES, null], default: null },
    pricePerLitre: { type: Number, default: null, min: 0 },
    litres: { type: Number, default: null, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    image: { type: imageSchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The screen lists by date, newest first; the custody screen sums the fund's side over a range.
receiptSchema.index({ date: -1 }, { name: 'ix_receipt_date' });
receiptSchema.index({ vehicleId: 1, date: -1 }, { name: 'ix_receipt_vehicle_date' });
receiptSchema.index({ source: 1, date: -1 }, { name: 'ix_receipt_source_date' });
receiptSchema.index({ kind: 1, date: -1 }, { name: 'ix_receipt_kind_date' });
receiptSchema.index({ cardId: 1 }, { name: 'ix_receipt_card' });

export const FleetReceiptModel = model<FleetReceiptDoc>(
  'FleetReceipt',
  receiptSchema,
  'fleet_receipts',
);
