import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// File Management Service contracts (ADR-010, Platform Core §7).
// Metadata lives in MongoDB; binaries live behind a StorageProvider; every
// download is authorized and audited.

export const FILE_STATUSES = ['active', 'archived'] as const;
export const FileStatusSchema = z.enum(FILE_STATUSES);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FILE_VISIBILITIES = ['private', 'public'] as const;
export const FileVisibilitySchema = z.enum(FILE_VISIBILITIES);
export type FileVisibility = z.infer<typeof FileVisibilitySchema>;

export const SCAN_STATUSES = ['unscanned', 'pending', 'clean', 'blocked'] as const;
export const ScanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

export const STORAGE_DRIVERS = ['local', 'railway', 's3', 'minio', 'azure'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

const tagsSchema = z.array(z.string().min(1).max(50)).max(20);

/** Multipart text fields accompanying the binary on upload. */
export const UploadFileFieldsSchema = z
  .object({
    moduleId: z.string().min(1).max(50),
    entityType: z.string().min(1).max(100),
    entityId: z.string().min(1).max(100),
    categoryId: objectId(),
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    visibility: FileVisibilitySchema.default('private'),
    /** JSON-encoded array of tags (multipart fields are strings). */
    tags: z
      .string()
      .transform((raw, ctx) => {
        try {
          return tagsSchema.parse(JSON.parse(raw));
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'tags must be a JSON string array',
          });
          return z.NEVER;
        }
      })
      .optional(),
  })
  .strict();
export type UploadFileFields = z.infer<typeof UploadFileFieldsSchema>;

export const UpdateFileSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    visibility: FileVisibilitySchema.optional(),
    tags: tagsSchema.optional(),
    categoryId: objectId().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFile = z.infer<typeof UpdateFileSchema>;

export const ListFilesQuerySchema = PaginationQuerySchema.extend({
  moduleId: z.string().max(50).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  categoryId: objectId().optional(),
  tag: z.string().max(50).optional(),
  status: FileStatusSchema.optional(),
  search: z.string().max(200).optional(),
}).strict();
export type ListFilesQuery = z.infer<typeof ListFilesQuerySchema>;

export interface FileDto {
  id: string;
  groupId: string;
  fileVersion: number;
  isLatest: boolean;
  originalName: string;
  storedName: string;
  displayName: string;
  description: string | null;
  mime: string;
  extension: string;
  size: number;
  checksum: string;
  categoryId: string;
  tags: string[];
  visibility: 'private' | 'public';
  status: FileStatus;
  scanStatus: ScanStatus;
  entityRef: { moduleId: string; entityType: string; entityId: string };
  storageDriver: string;
  uploadedBy: string | null;
  uploadedAt: string;
  /** Optimistic-concurrency version of the METADATA document (not the content version). */
  version: number;
}

export interface DownloadTicketDto {
  url: string;
  expiresAt: string;
}

// ── Categories (admin catalog with per-category rules) ─────────────────────

export const CreateFileCategorySchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/),
    name: z.object({ ar: z.string().min(1), en: z.string().min(1) }),
    allowedMimeTypes: z.array(z.string().min(3).max(100)).min(1).max(50),
    maxSizeMb: z.number().int().min(1).max(500),
    retentionDays: z.number().int().min(1).nullable().default(null),
  })
  .strict();
export type CreateFileCategory = z.infer<typeof CreateFileCategorySchema>;

export const UpdateFileCategorySchema = z
  .object({
    name: z.object({ ar: z.string().min(1), en: z.string().min(1) }).optional(),
    allowedMimeTypes: z.array(z.string().min(3).max(100)).min(1).max(50).optional(),
    maxSizeMb: z.number().int().min(1).max(500).optional(),
    retentionDays: z.number().int().min(1).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFileCategory = z.infer<typeof UpdateFileCategorySchema>;

export interface FileCategoryDto {
  id: string;
  key: string;
  name: { ar: string; en: string };
  allowedMimeTypes: string[];
  maxSizeMb: number;
  retentionDays: number | null;
  status: 'active' | 'inactive';
  version: number;
}
