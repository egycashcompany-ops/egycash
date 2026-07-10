// Applicant source catalog (Sprint 4.1 plan §3) — the approved "Recruitment Source"
// reference entity: localized, admin-extensible, deactivated (never hard-deleted).
import { Schema, model } from 'mongoose';
import {
  APPLICANT_SOURCE_KINDS,
  type ApplicantSourceKind,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ApplicantSourceDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  kind: ApplicantSourceKind;
  requiresDetail: boolean;
  active: boolean;
}

const applicantSourceSchema = new Schema<ApplicantSourceDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    kind: { type: String, enum: APPLICANT_SOURCE_KINDS, required: true, default: 'manual' },
    requiresDetail: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

applicantSourceSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);

export const ApplicantSourceModel = model<ApplicantSourceDoc>(
  'ApplicantSource',
  applicantSourceSchema,
  'hr_applicant_sources',
);
