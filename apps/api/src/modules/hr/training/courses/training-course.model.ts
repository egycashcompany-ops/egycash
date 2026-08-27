// The training catalogue (P-HR-TRN D1).
//
// CONFIGURATION, NOT HISTORY. A course says «defensive driving exists as a thing we teach»; it says
// nothing about who has done it. That is why it is editable and deactivatable, and why the records
// in `hr_training_records` copy its name rather than pointing at it (D8): a course renamed in 2028
// must not change what a 2026 certificate says.
//
// NO PRICE AND NO REQUIRED-BY-JOB-TITLE FLAG, and both absences are decisions. D12 keeps money out
// so the accounting boundary stays where PY-12 and P-HR-14 left it; D13 keeps out «every driver
// must hold this», which is a rule about job titles nobody has stated. `training-absences.spec.ts`
// asserts both, because an absence nobody asserts is an absence somebody adds by accident.
//
// ORGANIZATION-WIDE, so no scope field: a catalogue entry belongs to the company, exactly as the
// evaluation phases and applicant document types it is modelled on do. The rows that carry a PERSON
// carry the two axes (D14); this one carries nobody.
import { Schema, model } from 'mongoose';
import {
  TRAINING_DELIVERY_MODES,
  type LocalizedString,
  type TrainingDeliveryMode,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface TrainingCourseDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  description: LocalizedString | null;
  /** Advisory: a session states its own dates, and no record is computed from this. */
  defaultDurationHours: number | null;
  defaultDeliveryMode: TrainingDeliveryMode;
  order: number;
  active: boolean;
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const trainingCourseSchema = new Schema<TrainingCourseDoc>(
  {
    ...baseFields,
    key: { type: String, required: true },
    name: { type: localized, required: true },
    description: { type: localized, default: null },
    defaultDurationHours: { type: Number, default: null },
    defaultDeliveryMode: {
      type: String,
      enum: TRAINING_DELIVERY_MODES,
      required: true,
      default: 'classroom',
    },
    order: { type: Number, required: true, default: 0 },
    // Deactivated, never deleted: historical records name this course.
    active: { type: Boolean, required: true, default: true },
  },
  baseSchemaOptions,
);

/** The key is the stable identity a seed re-runs against, so it is unique among live rows. */
trainingCourseSchema.index(
  { key: 1 },
  { name: 'ux_key', unique: true, partialFilterExpression: { isDeleted: false } },
);
trainingCourseSchema.index({ active: 1, order: 1 }, { name: 'ix_active_order' });

export const TrainingCourseModel = model<TrainingCourseDoc>(
  'HrTrainingCourse',
  trainingCourseSchema,
  'hr_training_courses',
);
