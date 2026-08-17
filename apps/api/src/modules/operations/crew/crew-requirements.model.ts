// What an employee IS to Operations — the legacy `/requirement` checkbox matrix (discovery §9).
//
// OPERATIONS-OWNED, keyed by the HR employee id. Legacy wrote these nine flags straight onto the
// `employees` document because it had one database and no module boundary; ECMS has both. HR owns
// the person; this row owns Operations' opinion of them, and the two meet through the platform
// directory seam. Nothing here duplicates an HR fact — there is no name, no title, no department.
//
// HOLDING A ROW IS MEMBERSHIP. Legacy found its crew pool with
// `department:'نقل الاموال', sub_department:'التشغيل'` (contad_app.js:2296) — Operations reaching
// into another module's org structure to infer who its people are. Here the roster is explicit:
// an employee is operations crew when Operations says so by giving them a row.
//
// AND NONE OF IT GATES ANYTHING (approved decision, carried since PR 1). Only `isCaptain` was ever
// read by a legacy server query; the rest were pool decoration and browser filters. No crew slot
// checks any of these flags, exactly as in legacy.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsCrewRequirementsDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /** Legacy `leader` — the one flag legacy queried on. */
  isCaptain: boolean;
  /** Q17 NORMALIZE — replaces `title.includes('اخص')` decided in the browser. */
  isSpecialist: boolean;
  /**
   * Legacy `new`. NOT called `isNew` here: that is a reserved Mongoose document property, and a
   * schema path of that name shadows it and breaks document behaviour. Mongoose warns rather than
   * refusing, so the rename is deliberate — the legacy field name lives in this comment.
   */
  isNewJoiner: boolean;
  hasWeapon: boolean;
  hasSignature: boolean;
  hasLicense: boolean;
  hasTemporaryLicense: boolean;
  isOpsAdmin: boolean;
  isAssignedSpecialTask: boolean;
  isPriority: boolean;
  notes: string | null;
}

const flag = { type: Boolean, required: true, default: false };

const crewRequirementsSchema = new Schema<OperationsCrewRequirementsDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    isCaptain: flag,
    isSpecialist: flag,
    isNewJoiner: flag,
    hasWeapon: flag,
    hasSignature: flag,
    hasLicense: flag,
    hasTemporaryLicense: flag,
    isOpsAdmin: flag,
    isAssignedSpecialTask: flag,
    isPriority: flag,
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One row per employee — the legacy screen keyed on `employee_id` and had no notion of a second.
crewRequirementsSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employee', partialFilterExpression: { isDeleted: false } },
);
// The captain pickers' filter — the only flag any legacy server query read.
crewRequirementsSchema.index({ isCaptain: 1 }, { name: 'ix_captain' });

export const OperationsCrewRequirementsModel = model<OperationsCrewRequirementsDoc>(
  'OperationsCrewRequirements',
  crewRequirementsSchema,
  'operations_crew_requirements',
);
