// One delivery of one course (P-HR-TRN D2).
//
// A SESSION IS AN EVENT AND A COURSE IS CONFIGURATION. Running defensive driving in March and again
// in July creates two of these and does not duplicate the catalogue row — which is what makes «how
// many people have done defensive driving» a question with an answer.
//
// THE COURSE IS DENORMALIZED BESIDE ITS ID, and unlike the record's copy (D8) this one is a cache
// rather than a snapshot: a session list must not be a second query per row, and a session is
// short-lived enough that a rename during it is not the case worth designing for. The RECORD is
// where the copy has to be permanent.
//
// `branchId` ONLY, and deliberately. A session belongs to a branch because that is where it is
// held; it does not belong to a department, because the people in the room come from several. The
// department axis lives on the ENROLLMENT, which is the row that carries a person (D14).
import { Schema, model, type Types } from 'mongoose';
import {
  TRAINING_DELIVERY_MODES,
  TRAINING_SESSION_STATUSES,
  type LocalizedString,
  type TrainingDeliveryMode,
  type TrainingSessionStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface TrainingSessionDoc extends BaseDocFields {
  code: string;
  courseId: Types.ObjectId;
  courseKey: string;
  courseName: LocalizedString;
  status: TrainingSessionStatus;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: TrainingDeliveryMode;
  location: string | null;
  /** As written. Most trainers are not ECMS accounts, so this is not a user reference. */
  trainerName: string | null;
  /** Null is UNLIMITED, not zero — see `seatsLeft` in the rules (D5). */
  capacity: number | null;
  note: string | null;
  branchId: Types.ObjectId | null;
  cancelledReason: string | null;
  completedAt: Date | null;
  completedBy: Types.ObjectId | null;
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const trainingSessionSchema = new Schema<TrainingSessionDoc>(
  {
    ...baseFields,
    code: { type: String, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    courseKey: { type: String, required: true },
    courseName: { type: localized, required: true },
    status: {
      type: String,
      enum: TRAINING_SESSION_STATUSES,
      required: true,
      default: 'scheduled',
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    deliveryMode: {
      type: String,
      enum: TRAINING_DELIVERY_MODES,
      required: true,
      default: 'classroom',
    },
    location: { type: String, default: null },
    trainerName: { type: String, default: null },
    capacity: { type: Number, default: null },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    cancelledReason: { type: String, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

trainingSessionSchema.index(
  { code: 1 },
  { name: 'ux_code', unique: true, partialFilterExpression: { isDeleted: false } },
);
trainingSessionSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
// The calendar read: «what is running this month», which is how the screen opens.
trainingSessionSchema.index({ startsAt: 1, status: 1 }, { name: 'ix_startsAt_status' });
trainingSessionSchema.index({ courseId: 1, startsAt: -1 }, { name: 'ix_course_startsAt' });

export const TrainingSessionModel = model<TrainingSessionDoc>(
  'HrTrainingSession',
  trainingSessionSchema,
  'hr_training_sessions',
);
