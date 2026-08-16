// One employee's cost-centre membership over a dated interval (P-HR-23, D-CC-1).
//
// WHY IT LIVES IN HR AND NOT BESIDE THE CATALOG. Creating one requires resolving the employee —
// to authorize by their scope and to denormalize `branchId` — and `platform` may not import a
// module. The catalog is platform's; membership is the employee's, and that is the boundary the
// dependency rule was already drawing.
//
// EXPLICIT, NOT DERIVED. The organizational tree this could otherwise be inferred from carries no
// dates, so a rule evaluated later would answer with today's structure rather than the one that
// was true. A stored interval is a fact about a time; a rule is an opinion about now.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface CostCenterAssignmentDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  costCenterId: Types.ObjectId;
  /** Date-only (UTC midnight of the Cairo calendar date). */
  effectiveFrom: Date;
  /** Inclusive; null = open-ended, the current membership. */
  effectiveTo: Date | null;
  note: string | null;
  /** ADR-015 scope axis, denormalized from the employee at write time. Never the cost centre. */
  branchId: Types.ObjectId | null;
}

const costCenterAssignmentSchema = new Schema<CostCenterAssignmentDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    costCenterId: { type: Schema.Types.ObjectId, required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The overlap query's access path and the natural read order of one employee's history.
// NOT a unique index: "no overlapping interval" is a range condition, which no single index can
// express — the service refuses it, exactly as the pay-item assignment does.
costCenterAssignmentSchema.index(
  { employeeId: 1, effectiveFrom: 1 },
  { name: 'ix_employee_effectiveFrom' },
);
costCenterAssignmentSchema.index({ costCenterId: 1 }, { name: 'ix_costCenter' });

export const CostCenterAssignmentModel = model<CostCenterAssignmentDoc>(
  'CostCenterAssignment',
  costCenterAssignmentSchema,
  'hr_cost_center_assignments',
);
