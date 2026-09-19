// User → role assignments, optionally time-bound (Review R14): expiry is enforced
// at permission-set computation time, not by a cleanup job.
import { Schema, model, type Types } from 'mongoose';
import { DATA_SCOPES, type DataScope } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface RoleAssignmentDoc extends BaseDocFields {
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  scope: DataScope;
  /** The scope's resolved placement (the target user's home branch/department/section). */
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  sectionId: Types.ObjectId | null;
  /**
   * The grant's reach beyond the home unit. `branchIds` are branches ADDED to the holder's own;
   * `departmentCatalogId` names the company-wide department a `department` grant is about, so it
   * can reach that department's copy in every branch listed — or in all of them, when
   * `allBranches` is set. Rows written before this existed carry `[]`, `null`, `false` and behave
   * exactly as they always did.
   */
  branchIds: Types.ObjectId[];
  departmentCatalogId: Types.ObjectId | null;
  allBranches: boolean;
  validFrom: Date | null;
  validTo: Date | null;
}

const roleAssignmentSchema = new Schema<RoleAssignmentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    roleId: { type: Schema.Types.ObjectId, required: true },
    scope: { type: String, enum: DATA_SCOPES, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    branchIds: { type: [Schema.Types.ObjectId], default: [] },
    departmentCatalogId: { type: Schema.Types.ObjectId, default: null },
    allBranches: { type: Boolean, default: false },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);
roleAssignmentSchema.index({ userId: 1 }, { name: 'ix_userId' });
roleAssignmentSchema.index({ roleId: 1 }, { name: 'ix_roleId' });
// One grant per (user, role, scope, department). The department is in the key because the same
// role — «مدير إدارة» — can legitimately be held for «الحركة» and for «الأمن» at once, and those are
// two grants. Rows without a catalog department carry `null` there, which the index treats as one
// value, so the old rule (one grant per user, role and scope) still holds for them unchanged.
roleAssignmentSchema.index(
  { userId: 1, roleId: 1, scope: 1, departmentCatalogId: 1 },
  {
    unique: true,
    name: 'ux_userId_roleId_scope_department',
    partialFilterExpression: { isDeleted: false },
  },
);

export const RoleAssignmentModel = model<RoleAssignmentDoc>(
  'RoleAssignment',
  roleAssignmentSchema,
  'role_assignments',
);
