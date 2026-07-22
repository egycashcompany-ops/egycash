// Department ↔ Applications assignment (many-to-many). Each row links one department to one
// application. A partial-unique index prevents duplicate live assignments; removal is a soft delete
// of the link only and never touches the department or the application.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface DepartmentApplicationDoc extends BaseDocFields {
  departmentId: Types.ObjectId;
  applicationId: Types.ObjectId;
}

const departmentApplicationSchema = new Schema<DepartmentApplicationDoc>(
  {
    departmentId: { type: Schema.Types.ObjectId, required: true },
    applicationId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);
departmentApplicationSchema.index(
  { departmentId: 1, applicationId: 1 },
  { unique: true, name: 'ux_department_application', partialFilterExpression: { isDeleted: false } },
);
departmentApplicationSchema.index({ departmentId: 1 }, { name: 'ix_departmentId' });

export const DepartmentApplicationModel = model<DepartmentApplicationDoc>(
  'DepartmentApplication',
  departmentApplicationSchema,
  'department_applications',
);
