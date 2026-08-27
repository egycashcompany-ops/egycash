// بوّابة المتقدّمين — المستندات (P-HR-APP §5، القرارات D-APP-4 … D-APP-10).
//
// What a candidate must hand in after they clear screening, what they hand in, and what HR makes of
// it. Three things live here and it is worth saying why each is shaped the way it is.
//
// THE CATALOGUE IS DATA (D-APP-4). Four documents for everyone and a fifth for drivers is today's
// answer, not a permanent one — an employment rule changes far more often than this codebase
// deploys. So the required set is rows in a collection, seeded at boot, and adding a sixth document
// next year is an administrator's afternoon rather than a release.
//
// WHO NEEDS THE LICENCE IS ANSWERED BY THE SEAT, NOT THE PERSON (D-APP-5). `applicability` echoes
// the word the evaluation phases already use for exactly this question, and it is read off the job
// title's `requiresDrivingTest` — the same flag, asked the same way. Keying it on whether the
// candidate happened to type a licence into their form would ask the wrong record: somebody
// applying to drive who has not filled that in is still applying to drive.
//
// A REVIEW IS A DECISION ABOUT A SLOT, NOT ABOUT THE SET. Two different parties write here — the
// candidate uploads, HR reviews — so the concurrency guard is per document and not an aggregate
// version. That is not a shortcut around optimistic concurrency: an aggregate version would make
// every review collide with every upload, and the condition that actually matters ("this slot is
// still pending") is stronger stated against the slot itself.
import { z } from 'zod';
import {
  objectId,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type LocalizedString,
} from '../common/index.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

/**
 * Who a document type is asked of.
 *
 * The same two words `EVALUATION_APPLICABILITIES` uses, deliberately: both catalogues ask one
 * question of one flag, and two names for it would invite them to drift apart. Not imported from
 * there — a document catalogue that depends on an evaluation type is coupled for no reason.
 */
export const APPLICANT_DOCUMENT_APPLICABILITIES = ['all', 'driversOnly'] as const;
export const ApplicantDocumentApplicabilitySchema = z.enum(APPLICANT_DOCUMENT_APPLICABILITIES);
export type ApplicantDocumentApplicability = z.infer<typeof ApplicantDocumentApplicabilitySchema>;

/**
 * Where a handed-in document stands.
 *
 * `pending` until somebody in HR looks at it; then one of the other two, and neither is a dead end
 * for the same reason. See `mayReplace` in the rules: accepted locks, rejected reopens.
 */
export const APPLICANT_DOCUMENT_REVIEW_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export const ApplicantDocumentReviewStatusSchema = z.enum(APPLICANT_DOCUMENT_REVIEW_STATUSES);
export type ApplicantDocumentReviewStatus = z.infer<typeof ApplicantDocumentReviewStatusSchema>;

/**
 * D-APP-6 — «أولى/ثانية فقط» is ENFORCED, not advised.
 *
 * A professional licence is first or second class; a private licence and a third-class licence are
 * not professional at all. Making this a closed enum rather than validation prose means the third
 * option cannot be typed into the field — the candidate picks from two, and a screen that offered a
 * third would fail to compile.
 */
export const PROFESSIONAL_DRIVING_LICENSE_CLASSES = ['first', 'second'] as const;
export const ProfessionalDrivingLicenseClassSchema = z.enum(PROFESSIONAL_DRIVING_LICENSE_CLASSES);
export type ProfessionalDrivingLicenseClass = z.infer<
  typeof ProfessionalDrivingLicenseClassSchema
>;

// ── The catalogue (D-APP-4) ─────────────────────────────────────────────────

export const CreateApplicantDocumentTypeSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    applicability: ApplicantDocumentApplicabilitySchema.default('all'),
    /** A type nobody is obliged to hand in still has a slot; it just never blocks completeness. */
    required: z.boolean().default(true),
    /**
     * Does handing this in also mean stating a professional licence class?
     *
     * On the TYPE rather than hard-coded against one key, so the day a second document needs a
     * class the answer is a row, not a branch.
     */
    licenseClassRequired: z.boolean().default(false),
    order: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type CreateApplicantDocumentType = z.infer<typeof CreateApplicantDocumentTypeSchema>;

export const UpdateApplicantDocumentTypeSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    applicability: ApplicantDocumentApplicabilitySchema.optional(),
    required: z.boolean().optional(),
    licenseClassRequired: z.boolean().optional(),
    order: z.number().int().min(0).max(999).optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateApplicantDocumentType = z.infer<typeof UpdateApplicantDocumentTypeSchema>;

export const ListApplicantDocumentTypesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
}).strict();
export type ListApplicantDocumentTypesQuery = z.infer<
  typeof ListApplicantDocumentTypesQuerySchema
>;

export interface ApplicantDocumentTypeDto {
  id: string;
  key: string;
  name: LocalizedString;
  applicability: ApplicantDocumentApplicability;
  required: boolean;
  licenseClassRequired: boolean;
  order: number;
  active: boolean;
  version: number;
}

// ── Handing one in, and replacing it ────────────────────────────────────────

/**
 * Upload into one slot (multipart file + these fields, which arrive as strings).
 *
 * There is no aggregate `version` here on purpose — see the header. The slot's own state is the
 * condition, and it is checked in the same write that changes it.
 */
export const UploadApplicantDocumentSchema = z
  .object({
    typeId: objectId(),
    /** Required exactly when the type says so, and refused when it does not (D-APP-6). */
    licenseClass: ProfessionalDrivingLicenseClassSchema.optional(),
  })
  .strict();
export type UploadApplicantDocument = z.infer<typeof UploadApplicantDocumentSchema>;

/** HR's decision on one handed-in document. */
export const ReviewApplicantDocumentSchema = z
  .object({
    outcome: z.enum(['accepted', 'rejected']),
    /**
     * Why, and it is not optional for a refusal.
     *
     * A rejected slot reopens for the candidate to try again (D-APP-7ج), and «ارفع واحدة تانية»
     * with no reason attached is a request nobody can act on. Accepting needs no words.
     */
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'rejected' && (value.note ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'a rejection must say why — the candidate is being asked to hand in another',
      });
    }
  });
export type ReviewApplicantDocument = z.infer<typeof ReviewApplicantDocumentSchema>;

export const ListApplicantDocumentSetsQuerySchema = PaginationQuerySchema.extend({
  /** The queue HR actually works: sets with at least one document still waiting on somebody. */
  pendingOnly: z.coerce.boolean().optional(),
  applicantId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListApplicantDocumentSetsQuery = z.infer<typeof ListApplicantDocumentSetsQuerySchema>;

// ── DTOs ────────────────────────────────────────────────────────────────────

/**
 * One slot as the candidate and HR both see it — with one difference that is the point of the
 * `reviewNote` field being here at all: it is what HR wrote when refusing, and the candidate is
 * shown it, because they are the one being asked to fix it.
 */
export interface ApplicantDocumentDto {
  typeId: string;
  typeKey: string;
  typeName: LocalizedString;
  required: boolean;
  status: ApplicantDocumentReviewStatus;
  fileId: string;
  fileName: string;
  fileVersion: number;
  licenseClass: ProfessionalDrivingLicenseClass | null;
  uploadedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Whether THIS candidate may still replace it — computed, never stored (D-APP-7/7ج). */
  mayReplace: boolean;
}

/** A slot the catalogue asks of this candidate and which they have not filled yet. */
export interface ApplicantDocumentSlotDto {
  typeId: string;
  typeKey: string;
  typeName: LocalizedString;
  required: boolean;
  licenseClassRequired: boolean;
  order: number;
}

export interface ApplicantDocumentSetDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  documents: ApplicantDocumentDto[];
  /** Asked of this candidate and still empty — the catalogue minus what they have handed in. */
  missing: ApplicantDocumentSlotDto[];
  /** Nothing required is missing and nothing is refused. The candidate's side is done. */
  complete: boolean;
  /** How many handed-in documents are still waiting on HR. */
  pendingReview: number;
  createdAt: string;
  updatedAt: string;
}

// ── Where the candidate stands (D-APP-8) ───────────────────────────────────

/**
 * The pipeline as the CANDIDATE is allowed to see it.
 *
 * The internal timeline carries thirty-three event types, among them security-check outcomes,
 * evaluation scores and recruiters' notes. None of that is theirs to read. What they get is a
 * six-step map with one terminal refusal — enough to answer «where has my application got to»
 * and not enough to answer anything else.
 *
 * These six are NOT invented for the portal: they are `RECRUITMENT_STAGE_KINDS` under names a
 * candidate would use. Keeping the shapes aligned means a seventh internal stage cannot quietly
 * appear with nowhere to map, because the mapper must then name where it belongs.
 */
export const APPLICANT_PORTAL_STEPS = [
  'applied',
  'screeningPassed',
  'interview',
  'assessment',
  'jobOffer',
  'hired',
  'rejected',
] as const;
export const ApplicantPortalStepSchema = z.enum(APPLICANT_PORTAL_STEPS);
export type ApplicantPortalStep = z.infer<typeof ApplicantPortalStepSchema>;

/**
 * What the candidate's own screen reads.
 *
 * Deliberately small. There is no score, no reason, no decider, and no date beyond the one they
 * already know — every one of those was a decision somebody made ABOUT them rather than a fact
 * they are owed, and a portal is not the place a person learns them.
 */
export interface ApplicantPortalStatusDto {
  applicantCode: string;
  fullNameAr: string;
  /** Where they stand, and the only stage word they ever see. */
  step: ApplicantPortalStep;
  /** True once the pipeline is over for them, either way — nothing more is coming. */
  terminal: boolean;
  /**
   * The seat they applied to, as the denormalized label the recruiter screens already show. Null
   * when nobody has placed them yet — which is a normal state, not an error to render.
   */
  position: string | null;
  appliedAt: string;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const HrApplicantDocumentEvents = {
  Uploaded: 'hr.applicantDocument.uploaded',
  Replaced: 'hr.applicantDocument.replaced',
  Reviewed: 'hr.applicantDocument.reviewed',
  SetCompleted: 'hr.applicantDocument.setCompleted',
} as const;
export type HrApplicantDocumentEventName =
  (typeof HrApplicantDocumentEvents)[keyof typeof HrApplicantDocumentEvents];

export const ApplicantDocumentEventPayloadV1 = z.object({
  applicantId: objectId(),
  applicantCode: z.string(),
  typeKey: z.string(),
});

// ── File category (seeded at boot by the HR module) ─────────────────────────

/**
 * Where a candidate's own uploads live (D-APP-10).
 *
 * Images AND PDF, unlike the hiring-documents category which is PDF-only: what is being asked for
 * here is a photograph of a certificate taken on a phone, and refusing that would mean asking
 * people without a scanner to find one.
 */
export const APPLICANT_DOCUMENT_FILE_CATEGORY = 'hr-applicant-portal-documents';
