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

/** A version's lifecycle (A17): only `published` versions can generate contracts. */
export const CONTRACT_TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const;
export const ContractTemplateStatusSchema = z.enum(CONTRACT_TEMPLATE_STATUSES);
export type ContractTemplateStatus = z.infer<typeof ContractTemplateStatusSchema>;

/** One labeled signature block (D4); labels are in the template's language. */
export const SignatureBlockSchema = z
  .object({
    key: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
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
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateContractTemplate = z.infer<typeof UpdateContractTemplateSchema>;

export const CloneContractTemplateSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    language: ContractTemplateLanguageSchema.optional(),
  })
  .strict();
export type CloneContractTemplate = z.infer<typeof CloneContractTemplateSchema>;

export const ListContractTemplatesQuerySchema = PaginationQuerySchema.extend({
  language: ContractTemplateLanguageSchema.optional(),
  contractTypeId: objectId().optional(),
  status: ContractTemplateStatusSchema.optional(),
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

export const ContractVersionOnlySchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
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
  generatorVersion?: string;
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
