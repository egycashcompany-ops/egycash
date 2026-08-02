// Accidents (fleet design §2.8, §4.6, FR-10). The stored COLOR of the legacy became a real
// status enum; both directions of open↔closed are legal and audited. Amounts are typed numbers
// entered as facts — no derived money until §13-Q9 defines the formula.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { FLEET_ACCIDENT_STATUSES, type FleetAccidentStatus } from '@ecms/contracts';

export interface FleetAccidentDoc extends BaseDocFields {
  vehicleId: Types.ObjectId;
  occurredAt: Date;
  culprit: string;
  statement: string;
  companyCost: number;
  amountCollected: number;
  paidAmount: number;
  status: FleetAccidentStatus;
  notes: string | null;
}

const accidentSchema = new Schema<FleetAccidentDoc>(
  {
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    occurredAt: { type: Date, required: true },
    culprit: { type: String, required: true },
    statement: { type: String, required: true },
    companyCost: { type: Number, required: true, min: 0 },
    amountCollected: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: FLEET_ACCIDENT_STATUSES, required: true },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

accidentSchema.index({ vehicleId: 1, occurredAt: -1 }, { name: 'ix_vehicle_occurred' });
accidentSchema.index({ status: 1 }, { name: 'ix_status' });

export const FleetAccidentModel = model<FleetAccidentDoc>(
  'FleetAccident',
  accidentSchema,
  'fleet_accidents',
);
