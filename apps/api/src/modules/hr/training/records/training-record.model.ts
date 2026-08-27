// What somebody was taught, and when (P-HR-TRN D8).
//
// THE ONE COLLECTION THIS MODULE EXISTS FOR. Everything before it is scaffolding for a sentence
// somebody needs years later: «Ahmed completed defensive driving on 5 March 2026.» That sentence
// has to survive the course being renamed, the trainer leaving and the session being deleted.
//
// SO EVERY NAME HERE IS A COPY, taken at the moment of writing. `courseNameAr` is not read through
// `courseId`; `sessionCode` is not read through `sessionId`. Those ids are kept so somebody can
// still trace the row, but nothing this record SAYS depends on them still resolving. That is the
// same argument D-DEPT-2 makes for the payslip's department stamp, applied to words instead of a
// scope: a fact about the past must not be re-derived from a present that has moved on.
//
// AND IT IS NEVER EDITED. There is no update path in the service and no `$set` anywhere near it —
// `training-immutability.spec.ts` asserts that by source, because nothing in Mongoose would stop
// somebody adding one and nothing in the type system would notice.
//
// The two fields that DO change after creation are the certificate's, and they are the exception
// D9 states: the paperwork arrives days after the training, and a record with no certificate is a
// completed training whose certificate has not been scanned yet.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface TrainingRecordDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  courseId: Types.ObjectId;
  courseKey: string;
  courseNameAr: string;
  courseNameEn: string;
  sessionId: Types.ObjectId;
  sessionCode: string;
  trainerName: string | null;
  startedAt: Date;
  completedAt: Date;
  /** Recorded when the certificate carries one, and consumed by nothing (D10). */
  expiresAt: Date | null;
  certificateFileId: Types.ObjectId | null;
  certificateFileName: string | null;
  note: string | null;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}

const trainingRecordSchema = new Schema<TrainingRecordDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    courseKey: { type: String, required: true },
    courseNameAr: { type: String, required: true },
    courseNameEn: { type: String, required: true },
    sessionId: { type: Schema.Types.ObjectId, required: true },
    sessionCode: { type: String, required: true },
    trainerName: { type: String, default: null },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    certificateFileId: { type: Schema.Types.ObjectId, default: null },
    certificateFileName: { type: String, default: null },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

/**
 * ONE RECORD PER (person, session). A session completed twice would otherwise say somebody
 * qualified twice on one day — and the completion act is guarded by the session's own state
 * machine, so this index is the backstop rather than the rule.
 */
trainingRecordSchema.index(
  { employeeId: 1, sessionId: 1 },
  { name: 'ux_employee_session', unique: true, partialFilterExpression: { isDeleted: false } },
);
// «what has this person been taught», newest first — the history screen's only read.
trainingRecordSchema.index({ employeeId: 1, completedAt: -1 }, { name: 'ix_employee_completedAt' });
// «who has done this course» — the question the catalogue exists to make answerable.
trainingRecordSchema.index({ courseId: 1, completedAt: -1 }, { name: 'ix_course_completedAt' });
trainingRecordSchema.index({ branchId: 1, completedAt: -1 }, { name: 'ix_branchId_completedAt' });
trainingRecordSchema.index(
  { departmentId: 1, completedAt: -1 },
  { name: 'ix_departmentId_completedAt' },
);

export const TrainingRecordModel = model<TrainingRecordDoc>(
  'HrTrainingRecord',
  trainingRecordSchema,
  'hr_training_records',
);
