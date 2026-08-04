// The intake form — ONE document. "One application form, many links" was the requirement: the
// questions are the same wherever a candidate arrives from, and the link records where that was.
//
// The links live on the form rather than on the source catalog because a link is a property of
// *this form being published to that source*, not of the source itself: rotating a leaked link
// must not touch the catalog entry every applicant record already points at.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString, type RecruitmentFormField } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface RecruitmentFormLink {
  sourceId: Types.ObjectId;
  token: string;
  active: boolean;
  generatedAt: Date;
  submissions: number;
}

export interface RecruitmentFormDoc extends BaseDocFields {
  /** Fixed — the singleton's identity. A second document is a bug, not a feature. */
  key: string;
  title: LocalizedString;
  intro: LocalizedString | null;
  fields: RecruitmentFormField[];
  internalSourceId: Types.ObjectId | null;
  links: RecruitmentFormLink[];
}

const recruitmentFormSchema = new Schema<RecruitmentFormDoc>(
  {
    key: { type: String, required: true, default: 'default' },
    title: { ar: { type: String, required: true }, en: { type: String, required: true } },
    intro: {
      type: { ar: { type: String, required: true }, en: { type: String, required: true } },
      default: null,
    },
    // Stored as given: the shape is a discriminated union the contract owns, and Mongoose has no
    // way to express it that would not drift from the Zod schema that actually validates it.
    fields: { type: Schema.Types.Mixed, required: true, default: [] },
    internalSourceId: { type: Schema.Types.ObjectId, ref: 'ApplicantSource', default: null },
    links: {
      type: [
        {
          _id: false,
          sourceId: { type: Schema.Types.ObjectId, ref: 'ApplicantSource', required: true },
          token: { type: String, required: true },
          active: { type: Boolean, required: true, default: true },
          generatedAt: { type: Date, required: true },
          submissions: { type: Number, required: true, default: 0 },
        },
      ],
      default: [],
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

recruitmentFormSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);
// The public page resolves a candidate's link by token on every visit.
recruitmentFormSchema.index({ 'links.token': 1 }, { name: 'ix_link_token' });

export const RecruitmentFormModel = model<RecruitmentFormDoc>(
  'RecruitmentForm',
  recruitmentFormSchema,
  'hr_recruitment_forms',
);
