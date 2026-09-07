import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import {
  addOrgUnitIndexes,
  baseSchemaOptions,
  localizedField,
  orgUnitFields,
  type OrgUnitDoc,
} from '../shared/org-unit';

export interface DepartmentDoc extends OrgUnitDoc {
  branchId: Types.ObjectId;
  /**
   * The company-wide department this row declares the branch has (P-ORG-2), or `null`.
   *
   * NULLABLE, AND STAYING THAT WAY. A row created before the catalog existed carries `null` until
   * the migration links it, and a deployment that never defines a catalog runs entirely on `null` —
   * neither is a broken row, and requiring the link would refuse a department a single branch has.
   */
  catalogId: Types.ObjectId | null;
  /** Optional bilingual description (Phase 3.2). */
  description: LocalizedString | null;
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const departmentSchema = new Schema<DepartmentDoc>(
  {
    ...orgUnitFields,
    branchId: { type: Schema.Types.ObjectId, required: true },
    catalogId: { type: Schema.Types.ObjectId, default: null },
    description: { type: localizedSubSchema, default: null },
  },
  baseSchemaOptions,
);
addOrgUnitIndexes(departmentSchema);
departmentSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });

/**
 * One branch declares a company-wide department AT MOST ONCE — the invariant that stops the
 * duplication coming back through the front door (P-ORG-2).
 *
 * `catalogId: {$type: 'objectId'}` in the partial filter is load-bearing. Without it every unlinked
 * row in a branch would carry `(branchId, null)` and the SECOND one would collide, which would
 * refuse a perfectly ordinary department on a deployment that has no catalog at all. The constraint
 * applies to rows that have made a claim, and to no others.
 */
departmentSchema.index(
  { branchId: 1, catalogId: 1 },
  {
    unique: true,
    name: 'ux_branch_catalog',
    partialFilterExpression: { isDeleted: false, catalogId: { $type: 'objectId' } },
  },
);

export const DepartmentModel = model<DepartmentDoc>('Department', departmentSchema, 'departments');
