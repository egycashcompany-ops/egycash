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
// `sequence` (OP-5) is the captain's execution ORDER for the day — position only. Execution STATE
// (started/picked-up/delivered) and the sequential-execution lock are deliberately NOT here: they
// arrive with the captain-execution slice, and keeping order separate from execution is what lets
// Operations reorder a plan without touching what a captain has already done.
import { Schema, model, type Types } from 'mongoose';
import {
  OPERATIONS_EXECUTION_STATUSES,
  OPERATIONS_SHIPMENT_LEGS,
  type OperationsExecutionStatus,
  type OperationsShipmentLeg,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsShipmentAssignmentDoc extends BaseDocFields {
  shipmentId: Types.ObjectId;
  leg: OperationsShipmentLeg;
  operationsDayId: Types.ObjectId;
  captainEmployeeId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  crewAssignmentId: Types.ObjectId;
  /** 1-based position within (operationsDayId, captainEmployeeId, leg). */
  sequence: number;

  // ── Captain execution (OP-7, NEW — no legacy counterpart) ─────────────────────────────────────
  // Execution state lives HERE, on the assignment, and NOT on the shipment. The two are different
  // lifecycles owned by different actors: the shipment's `status` is the back-office business
  // ladder (legacy-derived, `operationsShipment.complete`), while this is how far the captain has
  // got on THIS leg (`operationsExecution.own`). A secured shipment has two legs carried by two
  // captains on two days — one shared field could not describe both, which is the structural
  // reason they cannot be merged even if someone wanted to.
  executionStatus: OperationsExecutionStatus;
  startedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
}

const assignmentSchema = new Schema<OperationsShipmentAssignmentDoc>(
  {
    shipmentId: { type: Schema.Types.ObjectId, required: true },
    leg: { type: String, required: true, enum: OPERATIONS_SHIPMENT_LEGS },
    operationsDayId: { type: Schema.Types.ObjectId, required: true },
    captainEmployeeId: { type: Schema.Types.ObjectId, required: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
    crewAssignmentId: { type: Schema.Types.ObjectId, required: true },
    sequence: { type: Number, required: true, min: 1 },
    executionStatus: {
      type: String,
      required: true,
      enum: OPERATIONS_EXECUTION_STATUSES,
      default: 'pending',
    },
    startedAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
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
// No two stops share a position on one captain-day-leg. The service derives positions from the
// payload's array index (so a duplicate cannot be expressed) — this index is the DB-level second
// guard, the same belt-and-braces the fleet roster uses for its own identity pair.
assignmentSchema.index(
  { operationsDayId: 1, captainEmployeeId: 1, leg: 1, sequence: 1 },
  { unique: true, name: 'ux_day_captain_leg_sequence', partialFilterExpression: { isDeleted: false } },
);

export const OperationsShipmentAssignmentModel = model<OperationsShipmentAssignmentDoc>(
  'OperationsShipmentAssignment',
  assignmentSchema,
  'operations_shipment_assignments',
);
