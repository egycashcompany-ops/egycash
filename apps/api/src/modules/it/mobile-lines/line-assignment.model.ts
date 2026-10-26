// `it_mobile_line_assignments` — a line's custody intervals, the assets' `it_asset_assignments`
// twin (design §2.5).
//
// One row per period a line was out. `returnedAt === null` means OPEN, and the line carries the
// row's id as `currentAssignmentId`. The holder is an EMPLOYEE, who signs an acknowledgment for
// it, or a CAR — the SIM inside its tracker — written as the car's code and plate the way the
// network's sheet names it («سيارة … — …»). IT reads nothing from Fleet to do so.
//
// «At most one open interval per line» is a partial unique index over BOTH holder kinds, not a
// check in code: two hand-overs racing on one line both read `inStock`, and only the index makes
// the second one a database error instead of a line held twice.
import { Schema, model, type Types } from 'mongoose';
import { IT_MOBILE_LINE_HOLDER_KINDS, type ItMobileLineHolderKind } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItMobileLineAssignmentDoc extends BaseDocFields {
  lineId: Types.ObjectId;
  holderKind: ItMobileLineHolderKind;
  /** An employee holder; null for a car. */
  assignedToEmployeeId: Types.ObjectId | null;
  /** A car holder, as written at the hand-over; null for an employee. */
  vehicleCode: string | null;
  vehiclePlate: string | null;
  assignedByUserId: Types.ObjectId | null;
  assignedAt: Date;
  returnedAt: Date | null;
  returnedToUserId: Types.ObjectId | null;
  notes: string | null;
  /** The line's branch when the interval opened — the scope of the custody reads, no join. */
  branchId: Types.ObjectId;
  /** The acknowledgment the employee signed; null for a car, which signs nothing. */
  receiptId: Types.ObjectId | null;
}

const lineAssignmentSchema = new Schema<ItMobileLineAssignmentDoc>(
  {
    lineId: { type: Schema.Types.ObjectId, required: true },
    holderKind: { type: String, enum: IT_MOBILE_LINE_HOLDER_KINDS, required: true },
    assignedToEmployeeId: { type: Schema.Types.ObjectId, default: null },
    vehicleCode: { type: String, default: null },
    vehiclePlate: { type: String, default: null },
    assignedByUserId: { type: Schema.Types.ObjectId, default: null },
    assignedAt: { type: Date, required: true },
    returnedAt: { type: Date, default: null },
    returnedToUserId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    receiptId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// THE custody invariant, in the only place that holds it under concurrency.
lineAssignmentSchema.index(
  { lineId: 1 },
  {
    unique: true,
    name: 'ux_open_assignment_per_line',
    partialFilterExpression: { returnedAt: null, isDeleted: false },
  },
);
// A line's custody list, newest first.
lineAssignmentSchema.index({ lineId: 1, assignedAt: -1 }, { name: 'ix_line_assignedAt' });
// «What does this person hold?» — the IT employee page and the exit safety net.
lineAssignmentSchema.index(
  { assignedToEmployeeId: 1, returnedAt: 1 },
  { name: 'ix_employee_open' },
);
// Branch-scoped reads of everything out.
lineAssignmentSchema.index({ branchId: 1, returnedAt: 1 }, { name: 'ix_branch_open' });

export const ItMobileLineAssignmentModel = model<ItMobileLineAssignmentDoc>(
  'ItMobileLineAssignment',
  lineAssignmentSchema,
  'it_mobile_line_assignments',
);
