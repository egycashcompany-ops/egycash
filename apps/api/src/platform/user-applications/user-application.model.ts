// User ↔ Applications assignment (many-to-many). Each row links one user to one application (a direct
// grant). A partial-unique index prevents duplicate live assignments; removal is a soft delete of the
// link only and never touches the user or the application.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface UserApplicationDoc extends BaseDocFields {
  userId: Types.ObjectId;
  applicationId: Types.ObjectId;
}

const userApplicationSchema = new Schema<UserApplicationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    applicationId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);
userApplicationSchema.index(
  { userId: 1, applicationId: 1 },
  { unique: true, name: 'ux_user_application', partialFilterExpression: { isDeleted: false } },
);
userApplicationSchema.index({ userId: 1 }, { name: 'ix_userId' });

export const UserApplicationModel = model<UserApplicationDoc>(
  'UserApplication',
  userApplicationSchema,
  'user_applications',
);
