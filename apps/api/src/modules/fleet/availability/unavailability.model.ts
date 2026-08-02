// Driver unavailability (fleet design §2.4) — the DAILY OPERATIONAL overlay, per the owner's
// decision on §13-Q1: official leave lives in HR and is READ through the directory seam;
// this collection holds only what the fleet floor knows and HR does not (مأمورية، عهدة خارجية،
// غياب مفاجئ لم يتحول لإجازة بعد). It never mirrors a leave row.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetUnavailabilityDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  from: Date;
  to: Date;
  reason: string;
  notes: string | null;
}

const unavailabilitySchema = new Schema<FleetUnavailabilityDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The roster's question is always "who is unavailable on date D" (§4.5).
unavailabilitySchema.index({ employeeId: 1, from: 1, to: 1 }, { name: 'ix_employee_span' });
unavailabilitySchema.index({ from: 1, to: 1 }, { name: 'ix_span' });

export const FleetUnavailabilityModel = model<FleetUnavailabilityDoc>(
  'FleetUnavailability',
  unavailabilitySchema,
  'fleet_driver_unavailability',
);
