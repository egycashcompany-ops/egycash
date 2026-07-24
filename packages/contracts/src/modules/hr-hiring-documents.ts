// HR / Recruitment — Hiring Documents (Stage 6). Shared contracts for the sixth stage of the
// approved seven-stage recruitment workflow: after an applicant is hired (Stage 5), their
// hiring documents are collected. An administrator defines the required and optional document
// types; each document is an uploaded PDF backed by the platform Files service (the original
// is preserved; replacement creates a new version while keeping prior versions). A hiring set
// cannot be completed while a mandatory document is missing; once completed it is immutable
// except through the document-versioning workflow. Scope is Stage 6 only: nothing here
// describes the Electronic File (Stage 7) or later.
import { z } from 'zod';
import { objectId, LocalizedStringSchema, PaginationQuerySchema, type LocalizedString } from '../common/index.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

/** A hiring set is `inProgress` while documents are collected, then terminal `completed`. */
export const HIRING_DOCUMENTS_STATUSES = ['inProgress', 'completed'] as const;
export const HiringDocumentsStatusSchema = z.enum(HIRING_DOCUMENTS_STATUSES);
export type HiringDocumentsStatus = z.infer<typeof HiringDocumentsStatusSchema>;

// ── Document types (admin-defined required/optional catalog) ────────────────

export const CreateHiringDocumentTypeSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    /** Required types must all be present before a hiring set can be completed. */
    required: z.boolean().default(false),
  })
  .strict();
export type CreateHiringDocumentType = z.infer<typeof CreateHiringDocumentTypeSchema>;

export const UpdateHiringDocumentTypeSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    required: z.boolean().optional(),
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateHiringDocumentType = z.infer<typeof UpdateHiringDocumentTypeSchema>;

export const ListHiringDocumentTypesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  required: z.coerce.boolean().optional(),
}).strict();
export type ListHiringDocumentTypesQuery = z.infer<typeof ListHiringDocumentTypesQuerySchema>;

export interface HiringDocumentTypeDto {
  id: string;
  key: string;
  name: LocalizedString;
  required: boolean;
  active: boolean;
  version: number;
}

// ── Hiring documents aggregate ──────────────────────────────────────────────

/** Open the hiring-documents set for an employee (one per employee). */
export const CreateHiringDocumentsSchema = z.object({ employeeId: objectId() }).strict();
export type CreateHiringDocuments = z.infer<typeof CreateHiringDocumentsSchema>;

/** Upload a PDF for a document type (multipart file + this body; fields arrive as strings). */
export const UploadHiringDocumentSchema = z
  .object({
    typeId: objectId(),
    notes: z.string().max(1000).optional(),
    version: z.coerce.number().int().min(0),
  })
  .strict();
export type UploadHiringDocument = z.infer<typeof UploadHiringDocumentSchema>;

/** Replace an already-uploaded document with a new PDF version (multipart file + this body). */
export const ReplaceHiringDocumentSchema = z
  .object({ version: z.coerce.number().int().min(0) })
  .strict();
export type ReplaceHiringDocument = z.infer<typeof ReplaceHiringDocumentSchema>;

export const CompleteHiringDocumentsSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type CompleteHiringDocuments = z.infer<typeof CompleteHiringDocumentsSchema>;

export const ListHiringDocumentsQuerySchema = PaginationQuerySchema.extend({
  status: HiringDocumentsStatusSchema.optional(),
  employeeId: objectId().optional(),
  branchId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListHiringDocumentsQuery = z.infer<typeof ListHiringDocumentsQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** One collected document — metadata mirrors the current file version (Files service). */
export interface HiringDocumentItemDto {
  typeId: string;
  typeKey: string;
  typeName: LocalizedString;
  required: boolean;
  fileId: string;
  fileName: string;
  fileVersion: number;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface HiringDocumentsDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  /** null for a DIRECT-registration employee (no recruitment history). */
  applicantId: string | null;
  branchId: string;
  status: HiringDocumentsStatus;
  documents: HiringDocumentItemDto[];
  /** Active required type keys still missing a document (empty ⇒ completable). */
  missingRequired: string[];
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrHiringDocumentsEvents = {
  Created: 'hr.hiringDocuments.created',
  DocumentUploaded: 'hr.hiringDocuments.documentUploaded',
  DocumentReplaced: 'hr.hiringDocuments.documentReplaced',
  Completed: 'hr.hiringDocuments.completed',
} as const;
export type HrHiringDocumentsEventName =
  (typeof HrHiringDocumentsEvents)[keyof typeof HrHiringDocumentsEvents];

export const HiringDocumentsEventPayloadV1 = z.object({
  hiringDocumentsId: objectId(),
  employeeId: objectId(),
  employeeCode: z.string(),
});

// ── Notification template + file category keys (seeded at boot by the HR module) ─

export const HrHiringDocumentsTemplates = {
  Completed: 'hr.hiringDocumentsCompleted',
} as const;

/** The Files-service category hiring-document PDFs are stored under (PDF-only). */
export const HIRING_DOCUMENTS_FILE_CATEGORY = 'hr-hiring-documents';
