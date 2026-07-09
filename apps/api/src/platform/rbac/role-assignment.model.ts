// User → role assignments, optionally time-bound (Review R14): expiry is enforced
// at permission-set computation time, not by a cleanup job.
import { Schema, model, type Types } from 'mongoose';
import { DATA_SCOPES, type DataScope } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface RoleAssignmentDoc extends BaseDocFields {
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  scope: DataScope;
  branchId: Types.ObjectId | null;
  validFrom: Date | null;
  validTo: Date | null;
}

const roleAssignmentSchema = new Schema<RoleAssignmentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    roleId: { type: Schema.Types.ObjectId, required: true },
    scope: { type: String, enum: DATA_SCOPES, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);
roleAssignmentSchema.index({ userId: 1 }, { name: 'ix_userId' });
roleAssignmentSchema.index({ roleId: 1 }, { name: 'ix_roleId' });
roleAssignmentSchema.index(
  { userId: 1, roleId: 1, scope: 1 },
  { unique: true, name: 'ux_userId_roleId_scope', partialFilterExpression: { isDeleted: false } },
);

export const RoleAssignmentModel = model<RoleAssignmentDoc>(
  'RoleAssignment',
  roleAssignmentSchema,
  'role_assignments',
);
