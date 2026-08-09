// IT module contracts (docs/12-planning/it-module-design.md, FROZEN v1.2) — slices IT-1…IT-3:
// catalog items, vendors, the asset register with server-allocated codes, QR labels, the custody
// lifecycle (assign / return / transfer / dispose) with its append-only history, and the help desk
// (priorities carrying their SLA targets, tickets, and one stream that is both history and
// conversation). Maintenance, software and dashboards arrive in IT-4…IT-6 by extending this file,
// never by adding a second one.
//
// Asset `status` is deliberately absent from every write schema: it is derived from operations
// (FR-2) and no endpoint sets it. In IT-1 the only operation is registration, so every asset is
// `inStock` — the full vocabulary is declared now so IT-2 extends behaviour, not shapes.
import { z } from 'zod';
import { LocalizedStringSchema } from '../common/localized.js';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';

// ── Simple catalogs (design §2.4 — one collection, kind-discriminated) ──────

export const IT_CATALOG_KINDS = ['assetCategory', 'ticketCategory'] as const;
export const ItCatalogKindSchema = z.enum(IT_CATALOG_KINDS);
export type ItCatalogKind = z.infer<typeof ItCatalogKindSchema>;

export interface ItCatalogItemDto {
  id: string;
  kind: ItCatalogKind;
  code: string | null;
  name: { ar: string; en: string };
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateItCatalogItemSchema = z
  .object({
    kind: ItCatalogKindSchema,
    code: z.string().trim().min(1).max(30).optional(),
    name: LocalizedStringSchema,
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateItCatalogItem = z.infer<typeof CreateItCatalogItemSchema>;

export const UpdateItCatalogItemSchema = z
  .object({
    code: z.string().trim().min(1).max(30).nullable().optional(),
    name: LocalizedStringSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItCatalogItem = z.infer<typeof UpdateItCatalogItemSchema>;

export const ListItCatalogQuerySchema = PaginationQuerySchema.extend({
  kind: ItCatalogKindSchema.optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListItCatalogQuery = z.infer<typeof ListItCatalogQuerySchema>;

// ── Vendors (design §2.9 — IT-owned until Procurement exists, §13-Q6) ───────

export const ItVendorContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(200).optional(),
  })
  .strict();
export type ItVendorContact = z.infer<typeof ItVendorContactSchema>;

export interface ItVendorContactDto {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface ItVendorDto {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  services: string | null;
  contacts: ItVendorContactDto[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Contacts are embedded — bounded by business reality (design §2.9), not a growth collection. */
const vendorCore = {
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  services: z.string().trim().max(500).optional(),
  contacts: z.array(ItVendorContactSchema).max(20).default([]),
};

export const CreateItVendorSchema = z.object(vendorCore).strict();
export type CreateItVendor = z.infer<typeof CreateItVendorSchema>;

export const UpdateItVendorSchema = z
  .object({
    name: vendorCore.name.optional(),
    code: vendorCore.code.nullable().optional(),
    phone: vendorCore.phone.nullable().optional(),
    email: vendorCore.email.nullable().optional(),
    address: vendorCore.address.nullable().optional(),
    services: vendorCore.services.nullable().optional(),
    contacts: z.array(ItVendorContactSchema).max(20).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItVendor = z.infer<typeof UpdateItVendorSchema>;

/** `search` from day one — vendors are a growth catalog and pickers search them (ADR-019 rule 5). */
export const ListItVendorsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListItVendorsQuery = z.infer<typeof ListItVendorsQuerySchema>;

// ── Assets (design §2.2) ────────────────────────────────────────────────────

export const IT_ASSET_STATUSES = ['inStock', 'assigned', 'underMaintenance', 'disposed'] as const;
export const ItAssetStatusSchema = z.enum(IT_ASSET_STATUSES);
export type ItAssetStatus = z.infer<typeof ItAssetStatusSchema>;

export interface ItAssetPurchaseDto {
  date: string | null;
  cost: number | null;
  vendorId: string | null;
  invoiceRef: string | null;
}

export interface ItAssetWarrantyDto {
  vendorId: string | null;
  start: string;
  end: string;
  terms: string | null;
}

/** Disposal is set once and terminal (design §2.2, FR-4). */
export const IT_DISPOSAL_METHODS = [
  'sold',
  'scrapped',
  'donated',
  'lost',
  'returnedToVendor',
] as const;
export const ItDisposalMethodSchema = z.enum(IT_DISPOSAL_METHODS);
export type ItDisposalMethod = z.infer<typeof ItDisposalMethodSchema>;

export interface ItAssetDisposalDto {
  at: string;
  method: ItDisposalMethod;
  reason: string;
  notes: string | null;
}

export interface ItAssetDto {
  id: string;
  assetCode: string;
  name: string;
  description: string | null;
  categoryId: string;
  status: ItAssetStatus;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  externalTag: string | null;
  branchId: string;
  location: string | null;
  purchase: ItAssetPurchaseDto | null;
  warranty: ItAssetWarrantyDto | null;
  /**
   * Denormalized head of the OPEN custody interval, `null` when the asset is not out (design
   * §2.2). A read convenience only — `it_asset_assignments` is the truth, and "at most one open
   * per asset" is a partial unique index rather than a convention (ADR-021).
   *
   * Added in IT-2. Additive to the IT-1 DTO: no existing field changed shape or meaning.
   */
  currentAssignmentId: string | null;
  /** Set once, terminal (FR-4). `null` until the asset is disposed. */
  disposal: ItAssetDisposalDto | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ItAssetPurchaseSchema = z
  .object({
    date: z.coerce.date().optional(),
    cost: z.number().nonnegative().optional(),
    vendorId: objectId().optional(),
    invoiceRef: z.string().trim().max(100).optional(),
  })
  .strict();
export type ItAssetPurchase = z.infer<typeof ItAssetPurchaseSchema>;

export const ItAssetWarrantySchema = z
  .object({
    vendorId: objectId().optional(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    terms: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end.getTime() < value.start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'warranty end must not precede its start',
      });
    }
  });
export type ItAssetWarranty = z.infer<typeof ItAssetWarrantySchema>;

/** `assetCode` is server-allocated (design §2.1) — it is not accepted on any write. */
const assetCore = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  categoryId: objectId(),
  serialNumber: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  /** A pre-existing printed tag/barcode number — legacy labels keep working (design §2.2). */
  externalTag: z.string().trim().min(1).max(120).optional(),
  branchId: objectId(),
  location: z.string().trim().max(200).optional(),
  purchase: ItAssetPurchaseSchema.optional(),
  warranty: ItAssetWarrantySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const CreateItAssetSchema = z.object(assetCore).strict();
export type CreateItAsset = z.infer<typeof CreateItAssetSchema>;

export const UpdateItAssetSchema = z
  .object({
    name: assetCore.name.optional(),
    description: assetCore.description.nullable().optional(),
    categoryId: objectId().optional(),
    serialNumber: assetCore.serialNumber.nullable().optional(),
    model: assetCore.model.nullable().optional(),
    manufacturer: assetCore.manufacturer.nullable().optional(),
    externalTag: assetCore.externalTag.nullable().optional(),
    location: assetCore.location.nullable().optional(),
    purchase: ItAssetPurchaseSchema.nullable().optional(),
    warranty: ItAssetWarrantySchema.nullable().optional(),
    notes: assetCore.notes.nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItAsset = z.infer<typeof UpdateItAssetSchema>;

export const ListItAssetsQuerySchema = PaginationQuerySchema.extend({
  /** Matches assetCode, name, serialNumber and externalTag — the strings an operator has. */
  search: z.string().trim().max(200).optional(),
  categoryId: objectId().optional(),
  status: ItAssetStatusSchema.optional(),
  branchId: objectId().optional(),
}).strict();
export type ListItAssetsQuery = z.infer<typeof ListItAssetsQuerySchema>;

/**
 * Label sheet request (design §4.2). Bounded: a print batch, not a bulk read — the sheet grows in
 * pages, the request does not grow past the bound.
 */
export const ItAssetLabelsSchema = z
  .object({ assetIds: z.array(objectId()).min(1).max(100) })
  .strict();
export type ItAssetLabels = z.infer<typeof ItAssetLabelsSchema>;

// ── Custody: assignments (design §2.5) ──────────────────────────────────────

export interface ItAssetAssignmentDto {
  id: string;
  assetId: string;
  assignedToEmployeeId: string;
  assignedByUserId: string | null;
  assignedAt: string;
  conditionOnIssue: string | null;
  expectedReturnAt: string | null;
  /** `null` while the interval is OPEN — the field that closes it (design §6). */
  returnedAt: string | null;
  returnedToUserId: string | null;
  conditionOnReturn: string | null;
  notes: string | null;
  /** The asset's branch when the interval opened — denormalized so the register filters on it. */
  branchId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The four custody actions are NAMED (design §4.3) — never a generic PATCH — because each is a
 * distinct business act with its own guard, its own event and its own audit action. A PATCH that
 * happened to set `assignedToEmployeeId` would be none of those things.
 *
 * None of them carries a `version`: a custody action is not an edit of a record the caller is
 * holding, it is a transition of the ASSET, and its precondition is the asset's own state (in
 * stock / out / disposed) which the server checks inside the transaction. Optimistic locking
 * guards the registry edit form; the state machine guards these.
 */
export const AssignItAssetSchema = z
  .object({
    employeeId: objectId(),
    assignedAt: z.coerce.date().optional(),
    conditionOnIssue: z.string().trim().max(500).optional(),
    expectedReturnAt: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.expectedReturnAt !== undefined &&
      value.assignedAt !== undefined &&
      value.expectedReturnAt.getTime() < value.assignedAt.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedReturnAt'],
        message: 'the expected return cannot precede the assignment',
      });
    }
  });
export type AssignItAsset = z.infer<typeof AssignItAssetSchema>;

export const ReturnItAssetSchema = z
  .object({
    returnedAt: z.coerce.date().optional(),
    conditionOnReturn: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReturnItAsset = z.infer<typeof ReturnItAssetSchema>;

/**
 * Transfer moves custody in ONE fact (design §2.5): person→person, branch→branch, or both. It is
 * never expressed as return + assign, because the history must show intent rather than mechanics.
 * At least one destination is required — a transfer to nowhere is not a transfer.
 */
export const TransferItAssetSchema = z
  .object({
    toEmployeeId: objectId().optional(),
    toBranchId: objectId().optional(),
    at: z.coerce.date().optional(),
    conditionOnReturn: z.string().trim().max(500).optional(),
    conditionOnIssue: z.string().trim().max(500).optional(),
    expectedReturnAt: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toEmployeeId === undefined && value.toBranchId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toEmployeeId'],
        message: 'a transfer needs a new holder, a new branch, or both',
      });
    }
  });
export type TransferItAsset = z.infer<typeof TransferItAssetSchema>;

/** Disposal is terminal and set once (FR-4); `reason` is required because it is the record. */
export const DisposeItAssetSchema = z
  .object({
    method: ItDisposalMethodSchema,
    reason: z.string().trim().min(1).max(500),
    at: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DisposeItAsset = z.infer<typeof DisposeItAssetSchema>;

export const ListItAssignmentsQuerySchema = PaginationQuerySchema.extend({
  /** `true` → only the open interval; `false` → only closed ones. Omitted → both. */
  open: booleanQuery().optional(),
  assetId: objectId().optional(),
  employeeId: objectId().optional(),
  branchId: objectId().optional(),
}).strict();
export type ListItAssignmentsQuery = z.infer<typeof ListItAssignmentsQuerySchema>;

// ── Custody: the asset's business history (design §2.3) ─────────────────────

/**
 * The closed vocabulary of `it_asset_events`. IT-2 writes five of these; the maintenance types
 * arrive with IT-4. Declared whole now so the history renderer is written once — the same reason
 * the status vocabulary was complete in IT-1.
 */
export const IT_ASSET_EVENT_TYPES = [
  'registered',
  'updated',
  'assigned',
  'returned',
  'transferred',
  'maintenanceStarted',
  'maintenanceCompleted',
  'warrantyUpdated',
  'disposed',
] as const;
export const ItAssetEventTypeSchema = z.enum(IT_ASSET_EVENT_TYPES);
export type ItAssetEventType = z.infer<typeof ItAssetEventTypeSchema>;

export interface ItAssetHistoryEntryDto {
  id: string;
  assetId: string;
  type: ItAssetEventType;
  at: string;
  actorUserId: string | null;
  /** Denormalized so the history survives a user rename or deactivation. */
  actorName: string;
  /**
   * Extra facts for the types that have them — empty for the ones that do not. Consumers switch
   * on `type` and never probe keys (design §2.3): a renderer that inspected metadata would break
   * silently the day a type stopped carrying a key.
   */
  metadata: Record<string, unknown>;
  notes: string | null;
}

export const ListItAssetHistoryQuerySchema = PaginationQuerySchema.extend({
  type: ItAssetEventTypeSchema.optional(),
}).strict();
export type ListItAssetHistoryQuery = z.infer<typeof ListItAssetHistoryQuerySchema>;

// ── Events (design §8.1) ────────────────────────────────────────────────────

export const ItEvents = {
  AssetRegistered: 'it.asset.registered',
  AssetUpdated: 'it.asset.updated',
  AssetAssigned: 'it.asset.assigned',
  AssetReturned: 'it.asset.returned',
  AssetTransferred: 'it.asset.transferred',
  AssetDisposed: 'it.asset.disposed',
  TicketOpened: 'it.ticket.opened',
  TicketAssigned: 'it.ticket.assigned',
  // ONE event for every transition. resolved / closed / reopened / cancelled are `to` VALUES an
  // automation filter selects, not four more event names (§8.1) — the vocabulary stays
  // one-name-per-fact, and only facts a filter cannot express get their own name.
  TicketStatusChanged: 'it.ticket.statusChanged',
  TicketSlaBreached: 'it.ticket.slaBreached',
} as const;
export type ItEventName = (typeof ItEvents)[keyof typeof ItEvents];

export const ItAssetEventPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  categoryId: objectId(),
});
export type ItAssetEventPayload = z.infer<typeof ItAssetEventPayloadV1>;

export const ItAssetAssignedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  employeeId: objectId(),
  assignmentId: objectId(),
});
export type ItAssetAssignedPayload = z.infer<typeof ItAssetAssignedPayloadV1>;

export const ItAssetReturnedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  employeeId: objectId(),
  condition: z.string().nullable(),
});
export type ItAssetReturnedPayload = z.infer<typeof ItAssetReturnedPayloadV1>;

export const ItAssetTransferredPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  fromEmployeeId: objectId().nullable(),
  toEmployeeId: objectId().nullable(),
  fromBranchId: objectId().nullable(),
  toBranchId: objectId().nullable(),
});
export type ItAssetTransferredPayload = z.infer<typeof ItAssetTransferredPayloadV1>;

export const ItAssetDisposedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  method: ItDisposalMethodSchema,
  reason: z.string(),
});
export type ItAssetDisposedPayload = z.infer<typeof ItAssetDisposedPayloadV1>;

// ── Help desk: priorities (design §2.6) ─────────────────────────────────────
//
// THE PRIORITY *IS* THE SLA POLICY. v1.0 of the design split them into two collections joined
// 1:1; that is normalization without a purpose — an admin tunes the name, the rank and the targets
// as one decision on one screen, and the module carries one collection and one grant less.

export interface ItTicketPriorityDto {
  id: string;
  name: { ar: string; en: string };
  /** Ordering and severity in one number; lower sorts first. */
  rank: number;
  responseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const priorityCore = {
  name: LocalizedStringSchema,
  rank: z.number().int().min(0).max(1000),
  responseMinutes: z.number().int().min(1).max(60 * 24 * 365),
  resolutionMinutes: z.number().int().min(1).max(60 * 24 * 365),
};

export const CreateItTicketPrioritySchema = z
  .object(priorityCore)
  .strict()
  .superRefine((value, ctx) => {
    if (value.resolutionMinutes < value.responseMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionMinutes'],
        message: 'the resolution target cannot be shorter than the response target',
      });
    }
  });
export type CreateItTicketPriority = z.infer<typeof CreateItTicketPrioritySchema>;

export const UpdateItTicketPrioritySchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    rank: priorityCore.rank.optional(),
    responseMinutes: priorityCore.responseMinutes.optional(),
    resolutionMinutes: priorityCore.resolutionMinutes.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItTicketPriority = z.infer<typeof UpdateItTicketPrioritySchema>;

export const ListItTicketPrioritiesQuerySchema = PaginationQuerySchema.extend({
  isActive: booleanQuery().optional(),
}).strict();
export type ListItTicketPrioritiesQuery = z.infer<typeof ListItTicketPrioritiesQuerySchema>;

// ── Help desk: tickets (design §2.6, §4.4) ──────────────────────────────────

export const IT_TICKET_STATUSES = [
  'open',
  'inProgress',
  'onHold',
  'resolved',
  'closed',
  'cancelled',
] as const;
export const ItTicketStatusSchema = z.enum(IT_TICKET_STATUSES);
export type ItTicketStatus = z.infer<typeof ItTicketStatusSchema>;

/** Which clock a breach belongs to (§4.5). Stamped once per phase, never cleared. */
export const IT_SLA_PHASES = ['response', 'resolution'] as const;
export const ItSlaPhaseSchema = z.enum(IT_SLA_PHASES);
export type ItSlaPhase = z.infer<typeof ItSlaPhaseSchema>;

/**
 * The SLA state of one ticket.
 *
 * `policy` is a SNAPSHOT taken at creation, not a reference: editing a priority later must not
 * rewrite history or move a running clock (the contract-template-versioning reasoning). Breach
 * stamps are set once and never cleared — a late resolution does not un-breach the ticket, and
 * reports read the stamps rather than recomputing a clock (FR-6).
 */
export interface ItTicketSlaDto {
  policy: { responseMinutes: number; resolutionMinutes: number };
  responseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string | null;
  responseBreachedAt: string | null;
  resolutionBreachedAt: string | null;
  /** Milliseconds the resolution clock spent paused in `onHold`. The response clock never pauses. */
  pausedMs: number;
  holdStartedAt: string | null;
}

export interface ItTicketResolutionDto {
  summary: string;
  resolvedByUserId: string;
  resolvedAt: string;
}

export interface ItTicketDto {
  id: string;
  ticketCode: string;
  title: string;
  description: string;
  requesterUserId: string;
  branchId: string | null;
  categoryId: string;
  priorityId: string;
  assetId: string | null;
  assignedTechnicianUserId: string | null;
  status: ItTicketStatus;
  sla: ItTicketSlaDto;
  resolution: ItTicketResolutionDto | null;
  closedAt: string | null;
  reopenCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `ticketCode`, `status`, `sla`, `resolution`, `reopenCount` and `requesterUserId` are all
 * SERVER-owned and appear on no write schema. The code comes from the sequence (FR-1), the status
 * only from a named transition (§4.4), the SLA from the snapshot at creation (§4.5), and the
 * requester from the authenticated caller — a client that could name a requester could open a
 * ticket as someone else.
 */
const ticketCore = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  categoryId: objectId(),
  priorityId: objectId(),
  assetId: objectId().optional(),
};

export const CreateItTicketSchema = z.object(ticketCore).strict();
export type CreateItTicket = z.infer<typeof CreateItTicketSchema>;

/** Editing the ticket's own fields. Status moves through its named actions, never through here. */
export const UpdateItTicketSchema = z
  .object({
    title: ticketCore.title.optional(),
    description: ticketCore.description.optional(),
    categoryId: objectId().optional(),
    priorityId: objectId().optional(),
    assetId: objectId().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItTicket = z.infer<typeof UpdateItTicketSchema>;

export const AssignItTicketSchema = z
  .object({ technicianUserId: objectId(), note: z.string().trim().max(2000).optional() })
  .strict();
export type AssignItTicket = z.infer<typeof AssignItTicketSchema>;

/**
 * The generic transition, for the moves that carry no extra payload: start work, put on hold,
 * take off hold. `resolve`, `close`, `reopen` and `cancel` have their own endpoints because each
 * carries a different required fact — but ALL of them emit one `statusChanged` event and write one
 * `statusChanged` history row (§8.1: `to` is a filter, not four more event names).
 */
export const ChangeItTicketStatusSchema = z
  .object({
    to: z.enum(['inProgress', 'onHold']),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // §4.4: going on hold requires a reason — the pause has to be explainable later.
    if (value.to === 'onHold' && (value.reason === undefined || value.reason.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'putting a ticket on hold requires a reason',
      });
    }
  });
export type ChangeItTicketStatus = z.infer<typeof ChangeItTicketStatusSchema>;

export const ResolveItTicketSchema = z
  .object({ summary: z.string().trim().min(1).max(5000) })
  .strict();
export type ResolveItTicket = z.infer<typeof ResolveItTicketSchema>;

export const CloseItTicketSchema = z
  .object({ note: z.string().trim().max(2000).optional() })
  .strict();
export type CloseItTicket = z.infer<typeof CloseItTicketSchema>;

export const ReopenItTicketSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();
export type ReopenItTicket = z.infer<typeof ReopenItTicketSchema>;

export const CancelItTicketSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();
export type CancelItTicket = z.infer<typeof CancelItTicketSchema>;

export const ListItTicketsQuerySchema = PaginationQuerySchema.extend({
  /** Matches the code, the title and the description — the strings a dispatcher has. */
  search: z.string().trim().max(200).optional(),
  status: ItTicketStatusSchema.optional(),
  categoryId: objectId().optional(),
  priorityId: objectId().optional(),
  assetId: objectId().optional(),
  branchId: objectId().optional(),
  assignedTechnicianUserId: objectId().optional(),
  /** `true` → only the caller's own tickets. The requester view (FR-8). */
  mine: booleanQuery().optional(),
  /** `true` → only tickets that have breached either clock. Reads the STAMPS, never a clock. */
  breached: booleanQuery().optional(),
  /** `true` → open/inProgress/onHold; `false` → resolved/closed/cancelled. */
  active: booleanQuery().optional(),
}).strict();
export type ListItTicketsQuery = z.infer<typeof ListItTicketsQuerySchema>;

// ── Help desk: the ticket stream (design §2.6) ──────────────────────────────
//
// ONE append-only collection that is both the history AND the conversation — the recruitment
// timeline precedent, where notes are entries rather than a sibling collection. The ticket page
// renders it as-is: no interleaving of two sources, no ordering ambiguity.

export const IT_TICKET_EVENT_TYPES = [
  'opened',
  'assigned',
  'statusChanged',
  'priorityChanged',
  'commented',
  'slaBreached',
] as const;
export const ItTicketEventTypeSchema = z.enum(IT_TICKET_EVENT_TYPES);
export type ItTicketEventType = z.infer<typeof ItTicketEventTypeSchema>;

export const IT_COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export const ItCommentVisibilitySchema = z.enum(IT_COMMENT_VISIBILITIES);
export type ItCommentVisibility = z.infer<typeof ItCommentVisibilitySchema>;

export interface ItTicketEventDto {
  id: string;
  ticketId: string;
  type: ItTicketEventType;
  at: string;
  actorUserId: string | null;
  actorName: string;
  /** Populated on `statusChanged` rows; null elsewhere. Typed fields, not metadata probing. */
  fromStatus: ItTicketStatus | null;
  toStatus: ItTicketStatus | null;
  /** Populated on `commented` rows; null elsewhere. */
  body: string | null;
  visibility: ItCommentVisibility | null;
  metadata: Record<string, unknown>;
  notes: string | null;
}

/**
 * Posting a comment. `visibility` defaults to `public` deliberately: the safe default is the one
 * the requester can see, so an internal note is always a conscious choice rather than an accident
 * of a missing field. Only holders of `itTicket.edit` may post `internal` (§7, FR-7).
 */
export const CreateItTicketCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    visibility: ItCommentVisibilitySchema.default('public'),
  })
  .strict();
export type CreateItTicketComment = z.infer<typeof CreateItTicketCommentSchema>;

export const ListItTicketEventsQuerySchema = PaginationQuerySchema.extend({
  type: ItTicketEventTypeSchema.optional(),
}).strict();
export type ListItTicketEventsQuery = z.infer<typeof ListItTicketEventsQuerySchema>;

// ── Help desk: settings (design §8.3) ───────────────────────────────────────

export const ItSettingKeys = {
  /** Percentage of the SLA window after which a ticket counts as at risk (a dashboard query). */
  SlaAtRiskPercent: 'it.sla.atRiskPercent',
  /** Days a `resolved` ticket waits before the sweep closes it. 0 disables auto-close. */
  TicketAutoCloseDays: 'it.ticket.autoCloseDays',
} as const;
export type ItSettingKey = (typeof ItSettingKeys)[keyof typeof ItSettingKeys];

export const ItTicketOpenedPayloadV1 = z.object({
  ticketId: objectId(),
  ticketCode: z.string(),
  categoryId: objectId(),
  priorityId: objectId(),
  requesterUserId: objectId(),
  assetId: objectId().nullable(),
});
export type ItTicketOpenedPayload = z.infer<typeof ItTicketOpenedPayloadV1>;

export const ItTicketAssignedPayloadV1 = z.object({
  ticketId: objectId(),
  ticketCode: z.string(),
  technicianUserId: objectId(),
});
export type ItTicketAssignedPayload = z.infer<typeof ItTicketAssignedPayloadV1>;

export const ItTicketStatusChangedPayloadV1 = z.object({
  ticketId: objectId(),
  ticketCode: z.string(),
  from: ItTicketStatusSchema,
  to: ItTicketStatusSchema,
  summary: z.string().nullable(),
});
export type ItTicketStatusChangedPayload = z.infer<typeof ItTicketStatusChangedPayloadV1>;

export const ItTicketSlaBreachedPayloadV1 = z.object({
  ticketId: objectId(),
  ticketCode: z.string(),
  phase: ItSlaPhaseSchema,
  dueAt: z.string(),
});
export type ItTicketSlaBreachedPayload = z.infer<typeof ItTicketSlaBreachedPayloadV1>;
