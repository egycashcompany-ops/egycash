import { z } from 'zod';

export * from './localized.js';

// ── Identifiers ─────────────────────────────────────────────────────────────

export const objectId = () =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'must be a 24-hex-char ObjectId' });

// ── Data scopes (ADR-004; ADR-015 org model; ADR-017 hierarchical scopes) ────
// The organizational visibility ladder, narrowest → widest:
//   own (Self) ⊂ section ⊂ department ⊂ branch ⊂ organization (Company).
// The tokens `own` and `organization` are kept (backward compatible — they map to
// the business terms "Self" and "Company"); `section` and `department` are added.

export const DATA_SCOPES = ['own', 'section', 'department', 'branch', 'organization'] as const;
export const DataScopeSchema = z.enum(DATA_SCOPES);
export type DataScope = z.infer<typeof DataScopeSchema>;

/** Widest wins when a user holds the same permission at several scopes. */
export const DATA_SCOPE_RANK: Record<DataScope, number> = {
  own: 0,
  section: 1,
  department: 2,
  branch: 3,
  organization: 4,
};

export const widerScope = (a: DataScope, b: DataScope): DataScope =>
  DATA_SCOPE_RANK[a] >= DATA_SCOPE_RANK[b] ? a : b;

// ── Standard record assignment (Review R17 — backs the `own` scope) ─────────

export const ASSIGNEE_ROLES = ['owner', 'assignee', 'watcher'] as const;
export const AssigneeSchema = z.object({
  userId: objectId(),
  role: z.enum(ASSIGNEE_ROLES),
  at: z.coerce.date(),
});
export type Assignee = z.infer<typeof AssigneeSchema>;

// ── Pagination (API Standards §4) ───────────────────────────────────────────

export const MAX_PAGE_SIZE = 100;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

// ── Response envelope (API Standards §2) ────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface ApiErrorDetail {
  field?: string;
  code: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId: string;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

// ── Entity references (audit, files, workflow all share this shape) ─────────

export const EntityRefSchema = z.object({
  moduleId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export * from './value-objects.js';
