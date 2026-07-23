// The Applicant aggregate (Sprint 4.1 plan §7) — Stage 1 only. Requisition-driven
// (BD-001): every applicant carries a mandatory reference to exactly one Job Requisition.
// Identity data is human-confirmed (§2.1 rule 4); `nationalId` is stored raw but always
// masked in DTOs (Security Architecture §3). `searchName` holds the Arabic-normalized
// name for fast, fold-insensitive search (§9).
import { Schema, model, type Types } from 'mongoose';
import {
  APPLICANT_INTAKE_CHANNELS,
  APPLICANT_STATUSES,
  CONTACT_CHANNELS,
  EDUCATION_LEVELS,
  GENDERS,
  IDENTITY_VERIFICATION_STATES,
  MARITAL_STATUSES,
  MILITARY_STATUSES,
  type Address,
  type ApplicantIntakeChannel,
  type ApplicantStatus,
  type ContactChannel,
  type EducationLevel,
  type Gender,
  type IdentityVerification,
  type MaritalStatus,
  type MilitaryStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ApplicantContact {
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  preferredContactChannel: ContactChannel | null;
}

export interface ApplicantSourceDetail {
  referrerUserId: Types.ObjectId | null;
  agencyName: string | null;
  externalPlatform: string | null;
  externalId: string | null;
  note: string | null;
}

export interface ApplicantDoc extends BaseDocFields {
  code: string;
  status: ApplicantStatus;
  // Application context (§7 group 9). Optional: a direct intake has no linked Job Request
  // (the reference may be attached later when the Job Requests module lands).
  jobRequisitionId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  sourceId: Types.ObjectId;
  sourceDetail: ApplicantSourceDetail | null;
  intakeChannel: ApplicantIntakeChannel;
  intakeKey: string | null;
  expectedSalary: { amount: number; currency: string } | null;
  earliestStartDate: Date | null;
  willingToRelocate: boolean;
  willingToTravel: boolean;
  willingToShiftWork: boolean;
  externalRef: { platform: string; externalId: string } | null;
  // Identity (§7 group 1) + verification
  identityVerification: IdentityVerification;
  identityVerifiedBy: Types.ObjectId | null;
  identityVerifiedAt: Date | null;
  fullNameAr: string;
  fullNameEn: string | null;
  searchName: string; // Arabic-normalized fullNameAr (+ En), for §9 search
  nationalId: string | null;
  birthDate: Date | null;
  gender: Gender | null;
  nationality: string;
  placeOfBirth: string | null;
  photoFileId: Types.ObjectId | null;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  nationalIdExpiry: Date | null;
  dependentsCount: number | null;
  // Contact + address (§7 groups 2,3)
  contact: ApplicantContact;
  officialAddress: Address | null;
  currentAddress: Address | null;
  // Richer groups (§7 groups 4-8)
  military: { status: MilitaryStatus; certificateRef: string | null; completedAt: Date | null } | null;
  education: {
    level: EducationLevel;
    institution: string | null;
    specialization: string | null;
    graduationYear: number | null;
    grade: string | null;
  } | null;
  experience: {
    employer: string;
    position: string | null;
    from: Date | null;
    to: Date | null;
    leavingReason: string | null;
  }[];
  drivingLicenses: { class: string; expiry: Date | null }[];
  certifications: string[];
  references: { name: string; relationship: string | null; phone: string | null }[];
  // Duplicate detection (§2.1 rule 5)
  duplicateFlag: boolean;
  duplicateOf: Types.ObjectId[];
  attachmentCount: number;
  // Withdrawal (Stage-1 terminal)
  withdrawnReason: string | null;
  withdrawnAt: Date | null;
  // Explicit HR move to the Job Offer stage (never automatic) — null until moved.
  movedToOfferAt: Date | null;
  movedToOfferBy: Types.ObjectId | null;
}

const addressSchema = new Schema<Address>(
  {
    line1: { type: String, required: true },
    line2: { type: String, default: undefined },
    city: { type: String, required: true },
    governorate: { type: String, required: true },
    postalCode: { type: String, default: undefined },
  },
  { _id: false },
);

const applicantSchema = new Schema<ApplicantDoc>(
  {
    code: { type: String, required: true },
    status: { type: String, enum: APPLICANT_STATUSES, required: true, default: 'new' },
    jobRequisitionId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    sourceDetail: {
      type: new Schema<ApplicantSourceDetail>(
        {
          referrerUserId: { type: Schema.Types.ObjectId, default: null },
          agencyName: { type: String, default: null },
          externalPlatform: { type: String, default: null },
          externalId: { type: String, default: null },
          note: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    intakeChannel: {
      type: String,
      enum: APPLICANT_INTAKE_CHANNELS,
      required: true,
      default: 'internal',
    },
    intakeKey: { type: String, default: null },
    expectedSalary: {
      type: new Schema(
        { amount: { type: Number, required: true }, currency: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    earliestStartDate: { type: Date, default: null },
    willingToRelocate: { type: Boolean, required: true, default: false },
    willingToTravel: { type: Boolean, required: true, default: false },
    willingToShiftWork: { type: Boolean, required: true, default: false },
    externalRef: {
      type: new Schema(
        { platform: { type: String, required: true }, externalId: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    identityVerification: {
      type: String,
      enum: IDENTITY_VERIFICATION_STATES,
      required: true,
      default: 'unverified',
    },
    identityVerifiedBy: { type: Schema.Types.ObjectId, default: null },
    identityVerifiedAt: { type: Date, default: null },
    fullNameAr: { type: String, required: true },
    fullNameEn: { type: String, default: null },
    searchName: { type: String, required: true, default: '' },
    nationalId: { type: String, default: null },
    birthDate: { type: Date, default: null },
    gender: { type: String, enum: GENDERS, default: null },
    nationality: { type: String, required: true, default: 'Egyptian' },
    placeOfBirth: { type: String, default: null },
    photoFileId: { type: Schema.Types.ObjectId, default: null },
    maritalStatus: { type: String, enum: MARITAL_STATUSES, default: null },
    religion: { type: String, default: null },
    nationalIdExpiry: { type: Date, default: null },
    dependentsCount: { type: Number, default: null },
    contact: {
      type: new Schema<ApplicantContact>(
        {
          primaryPhone: { type: String, required: true },
          secondaryPhone: { type: String, default: null },
          email: { type: String, default: null },
          preferredContactChannel: { type: String, enum: CONTACT_CHANNELS, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    officialAddress: { type: addressSchema, default: null },
    currentAddress: { type: addressSchema, default: null },
    military: {
      type: new Schema(
        {
          status: { type: String, enum: MILITARY_STATUSES, required: true },
          certificateRef: { type: String, default: null },
          completedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    education: {
      type: new Schema(
        {
          level: { type: String, enum: EDUCATION_LEVELS, required: true },
          institution: { type: String, default: null },
          specialization: { type: String, default: null },
          graduationYear: { type: Number, default: null },
          grade: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    experience: {
      type: [
        new Schema(
          {
            employer: { type: String, required: true },
            position: { type: String, default: null },
            from: { type: Date, default: null },
            to: { type: Date, default: null },
            leavingReason: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    drivingLicenses: {
      type: [
        new Schema(
          { class: { type: String, required: true }, expiry: { type: Date, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
    certifications: { type: [String], default: [] },
    references: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            relationship: { type: String, default: null },
            phone: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    duplicateFlag: { type: Boolean, required: true, default: false },
    duplicateOf: { type: [Schema.Types.ObjectId], default: [] },
    attachmentCount: { type: Number, required: true, default: 0 },
    withdrawnReason: { type: String, default: null },
    withdrawnAt: { type: Date, default: null },
    movedToOfferAt: { type: Date, default: null },
    movedToOfferBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Applicant number is organization-wide unique (BD-002).
applicantSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// National ID unique among LIVE (non-deleted, non-withdrawn) applicants (§2.1 rule 5).
applicantSchema.index(
  { nationalId: 1 },
  {
    unique: true,
    name: 'ux_live_nationalId',
    partialFilterExpression: { nationalId: { $type: 'string' }, isDeleted: false, status: 'new' },
  },
);
applicantSchema.index({ searchName: 1 }, { name: 'ix_searchName' });
applicantSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
applicantSchema.index({ sourceId: 1 }, { name: 'ix_sourceId' });
applicantSchema.index({ jobRequisitionId: 1 }, { name: 'ix_jobRequisitionId' });
applicantSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
applicantSchema.index(
  { intakeKey: 1 },
  { unique: true, name: 'ux_intakeKey', partialFilterExpression: { intakeKey: { $type: 'string' } } },
);

export const ApplicantModel = model<ApplicantDoc>('Applicant', applicantSchema, 'hr_applicants');
