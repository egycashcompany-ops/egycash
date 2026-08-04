// HR / Recruitment — the intake FORM: what a candidate is asked, and the per-source links that
// carry them to it.
//
// Two kinds of field, deliberately:
//
//  • BUILT-IN fields map onto real applicant columns (`fullNameAr`, `primaryPhone`, …). They are
//    validated by the SAME rules the internal form and the API already use — a public submission
//    is an applicant registration, not a parallel intake path with its own idea of a valid phone.
//  • CUSTOM fields are whatever else this employer wants to ask. They have no column, so their
//    answers are stored on the applicant as labelled question/answer pairs.
//
// The form is a SINGLETON. "One application form, many links" is what was asked for: the fields
// are the same wherever a candidate arrives from, and the link is what records where that was.
import { z } from 'zod';
import { LocalizedStringSchema, objectId, type LocalizedString } from '../common/index.js';

// ── Built-in fields ─────────────────────────────────────────────────────────

/**
 * The applicant columns a form may ask for. Adding a key here is the ONLY way to add a built-in
 * field, which keeps the mapping from answer to column exhaustive and checkable.
 */
export const RECRUITMENT_FORM_BUILTINS = [
  'fullNameAr',
  'fullNameEn',
  'nationalId',
  'primaryPhone',
  'secondaryPhone',
  'email',
  'educationLevel',
  'educationSpecialization',
  'governorate',
  'city',
  'addressLine1',
  'maritalStatus',
  'militaryStatus',
  'expectedSalary',
  'willingToRelocate',
] as const;
export type RecruitmentFormBuiltin = (typeof RECRUITMENT_FORM_BUILTINS)[number];

/**
 * Two fields cannot be switched off or made optional: an applicant with no name and no phone is
 * not a record anybody can act on, and the API rejects it anyway. Encoding it here means the
 * builder can grey them out instead of letting an admin produce a form that always fails.
 */
export const RECRUITMENT_FORM_MANDATORY: readonly RecruitmentFormBuiltin[] = [
  'fullNameAr',
  'primaryPhone',
];

/** The four the frozen request names, in order — what a fresh install starts with. */
export const RECRUITMENT_FORM_DEFAULTS: readonly RecruitmentFormBuiltin[] = [
  'fullNameAr',
  'nationalId',
  'primaryPhone',
  'educationLevel',
];

// ── Custom fields ───────────────────────────────────────────────────────────

export const RECRUITMENT_FORM_INPUT_KINDS = ['text', 'longText', 'number', 'date', 'select', 'checkbox'] as const;
export type RecruitmentFormInputKind = (typeof RECRUITMENT_FORM_INPUT_KINDS)[number];

const CustomFieldSchema = z
  .object({
    type: z.literal('custom'),
    /** Stable across renames — an answer already collected keeps pointing at its question. */
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{1,39}$/),
    kind: z.enum(RECRUITMENT_FORM_INPUT_KINDS),
    label: LocalizedStringSchema,
    required: z.boolean().default(false),
    /** `select` only; ignored otherwise. */
    options: z.array(LocalizedStringSchema).max(50).default([]),
  })
  .strict();

const BuiltinFieldSchema = z
  .object({
    type: z.literal('builtin'),
    key: z.enum(RECRUITMENT_FORM_BUILTINS),
    required: z.boolean().default(false),
  })
  .strict();

export const RecruitmentFormFieldSchema = z.discriminatedUnion('type', [
  BuiltinFieldSchema,
  CustomFieldSchema,
]);
export type RecruitmentFormField = z.infer<typeof RecruitmentFormFieldSchema>;

/**
 * What a CUSTOM question accepts, decided by its kind. Built-in questions are judged by the
 * applicant rules (`field-rules`, `value-objects`) — this covers only the ones the admin invented,
 * which have no column and therefore no rule of their own until now.
 *
 * Shared, so the browser marks the field and the server refuses the value using one definition.
 * Returns an i18n KEY, never a sentence.
 */
export const checkCustomAnswer = (
  field: Extract<RecruitmentFormField, { type: 'custom' }>,
  raw: string | boolean | undefined,
): string | undefined => {
  if (field.kind === 'checkbox') return undefined; // a tick is either there or it is not
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return undefined; // emptiness is the caller's business, not the kind's
  switch (field.kind) {
    case 'number':
      return Number.isFinite(Number(value)) ? undefined : 'applicants.validation.number';
    case 'date':
      // ISO date only: what a date input posts, and what the record must keep.
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? undefined
        : 'applicants.validation.date';
    case 'select':
      // A choice must be one of the offered choices — a crafted payload cannot invent one.
      return field.options.some((o) => o.ar === value || o.en === value)
        ? undefined
        : 'applicants.validation.choice';
    default:
      return undefined;
  }
};

// ── The form ────────────────────────────────────────────────────────────────

export interface RecruitmentFormLinkDto {
  sourceId: string;
  sourceName: LocalizedString;
  /** Absent until a link is generated for that source. */
  token: string | null;
  /** Ready to paste — the public application URL for this source. */
  url: string | null;
  active: boolean;
  generatedAt: string | null;
  /** How many applicants have arrived through this link. */
  submissions: number;
}

export interface RecruitmentFormDto {
  id: string;
  title: LocalizedString;
  /** Shown above the fields on the public page; blank hides it. */
  intro: LocalizedString | null;
  fields: RecruitmentFormField[];
  /**
   * The source recorded when a recruiter registers someone from inside the app. The internal form
   * no longer asks — a walk-in is not a "channel" a recruiter should have to re-pick every time.
   */
  internalSourceId: string | null;
  links: RecruitmentFormLinkDto[];
  version: number;
}

/** The public view: no ids, no links, nothing about the other sources. */
export interface PublicRecruitmentFormDto {
  title: LocalizedString;
  intro: LocalizedString | null;
  sourceName: LocalizedString;
  fields: RecruitmentFormField[];
}

// A field list is ordered — the array IS the order, so reordering is a plain save rather than a
// separate endpoint with its own failure modes.
export const UpdateRecruitmentFormSchema = z
  .object({
    title: LocalizedStringSchema.optional(),
    intro: LocalizedStringSchema.nullable().optional(),
    fields: z
      .array(RecruitmentFormFieldSchema)
      .max(60)
      .superRefine((fields, ctx) => {
        const keys = fields.map((f) => f.key);
        if (new Set(keys).size !== keys.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate field key' });
        }
        for (const key of RECRUITMENT_FORM_MANDATORY) {
          const found = fields.find((f) => f.type === 'builtin' && f.key === key);
          if (found === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${key}" cannot be removed` });
          } else if (!found.required) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${key}" must stay required` });
          }
        }
        for (const f of fields) {
          if (f.type === 'custom' && f.kind === 'select' && f.options.length === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${f.key}" needs options` });
          }
        }
      })
      .optional(),
    internalSourceId: objectId().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateRecruitmentForm = z.infer<typeof UpdateRecruitmentFormSchema>;

export const GenerateRecruitmentFormLinkSchema = z.object({ sourceId: objectId() }).strict();
export type GenerateRecruitmentFormLink = z.infer<typeof GenerateRecruitmentFormLinkSchema>;

// ── Public submission ───────────────────────────────────────────────────────

/**
 * Answers arrive keyed by field. Values are strings (or a boolean for a checkbox) because that is
 * what a form posts; the server maps a built-in answer onto its applicant column and lets the
 * EXISTING registration schema judge it. Nothing here re-implements a phone or a National ID.
 */
export const SubmitRecruitmentFormSchema = z
  .object({
    answers: z.record(z.string(), z.union([z.string().max(2000), z.boolean()])),
  })
  .strict();
export type SubmitRecruitmentForm = z.infer<typeof SubmitRecruitmentFormSchema>;

/** What a candidate is told back. Deliberately thin — a public caller learns their code, no more. */
export interface RecruitmentFormSubmissionDto {
  code: string;
}

export const RecruitmentFormTokenParamSchema = z
  .object({ token: z.string().min(16).max(64) })
  .strict();

/**
 * The form EXACTLY as it was published when a candidate filled it in.
 *
 * Editing the form later must not rewrite history: a question removed next month was still asked
 * of the people who answered it, and a question that was optional then must not read as "left
 * blank" when it becomes required. The snapshot is what makes an old application readable on its
 * own terms rather than through today's form.
 */
export const RecruitmentFormSnapshotSchema = z
  .object({
    title: LocalizedStringSchema,
    /** The form's version at submission time — which revision of the questions this was. */
    formVersion: z.number().int().min(0),
    fields: z.array(RecruitmentFormFieldSchema).max(60),
    submittedAt: z.coerce.date(),
  })
  .strict();
export type RecruitmentFormSnapshotDto = z.infer<typeof RecruitmentFormSnapshotSchema>;

/**
 * An answer to a custom question. The LABEL travels with the answer: a question renamed — or
 * removed — next month must not turn last month's answers into anonymous strings.
 */
export const ApplicantFormAnswerSchema = z
  .object({
    key: z.string().min(1).max(40),
    label: LocalizedStringSchema,
    value: z.string().max(2000),
  })
  .strict();
export type ApplicantFormAnswerDto = z.infer<typeof ApplicantFormAnswerSchema>;
