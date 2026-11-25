// Compliance and Risks — «الالتزام والمخاطر» (docs/12-planning/compliance-files-design.md).
//
// The module's first and only page so far is «الملفات»: folders the responsible person keeps, each
// shown to the employees they name and to nobody else. Inside a folder sit PDF, Word and Excel
// files of up to 20 MB. Whoever a folder is shared with may open a file and download it — nothing
// more — and every opening and every download is recorded, so the responsible person sees who has
// seen each file, how many times, and when.
//
// Two keys (§4): `complianceFile.manage` is the responsible person's — folders, their names, their
// cover pictures, who sees them, the files inside and the seen report; `complianceFile.view` opens
// the page for a person a folder is shared with. Nobody is given the second by hand: the module
// gives it to a person when the first folder is shared with them and takes it back when the last one
// is no longer (§4.2). What a reader sees is decided by the folders' lists, never by the key.
import { z } from 'zod';
import { PaginationQuerySchema, objectId } from '../common/index.js';

// ── Files: what may be kept, and how large (§5) ─────────────────────────────

/** The file category a folder's documents are filed under. */
export const COMPLIANCE_DOCUMENTS_FILE_CATEGORY = 'compliance-documents';
/** The file category a folder's cover picture is filed under. */
export const COMPLIANCE_COVERS_FILE_CATEGORY = 'compliance-folder-covers';

/** The owner's limit: «وحط ليميت 20M». */
export const COMPLIANCE_DOCUMENT_MAX_MB = 20;
/** A cover is a picture on a folder, not a document: a phone photo fits well inside this. */
export const COMPLIANCE_COVER_MAX_MB = 5;

/**
 * The kinds a document may be, each with the extensions and the types a browser sends for it.
 * PDF, Word and Excel — «PDF أو Word أو Excel» — in both the current and the older formats.
 */
export const COMPLIANCE_DOCUMENT_KINDS = ['pdf', 'word', 'excel'] as const;
export type ComplianceDocumentKind = (typeof COMPLIANCE_DOCUMENT_KINDS)[number];

export const COMPLIANCE_DOCUMENT_TYPES: Readonly<
  Record<string, { kind: ComplianceDocumentKind; mime: string }>
> = {
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
  '.doc': { kind: 'word', mime: 'application/msword' },
  '.docx': {
    kind: 'word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.xls': { kind: 'excel', mime: 'application/vnd.ms-excel' },
  '.xlsx': {
    kind: 'excel',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

/** Every type the documents category accepts — one per extension above. */
export const COMPLIANCE_DOCUMENT_MIMES: readonly string[] = [
  ...new Set(Object.values(COMPLIANCE_DOCUMENT_TYPES).map((type) => type.mime)),
];

/** The extensions a file picker offers, in the order a person reads them. */
export const COMPLIANCE_DOCUMENT_EXTENSIONS = Object.keys(COMPLIANCE_DOCUMENT_TYPES);

export const COMPLIANCE_COVER_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The extension of a file name, lower-cased with its dot — '' when it has none. */
export const complianceExtensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 || dot === fileName.length - 1 ? '' : fileName.slice(dot).toLowerCase();
};

/** The kind a file name says it is, or null for a name no document may carry. */
export const complianceKindOf = (fileName: string): ComplianceDocumentKind | null =>
  COMPLIANCE_DOCUMENT_TYPES[complianceExtensionOf(fileName)]?.kind ?? null;

// ── Shared field shapes ─────────────────────────────────────────────────────

/** A folder's or a file's name as a person types it: trimmed, never empty, one line. */
export const ComplianceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine((name) => !/[\r\n]/.test(name), { message: 'a name is one line' });

/** Who a folder is shown to: user accounts, at most 500, each named once. */
const viewerIds = z
  .array(objectId())
  .max(500)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'a person is named once',
  });

const version = z.coerce.number().int().min(0);

// ── People — the accounts a folder may be shared with (§4.3) ────────────────

/** One person as the sharing picker and a folder's list name them. */
export interface CompliancePersonDto {
  userId: string;
  name: { ar: string; en: string };
  /** The login the person signs in with — the employee code for most staff. */
  username: string | null;
  /** False for an account that is no longer active: it stays on a list until it is taken off. */
  isActive: boolean;
}

export const ListCompliancePeopleQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
}).strict();
export type ListCompliancePeopleQuery = z.infer<typeof ListCompliancePeopleQuerySchema>;

// ── Folders (§3.1) ──────────────────────────────────────────────────────────

export interface ComplianceFolderDto {
  id: string;
  name: string;
  /** True when the folder wears a picture; it is read from `/compliance/folders/:id/cover`. */
  hasCover: boolean;
  /** Changes whenever the picture does, so a screen knows to fetch the new one. */
  coverVersion: string | null;
  documentCount: number;
  /**
   * Who sees the folder. Sent to the responsible person only: a reader is told the folder is
   * theirs, never who else it is shared with — an empty list for them.
   */
  viewers: CompliancePersonDto[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const ListComplianceFoldersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
}).strict();
export type ListComplianceFoldersQuery = z.infer<typeof ListComplianceFoldersQuerySchema>;

export const CreateComplianceFolderSchema = z
  .object({
    name: ComplianceNameSchema,
    viewerUserIds: viewerIds.default([]),
  })
  .strict();
export type CreateComplianceFolder = z.infer<typeof CreateComplianceFolderSchema>;

/** A rename, a new list of who sees it, or both — under the version the person saw. */
export const UpdateComplianceFolderSchema = z
  .object({
    name: ComplianceNameSchema.optional(),
    viewerUserIds: viewerIds.optional(),
    version,
  })
  .strict()
  .refine((body) => body.name !== undefined || body.viewerUserIds !== undefined, {
    message: 'nothing to change',
  });
export type UpdateComplianceFolder = z.infer<typeof UpdateComplianceFolderSchema>;

/** `?version=` on a DELETE and on a cover's removal, which carry no body. */
export const ComplianceVersionQuerySchema = z.object({ version }).strict();
export type ComplianceVersionQuery = z.infer<typeof ComplianceVersionQuerySchema>;

/** The text field beside a cover's file (multipart, so it arrives as a string). */
export const SetComplianceFolderCoverSchema = z.object({ version }).strict();
export type SetComplianceFolderCover = z.infer<typeof SetComplianceFolderCoverSchema>;

// ── Documents (§3.2) ────────────────────────────────────────────────────────

/** How the people a folder is shared with have met one file — the responsible person's line. */
export interface ComplianceSeenSummaryDto {
  /** How many of the folder's people have opened or downloaded it at least once. */
  seenBy: number;
  /** How many people the folder is shared with now. */
  sharedWith: number;
}

export interface ComplianceDocumentDto {
  id: string;
  folderId: string;
  name: string;
  /** The name the file had on the uploader's computer, extension included. */
  fileName: string;
  kind: ComplianceDocumentKind;
  mime: string;
  size: number;
  uploadedAt: string;
  /** The responsible person's alone; null for a reader. */
  seen: ComplianceSeenSummaryDto | null;
  version: number;
}

export const ListComplianceDocumentsQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
export type ListComplianceDocumentsQuery = z.infer<typeof ListComplianceDocumentsQuerySchema>;

/** The text field beside a document's file: its name, when the file's own is not the one wanted. */
export const AddComplianceDocumentSchema = z
  .object({ name: ComplianceNameSchema.optional() })
  .strict();
export type AddComplianceDocument = z.infer<typeof AddComplianceDocumentSchema>;

export const RenameComplianceDocumentSchema = z
  .object({ name: ComplianceNameSchema, version })
  .strict();
export type RenameComplianceDocument = z.infer<typeof RenameComplianceDocumentSchema>;

/** `?mode=` on a file's bytes: `view` opens it in the browser, `download` saves it. */
export const COMPLIANCE_ACCESS_ACTIONS = ['view', 'download'] as const;
export type ComplianceAccessAction = (typeof COMPLIANCE_ACCESS_ACTIONS)[number];
export const ComplianceContentQuerySchema = z
  .object({ mode: z.enum(COMPLIANCE_ACCESS_ACTIONS).default('view') })
  .strict();
export type ComplianceContentQuery = z.infer<typeof ComplianceContentQuerySchema>;

// ── Preview — Word and Excel read in the page (§6.2) ────────────────────────
//
// A browser shows a PDF itself; it cannot show a Word or an Excel file, so the server reads one
// into the plain structure below and the page draws it. A reader's «عرض» is then the same act for
// every kind, and it is recorded the same way.

/** Bounds on what a preview carries, so a very large workbook is cut, never sent whole. */
export const COMPLIANCE_PREVIEW_LIMITS = {
  sheets: 10,
  rows: 500,
  columns: 40,
  blocks: 3000,
} as const;

export type CompliancePreviewBlockDto =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][] };

export interface CompliancePreviewSheetDto {
  name: string;
  rows: string[][];
  /** True when the sheet had more rows or columns than the preview carries. */
  truncated: boolean;
}

export type CompliancePreviewDto =
  | { kind: 'document'; blocks: CompliancePreviewBlockDto[]; truncated: boolean }
  | { kind: 'sheets'; sheets: CompliancePreviewSheetDto[]; truncated: boolean }
  /** An older Word or Excel file (.doc, .xls), or one that could not be read: download it. */
  | { kind: 'unavailable' };

// ── The seen report (§7) ────────────────────────────────────────────────────

export interface ComplianceAccessEventDto {
  action: ComplianceAccessAction;
  at: string;
}

/** One person the folder is shared with, and what they have done with one file. */
export interface ComplianceViewerReportDto {
  person: CompliancePersonDto;
  seen: boolean;
  viewCount: number;
  downloadCount: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Newest first, at most `COMPLIANCE_REPORT_EVENTS` of them. */
  events: ComplianceAccessEventDto[];
}

export const COMPLIANCE_REPORT_EVENTS = 100;

export interface ComplianceSeenReportDto {
  documentId: string;
  /** Everyone the folder is shared with now, those who have not seen the file first. */
  viewers: ComplianceViewerReportDto[];
  /**
   * People who opened the file while the folder was shared with them and are no longer on its
   * list. Their history is kept — it happened — and shown apart.
   */
  former: ComplianceViewerReportDto[];
}
