// A shipment's crew leg — one entity replacing the legacy leader1/car_num1 vs leader2/car_num2
// field duplication (discovery §4.1). `leg: 'pickup'` is the daily collection run (legacy
// leader1/car_num1, attributed by rec_date); `leg: 'delivery'` is the secured delivery run
// (legacy leader2/car_num2, attributed by del_date) — which is exactly the split the legacy
// captain report proves, grouping its daily facet by leader1 and its secured facet by leader2
// (contad_app.js:4894/4931).
//
// Specialists are deliberately ABSENT: legacy never stored them on the shipment (the spe*_ fields
// are dead — discovery §3.1), and they stay resolved through `crewAssignmentId` → the (day,
// vehicle) crew row. That is what makes `day + vehicle + leg → crew` answerable without
// duplicating crew ownership.
//
// `sequence` and execution state are NOT here — they arrive with the sequencing slice.
import { Schema, model, type Types } from 'mongoose';
import { OPERATIONS_SHIPMENT_LEGS, type OperationsShipmentLeg } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsShipmentAssignmentDoc extends BaseDocFields {
  shipmentId: Types.ObjectId;
  leg: OperationsShipmentLeg;
  operationsDayId: Types.ObjectId;
  captainEmployeeId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  crewAssignmentId: Types.ObjectId;
}

const assignmentSchema = new Schema<OperationsShipmentAssignmentDoc>(
  {
    shipmentId: { type: Schema.Types.ObjectId, required: true },
    leg: { type: String, required: true, enum: OPERATIONS_SHIPMENT_LEGS },
    operationsDayId: { type: Schema.Types.ObjectId, required: true },
    captainEmployeeId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    crewAssignmentId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One assignment per (shipment, leg) — the DB half of duplicate-assignment protection. Re-assigning
// updates this row in place, exactly as the legacy bulkWrite overwrote leader2/car_num2 (:4491).
assignmentSchema.index(
  { shipmentId: 1, leg: 1 },
  { unique: true, name: 'ux_shipment_leg', partialFilterExpression: { isDeleted: false } },
);
assignmentSchema.index(
  { operationsDayId: 1, captainEmployeeId: 1 },
  { name: 'ix_day_captain' }, // the captain's day — what the mobile slice will read
);

export const OperationsShipmentAssignmentModel = model<OperationsShipmentAssignmentDoc>(
  'OperationsShipmentAssignment',
  assignmentSchema,
  'operations_shipment_assignments',
);
