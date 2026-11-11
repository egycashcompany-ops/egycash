// Contracts module contracts (FROZEN design docs/12-planning/contracts-module-design.md,
// Revision 2). First-class HR module: admin-owned versioned templates with a publishing
// gate (A17), server-side rendering, ASYNC generation (A13) producing an immutable
// snapshot + variable provenance (A3) + integrity metadata (A14), signed/archived
// immutability (A4), Workflow-compatible approval (A7) and an e-signature-ready signer
// model (A5). Consumers integrate through the module's query seam + events only (A22).
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';
import { LocalizedStringSchema } from '../common/localized.js';

// ── Contract types catalog (D4a) ─────────────────────────────────────────────

export const CreateContractTypeSchema = z
  .object({
    name: LocalizedStringSchema,
    /** Fixed-term contracts carry an end date; open-ended ones may omit it. */
    allowsEndDate: z.boolean().default(true),
    /** Q3 default: ONE active contract per employee per type; catalog-level override. */
    multipleActiveAllowed: z.boolean().default(false),
  })
  .strict();
export type CreateContractType = z.infer<typeof CreateContractTypeSchema>;

export const UpdateContractTypeSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    allowsEndDate: z.boolean().optional(),
    multipleActiveAllowed: z.boolean().optional(),
    status: z.enum(['active', 'archived']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateContractType = z.infer<typeof UpdateContractTypeSchema>;

export interface ContractTypeDto {
  id: string;
  name: { ar: string; en: string };
  allowsEndDate: boolean;
  multipleActiveAllowed: boolean;
  status: 'active' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Templates (D4/D7, A17/A19) ───────────────────────────────────────────────

export const CONTRACT_TEMPLATE_LANGUAGES = ['ar', 'en'] as const;
export const ContractTemplateLanguageSchema = z.enum(CONTRACT_TEMPLATE_LANGUAGES);
export type ContractTemplateLanguage = z.infer<typeof ContractTemplateLanguageSchema>;

/**
 * What a template prints (A27, «مستندات التعيين»): the employment CONTRACT itself — numbered,
 * generated, frozen — or a hiring FORM printed beside it (a declaration, the data sheet, the job
 * description card, the bank letter). A form is rendered fresh each time it is printed and is
 * never a contract: it has no type, no number and no snapshot.
 */
export const CONTRACT_TEMPLATE_KINDS = ['contract', 'form'] as const;
export const ContractTemplateKindSchema = z.enum(CONTRACT_TEMPLATE_KINDS);
export type ContractTemplateKind = z.infer<typeof ContractTemplateKindSchema>;

/**
 * Which jobs a template is printed for (A27). `allJobs` is its own flag rather than "an empty
 * list means everybody", so a job card whose job has not been chosen yet prints for NOBODY
 * instead of for the whole company.
 */
const templatePrintFields = {
  kind: ContractTemplateKindSchema,
  allJobs: z.boolean(),
  jobTitleIds: z.array(objectId()).max(300),
  /** Where it falls in the printed set — smaller first. */
  printOrder: z.number().int().min(0).max(999),
};

/** A version's lifecycle (A17): only `published` versions can generate contracts. */
export const CONTRACT_TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const;
export const ContractTemplateStatusSchema = z.enum(CONTRACT_TEMPLATE_STATUSES);
export type ContractTemplateStatus = z.infer<typeof ContractTemplateStatusSchema>;

/** One labeled signature block (D4); labels are in the template's language. */
export const SignatureBlockSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9-]+$/),
    label: z.string().min(1).max(120),
    name: z.string().max(120).optional(),
    title: z.string().max(120).optional(),
  })
  .strict();
export type SignatureBlock = z.infer<typeof SignatureBlockSchema>;

/** Structured sections (D4) — sanitized rich HTML; placeholders as {{key}} text. */
export const TemplateSectionsSchema = z
  .object({
    header: z.string().max(20_000).default(''),
    body: z.string().min(1).max(200_000),
    footer: z.string().max(20_000).default(''),
  })
  .strict();
export type TemplateSections = z.infer<typeof TemplateSectionsSchema>;

// ── Draft-permissive template writes ─────────────────────────────────────────
// Create/update can only ever produce a DRAFT (editing a published version forks
// the next draft — A17/A19), and a draft is allowed to be incomplete while it is
// being authored: names, contract type, body and signature labels may all be
// empty here. `publish` is the single completeness gate.

/** Template names while drafting — either language may still be blank. */
const DraftTemplateNameSchema = z
  .object({ ar: z.string().max(200).default(''), en: z.string().max(200).default('') })
  .strict();

/** Sections while drafting — even the body may still be empty. */
export const DraftTemplateSectionsSchema = z
  .object({
    header: z.string().max(20_000).default(''),
    body: z.string().max(200_000).default(''),
    footer: z.string().max(20_000).default(''),
  })
  .strict();

/** Signature blocks while drafting — a just-added row has no label yet. */
export const DraftSignatureBlockSchema = SignatureBlockSchema.extend({
  label: z.string().max(120).default(''),
});

export const CreateContractTemplateSchema = z
  .object({
    name: DraftTemplateNameSchema,
    language: ContractTemplateLanguageSchema,
    contractTypeId: objectId().nullable().default(null),
    sections: DraftTemplateSectionsSchema,
    logoFileId: objectId().nullable().default(null),
    signatures: z.array(DraftSignatureBlockSchema).max(10).default([]),
    kind: templatePrintFields.kind.default('contract'),
    allJobs: templatePrintFields.allJobs.default(true),
    jobTitleIds: templatePrintFields.jobTitleIds.default([]),
    printOrder: templatePrintFields.printOrder.default(100),
  })
  .strict();
export type CreateContractTemplate = z.infer<typeof CreateContractTemplateSchema>;

/** Editing a PUBLISHED version forks the next draft version instead (A17/A19). */
export const UpdateContractTemplateSchema = z
  .object({
    name: DraftTemplateNameSchema.optional(),
    contractTypeId: objectId().nullable().optional(),
    sections: DraftTemplateSectionsSchema.optional(),
    logoFileId: objectId().nullable().optional(),
    signatures: z.array(DraftSignatureBlockSchema).max(10).optional(),
    kind: templatePrintFields.kind.optional(),
    allJobs: templatePrintFields.allJobs.optional(),
    jobTitleIds: templatePrintFields.jobTitleIds.optional(),
    printOrder: templatePrintFields.printOrder.optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateContractTemplate = z.infer<typeof UpdateContractTemplateSchema>;

// Clone spawns a new DRAFT — its name may be blanked out like any other draft field.
export const CloneContractTemplateSchema = z
  .object({
    name: DraftTemplateNameSchema.optional(),
    language: ContractTemplateLanguageSchema.optional(),
  })
  .strict();
export type CloneContractTemplate = z.infer<typeof CloneContractTemplateSchema>;

export const ListContractTemplatesQuerySchema = PaginationQuerySchema.extend({
  language: ContractTemplateLanguageSchema.optional(),
  contractTypeId: objectId().optional(),
  status: ContractTemplateStatusSchema.optional(),
  kind: ContractTemplateKindSchema.optional(),
  /** Latest version per template key only (the templates list view). */
  latestOnly: z.coerce.boolean().optional(),
}).strict();
export type ListContractTemplatesQuery = z.infer<typeof ListContractTemplatesQuerySchema>;

/** One template VERSION — the version chain is append-only and recoverable (A19). */
export interface ContractTemplateDto {
  id: string;
  /** Stable identity shared by all versions of one template. */
  key: string;
  name: { ar: string; en: string };
  language: ContractTemplateLanguage;
  /** Null while a draft is still being authored — publish requires a type. */
  contractTypeId: string | null;
  status: ContractTemplateStatus;
  /** Template version number (1..n per key). */
  templateVersion: number;
  sections: TemplateSections;
  logoFileId: string | null;
  signatures: SignatureBlock[];
  kind: ContractTemplateKind;
  allJobs: boolean;
  jobTitleIds: string[];
  printOrder: number;
  /** Placeholder keys used by the sections — derived server-side on save. */
  placeholders: string[];
  changedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency for in-place draft edits. */
  version: number;
  /** Key-level annotation on LIST responses only: the key's published version, if any
   *  (the create wizard pins it for both preview and generation). */
  publishedTemplateId?: string | null;
  publishedTemplateVersion?: number | null;
}

// ── Variable catalog + provenance (D5, A3/A16) ───────────────────────────────

export const CONTRACT_VARIABLE_SOURCES = [
  'employee',
  'employment',
  'organization',
  'contract',
  'company',
  'override',
] as const;
export const ContractVariableSourceSchema = z.enum(CONTRACT_VARIABLE_SOURCES);
export type ContractVariableSource = z.infer<typeof ContractVariableSourceSchema>;

/** One catalog entry — drives the editor's variable browser AND the resolver (D5). */
export interface ContractVariableDto {
  key: string;
  label: { ar: string; en: string };
  source: Exclude<ContractVariableSource, 'override'>;
  sample: string;
  /** Required variables block generation when unresolved (A16). */
  required: boolean;
}

/** A resolved value frozen at generation, with provenance (A3). */
export interface ContractVariableValueDto {
  key: string;
  value: string;
  source: ContractVariableSource;
  /** Set when source is `override`. */
  overriddenBy: string | null;
}

/** A16 — the structured validation report returned with CONTRACT_VARIABLES_MISSING. */
export interface ContractVariableIssueDto {
  placeholder: string;
  source: string;
  reason: string;
}

// ── Contract lifecycle (D2/D3, A4/A7/A13/A14) ────────────────────────────────

export const CONTRACT_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'active',
  'signed',
  'amended',
  'renewed',
  'terminated',
  'expired',
  'archived',
] as const;
export const ContractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const CONTRACT_GENERATION_STATUSES = [
  'idle',
  'queued',
  'rendering',
  'completed',
  'failed',
] as const;
export const ContractGenerationStatusSchema = z.enum(CONTRACT_GENERATION_STATUSES);
export type ContractGenerationStatus = z.infer<typeof ContractGenerationStatusSchema>;

/** A14 — persisted next to the PDF so verification never needs to open the file. */
export interface ContractIntegrityDto {
  sha256: string;
  generatedAt: string;
  generatorVersion: string;
  templateVersion: number;
  contractVersion: number;
}

export interface ContractGenerationDto {
  status: ContractGenerationStatus;
  error: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  integrity: ContractIntegrityDto | null;
  pdfFileId: string | null;
}

/** A5 — provider-agnostic signer record (manual in phase 1). */
export interface ContractSignerDto {
  key: string;
  label: string;
  status: 'pending' | 'signed' | 'declined';
  method: 'manual';
  signedAt: string | null;
  recordedBy: string | null;
  evidenceFileId: string | null;
  note: string | null;
}

/** A7 — workflow-shaped approval record (the Workflow Engine later swaps the driver). */
export interface ContractApprovalStepDto {
  step: number;
  decidedBy: string;
  decision: 'approved' | 'rejected';
  note: string | null;
  at: string;
}

export const CONTRACT_ATTACHMENT_CATEGORIES = [
  'nda',
  'annex',
  'signedCopy',
  'approval',
  'other',
] as const;
export const ContractAttachmentCategorySchema = z.enum(CONTRACT_ATTACHMENT_CATEGORIES);
export type ContractAttachmentCategory = z.infer<typeof ContractAttachmentCategorySchema>;

export interface ContractAttachmentDto {
  id: string;
  fileId: string;
  category: ContractAttachmentCategory;
  label: string;
  addedBy: string;
  addedAt: string;
}

// ── Write schemas ────────────────────────────────────────────────────────────

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * A3/A16 — one manual override. Sent as PAIRS (not a keyed record): catalog keys carry
 * dots (`employee.fullName`) and the platform's mongo-sanitize middleware strips dotted
 * keys from request bodies, so a Record<key, value> can never arrive intact.
 */
export const ContractOverrideSchema = z
  .object({ key: z.string().min(1).max(100), value: z.string().max(500) })
  .strict();
export type ContractOverride = z.infer<typeof ContractOverrideSchema>;
const overridesField = () => z.array(ContractOverrideSchema).max(50);

export const CreateContractSchema = z
  .object({
    employeeId: objectId(),
    typeId: objectId(),
    /** Any version id of the template key; generation pins the PUBLISHED version (A17). */
    templateId: objectId(),
    startDate: isoDate(),
    endDate: isoDate().nullable().default(null),
    referenceNumber: z.string().max(100).nullable().default(null),
    /** A3/A16 — per-variable manual values (the validation escape hatch). */
    overrides: overridesField().default([]),
  })
  .strict();
export type CreateContract = z.infer<typeof CreateContractSchema>;

export const UpdateContractDraftSchema = z
  .object({
    typeId: objectId().optional(),
    templateId: objectId().optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().nullable().optional(),
    referenceNumber: z.string().max(100).nullable().optional(),
    overrides: overridesField().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateContractDraft = z.infer<typeof UpdateContractDraftSchema>;

export const ContractVersionOnlySchema = z.object({ version: z.number().int().min(0) }).strict();
export type ContractVersionOnly = z.infer<typeof ContractVersionOnlySchema>;

export const DecideContractApprovalSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecideContractApproval = z.infer<typeof DecideContractApprovalSchema>;

export const SignContractBlockSchema = z
  .object({
    key: z.string().min(1).max(50),
    note: z.string().max(500).optional(),
    evidenceFileId: objectId().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type SignContractBlock = z.infer<typeof SignContractBlockSchema>;

/** Amend = new version of the SAME contract; Renew = new linked contract (D3/A4). */
export const AmendOrRenewContractSchema = z
  .object({
    templateId: objectId().optional(),
    startDate: isoDate(),
    endDate: isoDate().nullable().default(null),
    overrides: overridesField().default([]),
    version: z.number().int().min(0),
  })
  .strict();
export type AmendOrRenewContract = z.infer<typeof AmendOrRenewContractSchema>;

export const TerminateContractSchema = z
  .object({
    reason: z.string().min(1).max(1000),
    date: isoDate(),
    version: z.number().int().min(0),
  })
  .strict();
export type TerminateContract = z.infer<typeof TerminateContractSchema>;

export const AddContractAttachmentSchema = z
  .object({
    fileId: objectId(),
    category: ContractAttachmentCategorySchema,
    label: z.string().min(1).max(200),
  })
  .strict();
export type AddContractAttachment = z.infer<typeof AddContractAttachmentSchema>;

/** The template editor's UNSAVED form state — previewable without saving first.
 *  Sections may be empty here (unlike TemplateSectionsSchema): a half-written
 *  template must still preview; problems surface as issues, never as blocks. */
export const InlinePreviewTemplateSchema = z
  .object({
    language: ContractTemplateLanguageSchema,
    sections: z
      .object({
        header: z.string().max(20_000).default(''),
        body: z.string().max(200_000).default(''),
        footer: z.string().max(20_000).default(''),
      })
      .strict(),
    signatures: z.array(DraftSignatureBlockSchema).max(10).default([]),
    /** A27 — a form previews inside the company letterhead, as it prints. */
    kind: ContractTemplateKindSchema.default('contract'),
  })
  .strict();
export type InlinePreviewTemplate = z.infer<typeof InlinePreviewTemplateSchema>;

/** Preview (D6/A18): draft-shaped input rendered server-side; NEVER persisted.
 *  Without `employeeId` the render substitutes catalog SAMPLE values — the template
 *  editor's live preview (same renderer, so preview ≡ final holds there too).
 *  Source is EITHER a saved `templateId` OR the `inlineTemplate` form state. */
export const PreviewContractSchema = z
  .object({
    employeeId: objectId().optional(),
    templateId: objectId().optional(),
    inlineTemplate: InlinePreviewTemplateSchema.optional(),
    typeId: objectId().optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().nullable().optional(),
    overrides: overridesField().default([]),
  })
  .strict()
  .refine((v) => (v.templateId === undefined) !== (v.inlineTemplate === undefined), {
    message: 'provide exactly one of templateId or inlineTemplate',
  });
export type PreviewContract = z.infer<typeof PreviewContractSchema>;

export interface ContractPreviewDto {
  html: string;
  issues: ContractVariableIssueDto[];
}

// ── List / search (A12) ──────────────────────────────────────────────────────

export const ListContractsQuerySchema = PaginationQuerySchema.extend({
  /** Free text over contract number, employee name/code, reference number. */
  search: z.string().max(200).optional(),
  employeeId: objectId().optional(),
  typeId: objectId().optional(),
  status: ContractStatusSchema.optional(),
  startFrom: isoDate().optional(),
  startTo: isoDate().optional(),
  endFrom: isoDate().optional(),
  endTo: isoDate().optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
}).strict();
export type ListContractsQuery = z.infer<typeof ListContractsQuerySchema>;

// ── Contract DTO ─────────────────────────────────────────────────────────────

export interface ContractDto {
  id: string;
  code: string;
  referenceNumber: string | null;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  typeId: string;
  typeName: { ar: string; en: string };
  templateId: string;
  /** Pinned at generation (A2); null while the draft may still re-pick. */
  pinnedTemplateVersion: number | null;
  templateLanguage: ContractTemplateLanguage;
  status: ContractStatus;
  /** Business version in the amendment chain (list "Version" column). */
  contractVersion: number;
  parentContractId: string | null;
  supersededById: string | null;
  startDate: string;
  endDate: string | null;
  /** Frozen at generation with provenance (A3); empty while draft. */
  variables: ContractVariableValueDto[];
  /** Draft-time manual values (A16 escape hatch). */
  overrides: Record<string, string>;
  generation: ContractGenerationDto;
  signers: ContractSignerDto[];
  approval: { required: boolean; steps: ContractApprovalStepDto[] } | null;
  attachments: ContractAttachmentDto[];
  terminatedAt: string | null;
  terminatedBy: string | null;
  terminationReason: string | null;
  /** Whether an immutable rendered snapshot exists (served by /document). */
  hasSnapshot: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency. */
  version: number;
}

// ── Verification (A23) — PUBLIC, non-PII ─────────────────────────────────────

/** The QR's query string: the contract number + the A14 SHA-256 as the key. */
export const VerifyContractQuerySchema = z
  .object({
    code: z.string().min(1).max(80),
    key: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type VerifyContractQuery = z.infer<typeof VerifyContractQuerySchema>;

/** Never carries employee data — this answer is world-readable by design. */
export interface ContractVerificationDto {
  valid: boolean;
  code?: string;
  contractVersion?: number;
  status?: ContractStatus;
  generatedAt?: string;
  templateVersion?: number;
}

// ── Branding profile (A24) ───────────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Branding lines may be empty (= that element disabled), unlike LocalizedStringSchema. */
const BrandingTextSchema = z.object({ ar: z.string().max(300), en: z.string().max(300) }).strict();

export const UpdateContractBrandingSchema = z
  .object({
    headerText: BrandingTextSchema.optional(),
    footerText: BrandingTextSchema.optional(),
    watermark: BrandingTextSchema.optional(),
    primaryColor: z.string().regex(HEX_COLOR).optional(),
    /** Clear the logo with null; upload sets it via the multipart route. */
    logoFileId: objectId().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateContractBranding = z.infer<typeof UpdateContractBrandingSchema>;

export interface ContractBrandingDto {
  headerText: { ar: string; en: string };
  footerText: { ar: string; en: string };
  watermark: { ar: string; en: string };
  primaryColor: string;
  logoFileId: string | null;
  version: number;
  updatedAt: string;
}

/** A22 — the stable query-seam DTO Payroll/Employee Files consume. */
export interface ContractSnapshotDto {
  contractId: string;
  code: string;
  contractVersion: number;
  employeeId: string;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  variables: ContractVariableValueDto[];
  integrity: ContractIntegrityDto | null;
}

// ── Events, notification templates, settings keys ────────────────────────────

export const HrContractEvents = {
  Generated: 'hr.contract.generated',
  ApprovalRequested: 'hr.contract.approvalRequested',
  ApprovalDecided: 'hr.contract.approvalDecided',
  Signed: 'hr.contract.signed',
  Amended: 'hr.contract.amended',
  Renewed: 'hr.contract.renewed',
  Terminated: 'hr.contract.terminated',
  Expired: 'hr.contract.expired',
} as const;
export type HrContractEventName = (typeof HrContractEvents)[keyof typeof HrContractEvents];

// Payload schemas (A-2). Contracts emitted these shapes from the start; declaring them is what
// lets the event catalogue describe a contract trigger's fields instead of shrugging at it.
// Each one is transcribed from its emit site in `contract.service.ts`.

export const ContractEventPayloadV1 = z.object({
  contractId: objectId(),
  code: z.string(),
});

/** `amended` / `renewed` — a new contract SUPERSEDES an existing one, and names which. */
export const ContractSupersededPayloadV1 = ContractEventPayloadV1.extend({
  sourceContractId: objectId(),
});

export const ContractGeneratedPayloadV1 = ContractEventPayloadV1.extend({
  employeeId: objectId(),
  contractVersion: z.number().int().min(1),
});

export const ContractApprovalDecidedPayloadV1 = ContractEventPayloadV1.extend({
  decision: z.enum(['approved', 'rejected']),
});

export const ContractTerminatedPayloadV1 = ContractEventPayloadV1.extend({
  reason: z.string(),
});

// ── «مستندات التعيين» — the printed hiring set (A27) ─────────────────────────

/** Why the set carries no contract, when it carries none. */
export const HIRING_PACK_CONTRACT_NOTES = [
  'noTemplate',
  'approvalRequired',
  'notPermitted',
  'missingValues',
  'notCreated',
] as const;
export type HiringPackContractNote = (typeof HIRING_PACK_CONTRACT_NOTES)[number];

export const HiringPackRequestSchema = z
  .object({
    employeeId: objectId(),
    /**
     * A28 — only these papers (template keys), from the employee's «طباعة العقد والمستندات» tab.
     * Absent: the whole set, as «مستندات التعيين» prints it.
     */
    keys: z.array(z.string().min(1).max(100)).min(1).max(60).optional(),
  })
  .strict();
export type HiringPackRequest = z.infer<typeof HiringPackRequestSchema>;

/**
 * A28 — what an EMPLOYEE's «طباعة العقد والمستندات» tab offers: the papers of their job (their
 * contract — the one they hold, else the one their job's template would make — then the forms) and
 * the contract they hold now, to print again or renew.
 */
export interface EmployeePapersDto {
  papers: JobPaperDto[];
  contract: {
    id: string;
    code: string;
    status: string;
    startDate: string;
    endDate: string | null;
    version: number;
  } | null;
}

/**
 * Everything one employee signs on joining, ready to print in one go: the contract first, then
 * every published form for the employee's job, each starting on a fresh page.
 */
export interface HiringPackDto {
  html: string;
  /** The contract printed first — `created` when this very request made and generated it. */
  contract: { id: string; code: string; created: boolean } | null;
  contractNote: HiringPackContractNote | null;
  /** The documents in the set, in print order. */
  documents: { key: string; name: { ar: string; en: string }; kind: ContractTemplateKind }[];
}

/**
 * A28 — «عقد جديد» for a CANDIDATE: everything one accepted candidate signs, printed from the offer
 * before the hire, and the hire itself once it is printed. The page's state is a server record —
 * saved as it changes, so a closed tab, a dropped connection or an expired session loses nothing.
 */
export const CANDIDATE_PAPER_GROUPS = ['contract', 'everyJob', 'thisJob'] as const;
export type CandidatePaperGroup = (typeof CANDIDATE_PAPER_GROUPS)[number];

/** One paper a job prints, as the print pages list it. */
export interface JobPaperDto {
  key: string;
  name: { ar: string; en: string };
  kind: ContractTemplateKind;
  /** The contract; a form every job signs; a form for this job only (its card, its declarations). */
  group: CandidatePaperGroup;
  /**
   * Offered to this job but left unticked until HR ticks it — the cash-in-transit specialist's
   * weapon declaration («اخصائي نقل اموال بتبقا اوبشن … منغير علامه»). Every other paper starts ticked.
   */
  optional: boolean;
}

export interface CandidatePaperDto extends JobPaperDto {
  /** The values it prints — what «تعديل» offers to change. */
  placeholders: string[];
  selected: boolean;
}

export interface CandidateValueDto {
  key: string;
  label: { ar: string; en: string };
  value: string;
  /** Typed in for this candidate, instead of read from the record. */
  overridden: boolean;
}

export interface CandidateDraftDto {
  id: string;
  offerId: string;
  offerCode: string | null;
  applicantName: string;
  jobTitle: { ar: string; en: string } | null;
  /** The contract's term and the hiring date — from the offer, as changed here. */
  startDate: string;
  endDate: string | null;
  hiringDate: string;
  /** The contract type is fixed-term: the contract carries an end date. */
  allowsEndDate: boolean;
  papers: CandidatePaperDto[];
  /** Every value the papers print, as they would print now. */
  values: CandidateValueDto[];
  /** The employee code kept for the candidate at the first print — and taken at the hire. */
  employeeCode: string | null;
  printedAt: string | null;
  printCount: number;
  /** Set once hired from here. */
  employeeId: string | null;
  updatedAt: string;
  version: number;
}

export const UpdateCandidateDraftSchema = z
  .object({
    selected: z.array(z.string().min(1).max(100)).max(60).optional(),
    overrides: overridesField().optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().nullable().optional(),
    hiringDate: isoDate().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateCandidateDraft = z.infer<typeof UpdateCandidateDraftSchema>;

export const RenderCandidatePapersSchema = z
  .object({
    keys: z.array(z.string().min(1).max(100)).min(1).max(60),
    /** A print keeps the employee code and records the print; a preview changes nothing. */
    print: z.boolean().default(false),
  })
  .strict();
export type RenderCandidatePapers = z.infer<typeof RenderCandidatePapersSchema>;

export interface RenderCandidatePapersDto {
  html: string;
  draft: CandidateDraftDto;
}

export const HireCandidateSchema = z.object({ version: z.number().int().min(0) }).strict();
export type HireCandidate = z.infer<typeof HireCandidateSchema>;

export interface HireCandidateDto {
  employeeId: string;
  employeeCode: string;
  /** The contract recorded on the new employee, made and generated from the papers' terms. */
  contract: { id: string; code: string } | null;
  contractNote: HiringPackContractNote | null;
}

/**
 * A28 — printing for MANY candidates at once from «جاهزون للتعيين»: the people ticked, each with the
 * papers of their own job; the papers chosen once for all of them; one document out.
 */
export const CANDIDATE_BULK_MAX = 50;

export const CandidateBulkSchema = z
  .object({ offerIds: z.array(objectId()).min(1).max(CANDIDATE_BULK_MAX) })
  .strict();
export type CandidateBulk = z.infer<typeof CandidateBulkSchema>;

export interface CandidateBulkPersonDto {
  offerId: string;
  applicantName: string;
  offerCode: string | null;
  jobTitle: { ar: string; en: string } | null;
  /** The person's papers, in print order — what their job prints. */
  papers: JobPaperDto[];
  /** Why the person cannot be printed for (the offer is no longer accepted…), else null. */
  error: string | null;
}

export const RenderCandidateBulkSchema = z
  .object({
    offerIds: z.array(objectId()).min(1).max(CANDIDATE_BULK_MAX),
    /** The papers chosen — each person prints those of them their own job has. */
    keys: z.array(z.string().min(1).max(100)).min(1).max(60),
  })
  .strict();
export type RenderCandidateBulk = z.infer<typeof RenderCandidateBulkSchema>;

export interface RenderCandidateBulkDto {
  html: string;
  /** Per person: printed (and how many papers), or why not. */
  results: { offerId: string; printed: number; error: string | null }[];
}

export const HrContractTemplates = {
  ExpiringSoon: 'hr.contract.expiringSoon',
} as const;

/** Files-service category the generated PDFs live under (A15). */
export const CONTRACT_DOCUMENTS_FILE_CATEGORY = 'hr.contractDocuments';

export const HrContractSettingKeys = {
  /** A1 — pattern with {prefix}, {year}, {seq[:pad]} tokens. */
  NumberFormat: 'contracts.numberFormat',
  /** A7 — the phase-1 single-step approval gate. */
  RequireApproval: 'contracts.requireApproval',
  /** D11 — expiring-soon notification window (days). */
  ExpiryNoticeDays: 'contracts.expiryNoticeDays',
} as const;
