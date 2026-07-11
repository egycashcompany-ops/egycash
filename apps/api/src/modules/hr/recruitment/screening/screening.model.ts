// The Screening aggregate (Sprint 4.2, Stage 2 — Initial Screening). Exactly one screening
// per applicant (enforced by a partial unique index). `notes` accumulate while `status` is
// `pending` (the "needs more information" flow, OQ-32); the decision fields are set once,
// when the screening reaches a terminal `accepted`/`rejected` status. `applicantCode` and
// `branchId` are denormalized from the applicant for list/scoping without a cross-collection
// join (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import { SCREENING_STATUSES, type ScreeningStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ScreeningNote {
  text: string;
  by: Types.ObjectId | null;
  at: Date;
}

export interface ScreeningDoc extends BaseDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  branchId: Types.ObjectId | null;
  status: ScreeningStatus;
  notes: ScreeningNote[];
  // Decision (set once, on the terminal transition). `decisionReason` carries the
  // mandatory rejection reason, or an optional acceptance note.
  decisionReason: string | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
}

const screeningSchema = new Schema<ScreeningDoc>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: SCREENING_STATUSES, required: true, default: 'pending' },
    notes: {
      type: [
        new Schema<ScreeningNote>(
          {
            text: { type: String, required: true },
            by: { type: Schema.Types.ObjectId, default: null },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    decisionReason: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One live screening per applicant (Stage 2 — one screening record per applicant).
screeningSchema.index(
  { applicantId: 1 },
  { unique: true, name: 'ux_screening_applicant', partialFilterExpression: { isDeleted: false } },
);
screeningSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
screeningSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
screeningSchema.index({ decidedAt: -1 }, { name: 'ix_decidedAt' });

export const ScreeningModel = model<ScreeningDoc>('Screening', screeningSchema, 'hr_screenings');
