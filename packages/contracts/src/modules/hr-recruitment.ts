// HR / Recruitment — Applicants (Sprint 4.1, Stage 1). Shared contracts for the first
// Layer 2 business module. Scope is Stage 1 (Applicants) only: nothing here describes
// Screening (Stage 2) or later. Frozen plan: docs/12-planning/sprint-4.1-plan.md.
import { z } from 'zod';
import {
  AddressSchema,
  LocalizedStringSchema,
  NationalIdSchema,
  PaginationQuerySchema,
  PhoneNumberSchema,
  objectId,
  type Address,
  type LocalizedString,
} from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

export const GENDERS = ['male', 'female'] as const;
export const GenderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;

/**
 * Applicant lifecycle. `new` = live in the active pipeline; `rejected` (Stage 2, Initial
 * Screening) and `withdrawn` (Stage 1) are terminal. Interview/offer states are Stage 3+.
 * A `rejected` applicant leaves the live National-ID uniqueness set, exactly like a
 * `withdrawn` one, so the number frees up for a fresh application.
 */
export const APPLICANT_STATUSES = ['new', 'rejected', 'withdrawn'] as const;
export const ApplicantStatusSchema = z.enum(APPLICANT_STATUSES);
export type ApplicantStatus = z.infer<typeof ApplicantStatusSchema>;

export const IDENTITY_VERIFICATION_STATES = ['unverified', 'verified'] as const;
export const IdentityVerificationSchema = z.enum(IDENTITY_VERIFICATION_STATES);
export type IdentityVerification = z.infer<typeof IdentityVerificationSchema>;

/** How an applicant physically entered the system (not the same as source, §2.1). */
export const APPLICANT_INTAKE_CHANNELS = ['internal', 'web', 'mobile', 'integration'] as const;
export const ApplicantIntakeChannelSchema = z.enum(APPLICANT_INTAKE_CHANNELS);
export type ApplicantIntakeChannel = z.infer<typeof ApplicantIntakeChannelSchema>;

/** How a source catalog entry is used — drives which structured detail it may carry. */
export const APPLICANT_SOURCE_KINDS = ['manual', 'publicForm', 'integration'] as const;
export const ApplicantSourceKindSchema = z.enum(APPLICANT_SOURCE_KINDS);
export type ApplicantSourceKind = z.infer<typeof ApplicantSourceKindSchema>;

export const MILITARY_STATUSES = [
  'completed',
  'exempted',
  'postponed',
  'serving',
  'notApplicable',
] as const;
export const MilitaryStatusSchema = z.enum(MILITARY_STATUSES);
export type MilitaryStatus = z.infer<typeof MilitaryStatusSchema>;

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export const MaritalStatusSchema = z.enum(MARITAL_STATUSES);
export type MaritalStatus = z.infer<typeof MaritalStatusSchema>;

export const CONTACT_CHANNELS = ['phone', 'email', 'whatsapp'] as const;
export const ContactChannelSchema = z.enum(CONTACT_CHANNELS);
export type ContactChannel = z.infer<typeof ContactChannelSchema>;

export const EDUCATION_LEVELS = [
  'none',
  'primary',
  'preparatory',
  'secondary',
  'diploma',
  'bachelor',
  'master',
  'doctorate',
] as const;
export const EducationLevelSchema = z.enum(EDUCATION_LEVELS);
export type EducationLevel = z.infer<typeof EducationLevelSchema>;

// ── Applicant sources (admin-managed reference catalog, §3) ─────────────────

export const CreateApplicantSourceSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    kind: ApplicantSourceKindSchema.default('manual'),
    /** Whether recruiters must attach structured detail (referrer, agency, external ref). */
    requiresDetail: z.boolean().default(false),
  })
  .strict();
export type CreateApplicantSource = z.infer<typeof CreateApplicantSourceSchema>;

export const UpdateApplicantSourceSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    kind: ApplicantSourceKindSchema.optional(),
    requiresDetail: z.boolean().optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplicantSource = z.infer<typeof UpdateApplicantSourceSchema>;

export const ListApplicantSourcesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  kind: ApplicantSourceKindSchema.optional(),
}).strict();
export type ListApplicantSourcesQuery = z.infer<typeof ListApplicantSourcesQuerySchema>;

export interface ApplicantSourceDto {
  id: string;
  key: string;
  name: LocalizedString;
  kind: ApplicantSourceKind;
  requiresDetail: boolean;
  active: boolean;
  version: number;
}

// ── Applicant business-data sub-objects (§7) ────────────────────────────────

const ExpectedSalarySchema = z
  .object({ amount: z.number().nonnegative(), currency: z.string().length(3).default('EGP') })
  .strict();

const MilitaryServiceSchema = z
  .object({
    status: MilitaryStatusSchema,
    certificateRef: z.string().max(100).optional(),
    completedAt: z.coerce.date().optional(),
  })
  .strict();

const EducationSchema = z
  .object({
    level: EducationLevelSchema,
    institution: z.string().max(200).optional(),
    specialization: z.string().max(200).optional(),
    graduationYear: z.number().int().min(1950).max(2100).optional(),
    grade: z.string().max(50).optional(),
  })
  .strict();

const ExperienceEntrySchema = z
  .object({
    employer: z.string().min(1).max(200),
    position: z.string().max(200).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    leavingReason: z.string().max(500).optional(),
  })
  .strict();

const DrivingLicenseSchema = z
  .object({
    class: z.string().min(1).max(50), // e.g. "private", "1st", "2nd", "3rd" grade
    expiry: z.coerce.date().optional(),
  })
  .strict();

const ReferenceSchema = z
  .object({
    name: z.string().min(1).max(200),
    relationship: z.string().max(100).optional(),
    phone: z.string().max(30).optional(),
  })
  .strict();

/** Structured detail a source may carry (referral employee, agency, external ref) — §3. */
const SourceDetailSchema = z
  .object({
    referrerUserId: objectId().optional(),
    agencyName: z.string().max(200).optional(),
    externalPlatform: z.string().max(100).optional(),
    externalId: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

// ── Applicant registration & updates ────────────────────────────────────────

/**
 * The identity block. All fields optional at registration EXCEPT the Arabic full name
 * (plan §7: "Registration (name)"); the National ID is optional (ID-less registration,
 * §2.1 rule 2). When a National ID is supplied it must be structurally valid; birth date,
 * gender and place of birth are then derived server-side (never trusted from the client).
 */
const IdentityInputSchema = z
  .object({
    fullNameAr: z.string().min(2).max(200),
    fullNameEn: z.string().max(200).optional(),
    nationalId: NationalIdSchema.optional(),
    nationality: z.string().max(100).default('Egyptian'),
    photoFileId: objectId().optional(),
    maritalStatus: MaritalStatusSchema.optional(),
    dependentsCount: z.number().int().min(0).max(50).optional(),
    /** Read from the National-ID card (back). Free text — Egypt records a small set. */
    religion: z.string().max(100).optional(),
    /** National-ID card expiry (read from the card front; not derivable from the number). */
    nationalIdExpiry: z.coerce.date().optional(),
  })
  .strict();

const ContactInputSchema = z
  .object({
    primaryPhone: PhoneNumberSchema,
    secondaryPhone: PhoneNumberSchema.optional(),
    email: z.string().email().optional(),
    preferredContactChannel: ContactChannelSchema.optional(),
  })
  .strict();

export const RegisterApplicantSchema = z
  .object({
    // Application context (§7 group 9). Historically mandatory (BD-001), but direct intake
    // from the Applicants screen is now supported: the requisition is OPTIONAL and, when the
    // future Job Requests module lands, an applicant can be linked to a requisition later.
    jobRequisitionId: objectId().optional(),
    branchId: objectId().optional(),
    sourceId: objectId(),
    sourceDetail: SourceDetailSchema.optional(),
    intakeChannel: ApplicantIntakeChannelSchema.default('internal'),
    expectedSalary: ExpectedSalarySchema.optional(),
    earliestStartDate: z.coerce.date().optional(),
    willingToRelocate: z.boolean().optional(),
    willingToTravel: z.boolean().optional(),
    willingToShiftWork: z.boolean().optional(),
    // Identity + contact + address.
    identity: IdentityInputSchema,
    contact: ContactInputSchema,
    officialAddress: AddressSchema.optional(),
    currentAddress: AddressSchema.optional(),
    // Richer groups (optional at registration).
    military: MilitaryServiceSchema.optional(),
    education: EducationSchema.optional(),
    experience: z.array(ExperienceEntrySchema).max(30).optional(),
    drivingLicenses: z.array(DrivingLicenseSchema).max(10).optional(),
    certifications: z.array(z.string().max(200)).max(50).optional(),
    references: z.array(ReferenceSchema).max(20).optional(),
    externalRef: z
      .object({ platform: z.string().max(100), externalId: z.string().max(200) })
      .strict()
      .optional(),
    /**
     * Optional idempotency key so a retried intake (e.g. a re-submitted integration
     * payload) never creates a duplicate applicant.
     */
    intakeKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RegisterApplicant = z.infer<typeof RegisterApplicantSchema>;

/** Edits after registration; identity-derived fields are never client-set here. */
export const UpdateApplicantSchema = z
  .object({
    fullNameAr: z.string().min(2).max(200).optional(),
    fullNameEn: z.string().max(200).optional(),
    contact: ContactInputSchema.partial().optional(),
    officialAddress: AddressSchema.optional(),
    currentAddress: AddressSchema.optional(),
    expectedSalary: ExpectedSalarySchema.optional(),
    earliestStartDate: z.coerce.date().optional(),
    willingToRelocate: z.boolean().optional(),
    willingToTravel: z.boolean().optional(),
    willingToShiftWork: z.boolean().optional(),
    military: MilitaryServiceSchema.optional(),
    education: EducationSchema.optional(),
    experience: z.array(ExperienceEntrySchema).max(30).optional(),
    drivingLicenses: z.array(DrivingLicenseSchema).max(10).optional(),
    certifications: z.array(z.string().max(200)).max(50).optional(),
    references: z.array(ReferenceSchema).max(20).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplicant = z.infer<typeof UpdateApplicantSchema>;

/**
 * Confirm the identity block (§2.1 rule 4). Supplying/replacing the National ID here is
 * the ID-gate path for an applicant who registered ID-less; the number is re-validated
 * and derived fields recomputed server-side. Confirmation flips identity to `verified`.
 */
export const ConfirmApplicantIdentitySchema = z
  .object({
    nationalId: NationalIdSchema.optional(),
    fullNameAr: z.string().min(2).max(200).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type ConfirmApplicantIdentity = z.infer<typeof ConfirmApplicantIdentitySchema>;

export const WithdrawApplicantSchema = z
  .object({ reason: z.string().min(1).max(500), version: z.number().int().min(0) })
  .strict();
export type WithdrawApplicant = z.infer<typeof WithdrawApplicantSchema>;

/**
 * Restore a withdrawn applicant back into the active pipeline (status → `new`). All prior
 * history — screening, interviews, offers, audit, timeline — is preserved (nothing is deleted);
 * the applicant simply becomes live again from wherever they were. Version-checked + audited.
 */
export const RestoreApplicantSchema = z
  .object({ reason: z.string().max(500).optional(), version: z.number().int().min(0) })
  .strict();
export type RestoreApplicant = z.infer<typeof RestoreApplicantSchema>;

// ── Attachments (via the platform Files service, §2.2) ──────────────────────

export const AddApplicantAttachmentSchema = z
  .object({
    title: z.string().min(1).max(200),
    categoryId: objectId(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type AddApplicantAttachment = z.infer<typeof AddApplicantAttachmentSchema>;

// ── OCR assist (National ID) — the extraction seam (§6, OQ-30 abstraction) ──

export const OcrExtractNationalIdSchema = z
  .object({
    frontFileId: objectId().optional(),
    backFileId: objectId().optional(),
  })
  .strict()
  .refine((v) => v.frontFileId !== undefined || v.backFileId !== undefined, {
    message: 'at least one of frontFileId / backFileId is required',
  });
export type OcrExtractNationalId = z.infer<typeof OcrExtractNationalIdSchema>;

export interface OcrFieldDto {
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Result of an OCR attempt over the National-ID card (front + back read together). Every
 * field carries a confidence band; NOTHING is trusted — the user reviews and edits every
 * value before it is saved (§2.1 rule 4). Fields that can be computed from the number
 * (birth date, gender, governorate) are NOT OCR'd — they are `derived` deterministically.
 */
export interface OcrExtractionDto {
  available: boolean; // false when no real provider is wired (OQ-30 null stub)
  nationalId: OcrFieldDto | null;
  fullNameAr: OcrFieldDto | null;
  /** Suggested English name (transliteration of the Arabic name); freely editable. */
  fullNameEn: OcrFieldDto | null;
  /** Full official address as one string (front); the review step splits/edits it. */
  address: OcrFieldDto | null;
  /** City / administrative area, when the card exposes it separately from the address. */
  city: OcrFieldDto | null;
  /** Marital status read from the back (raw text; the review step maps it to the enum). */
  maritalStatus: OcrFieldDto | null;
  /** Religion read from the back (raw text). */
  religion: OcrFieldDto | null;
  /** National-ID card expiry date (ISO), read from the front. */
  nationalIdExpiry: OcrFieldDto | null;
  /** Deterministically derived from the number when present (birth date, gender, governorate). */
  derived: { birthDate: string; gender: Gender; governorate: string } | null;
}

// ── List / search / export ──────────────────────────────────────────────────

export const ListApplicantsQuerySchema = PaginationQuerySchema.extend({
  status: ApplicantStatusSchema.optional(),
  sourceId: objectId().optional(),
  intakeChannel: ApplicantIntakeChannelSchema.optional(),
  jobRequisitionId: objectId().optional(),
  branchId: objectId().optional(),
  identityVerification: IdentityVerificationSchema.optional(),
  duplicateOnly: z.coerce.boolean().optional(),
  hasAttachments: z.coerce.boolean().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  /** Free-text: Arabic-normalized name / applicant code / national ID / phone (partial). */
  search: z.string().max(200).optional(),
}).strict();
export type ListApplicantsQuery = z.infer<typeof ListApplicantsQuerySchema>;

/** Export reuses the list filter; `search` and paging are ignored (whole filtered set). */
export const ExportApplicantsQuerySchema = ListApplicantsQuerySchema.omit({
  page: true,
  pageSize: true,
}).strict();
export type ExportApplicantsQuery = z.infer<typeof ExportApplicantsQuerySchema>;

// ── Bulk (generic, per-row-audited executor — §9, OQ-27 minimal) ────────────

export const BULK_APPLICANT_ACTIONS = ['withdraw'] as const;
export const BulkApplicantActionSchema = z.enum(BULK_APPLICANT_ACTIONS);
export type BulkApplicantAction = z.infer<typeof BulkApplicantActionSchema>;

export const BulkApplicantsSchema = z
  .object({
    action: BulkApplicantActionSchema,
    ids: z.array(objectId()).min(1).max(200),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type BulkApplicants = z.infer<typeof BulkApplicantsSchema>;

export interface BulkApplicantsResultDto {
  requested: number;
  succeeded: number;
  failed: number;
  results: { id: string; ok: boolean; error?: string }[];
}

// ── Applicant DTO ───────────────────────────────────────────────────────────

export interface ApplicantChannelContact {
  primaryPhone: string;
  secondaryPhone: string | null;
  email: string | null;
  preferredContactChannel: ContactChannel | null;
}

export interface ApplicantDto {
  id: string;
  code: string;
  status: ApplicantStatus;
  /** null for a direct intake with no linked Job Request (the link may be added later). */
  jobRequisitionId: string | null;
  branchId: string | null;
  sourceId: string;
  sourceDetail: {
    referrerUserId?: string;
    agencyName?: string;
    externalPlatform?: string;
    externalId?: string;
    note?: string;
  } | null;
  intakeChannel: ApplicantIntakeChannel;
  identityVerification: IdentityVerification;
  // Identity
  fullNameAr: string;
  fullNameEn: string | null;
  nationalIdMasked: string | null; // masked by default (Security Architecture §3)
  birthDate: string | null;
  gender: Gender | null;
  nationality: string;
  placeOfBirth: string | null;
  photoFileId: string | null;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  /** National-ID card expiry (ISO), when captured. Not derived from the number. */
  nationalIdExpiry: string | null;
  dependentsCount: number | null;
  // Contact / address
  contact: ApplicantChannelContact;
  officialAddress: Address | null;
  currentAddress: Address | null;
  // Richer groups
  military: { status: MilitaryStatus; certificateRef?: string; completedAt?: string } | null;
  education: {
    level: EducationLevel;
    institution?: string;
    specialization?: string;
    graduationYear?: number;
    grade?: string;
  } | null;
  experience: {
    employer: string;
    position?: string;
    from?: string;
    to?: string;
    leavingReason?: string;
  }[];
  drivingLicenses: { class: string; expiry?: string }[];
  certifications: string[];
  references: { name: string; relationship?: string; phone?: string }[];
  expectedSalary: { amount: number; currency: string } | null;
  earliestStartDate: string | null;
  willingToRelocate: boolean;
  willingToTravel: boolean;
  willingToShiftWork: boolean;
  externalRef: { platform: string; externalId: string } | null;
  // Duplicate detection (§2.1 rule 5)
  duplicateFlag: boolean;
  duplicateOf: string[];
  attachmentCount: number;
  withdrawnReason: string | null;
  /** Optimistic-concurrency token (__v) — echo back in update/verify/withdraw. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events emitted by the module (ADR-008 naming `<module>.<entity>.<event>`) ─

export const HrEvents = {
  ApplicantCreated: 'hr.applicant.created',
  ApplicantUpdated: 'hr.applicant.updated',
  ApplicantIdentityVerified: 'hr.applicant.identityVerified',
  ApplicantWithdrawn: 'hr.applicant.withdrawn',
  /** Terminal transition driven by an Initial-Screening rejection (Stage 2). */
  ApplicantRejected: 'hr.applicant.rejected',
  /** A withdrawn applicant is returned to the active pipeline (status → `new`). */
  ApplicantRestored: 'hr.applicant.restored',
} as const;
export type HrEventName = (typeof HrEvents)[keyof typeof HrEvents];

export const ApplicantEventPayloadV1 = z.object({
  applicantId: objectId(),
  code: z.string(),
  jobRequisitionId: objectId().optional(),
  sourceId: objectId(),
});

export const ApplicantWithdrawnPayloadV1 = z.object({
  applicantId: objectId(),
  code: z.string(),
  reason: z.string(),
});

/**
 * The applicant's terminal rejection can originate in Initial Screening (Stage 2), an interview
 * round (Stage 3), or an evaluation phase (Security/Medical/Driving); the originating aggregate id
 * is carried in whichever field applies. All are optional so the event stays source-agnostic as
 * the pipeline grows.
 */
export const ApplicantRejectedPayloadV1 = z.object({
  applicantId: objectId(),
  code: z.string(),
  reason: z.string(),
  screeningId: objectId().optional(),
  interviewId: objectId().optional(),
  evaluationId: objectId().optional(),
});
