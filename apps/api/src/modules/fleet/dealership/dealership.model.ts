// A dealership invoice row (التوكيل) — one workshop exit's bill, or the yellow place it will go.
//
// «دى العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف بيكون باللون الاصفر». The row is
// opened by the maintenance check-out and carries what that moment knew: the car, the exit date,
// which half of the work it is. The invoice itself — number, amount, scan — is written later by
// the clerk holding the paper, and until then `invoiceAmount` is null, which IS the pending state.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_DEALERSHIP_SIDES,
  FLEET_DEALERSHIP_WORK_KINDS,
  type FleetDealershipSide,
  type FleetDealershipWorkKind,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetDealershipImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

export interface FleetDealershipInvoiceDoc extends BaseDocFields {
  visitId: Types.ObjectId;
  /** `null` only for a visit kept from the old book on a car the registry never had. */
  vehicleId: Types.ObjectId | null;
  /** The old book's code, set only where `vehicleId` is null. */
  vehicleCode: string | null;
  outDate: Date;
  workKind: FleetDealershipWorkKind;
  workTypeLabel: string;
  privateCar: boolean;
  insuranceCompanyId: Types.ObjectId | null;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  image: FleetDealershipImage | null;
  /** Stored once the invoice is recorded, so the custody screen can sum it in the database. */
  side: FleetDealershipSide | null;
}

const imageSchema = new Schema<FleetDealershipImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const dealershipSchema = new Schema<FleetDealershipInvoiceDoc>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    outDate: { type: Date, required: true },
    workKind: { type: String, enum: FLEET_DEALERSHIP_WORK_KINDS, required: true },
    workTypeLabel: { type: String, required: true },
    privateCar: { type: Boolean, required: true, default: false },
    insuranceCompanyId: { type: Schema.Types.ObjectId, default: null },
    invoiceNumber: { type: String, default: null },
    invoiceAmount: { type: Number, default: null, min: 0 },
    image: { type: imageSchema, default: null },
    side: { type: String, enum: FLEET_DEALERSHIP_SIDES, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The screen lists by exit date, newest first; the custody screen sums by side over a date range.
dealershipSchema.index({ outDate: -1 }, { name: 'ix_dealership_out' });
dealershipSchema.index({ vehicleId: 1, outDate: -1 }, { name: 'ix_dealership_vehicle_out' });
dealershipSchema.index({ side: 1, outDate: -1 }, { name: 'ix_dealership_side_out' });
// A check-out opens the rows and a reopen withdraws the pending ones — both by visit.
dealershipSchema.index({ visitId: 1 }, { name: 'ix_dealership_visit' });

export const FleetDealershipInvoiceModel = model<FleetDealershipInvoiceDoc>(
  'FleetDealershipInvoice',
  dealershipSchema,
  'fleet_dealership_invoices',
);
