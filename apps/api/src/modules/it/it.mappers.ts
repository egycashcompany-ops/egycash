// Doc → DTO mapping for the IT-1 entities. Derived facts stay derived — the mapper never invents
// one (the fleet FR-12 discipline).
import {
  type ItMaintenanceOrderDto,
  type ItMaintenancePlanDto,
  type ItSparePartDto,
  type ItSparePartMovementDto,
  type ItTicketDto,
  type ItTicketEventDto,
  type ItTicketPriorityDto,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItAssetHistoryEntryDto,
  type ItCatalogItemDto,
  type ItVendorDto,
} from '@ecms/contracts';
import { type ItCatalogItemDoc } from './catalog-items/catalog-item.model';
import { type ItVendorDoc } from './vendors/vendor.model';
import { type ItAssetDoc } from './assets/asset.model';
import { type ItAssetAssignmentDoc } from './assets/assignment.model';
import { type ItAssetEventDoc } from './assets/asset-event.model';
import { type ItTicketDoc } from './tickets/ticket.model';
import { type ItTicketEventDoc } from './tickets/ticket-event.model';
import { type ItTicketPriorityDoc } from './tickets/priority.model';
import { type ItMaintenancePlanDoc } from './maintenance/plan.model';
import { type ItMaintenanceOrderDoc } from './maintenance/order.model';
import { type ItSparePartDoc } from './spare-parts/part.model';
import { type ItSparePartMovementDoc } from './spare-parts/movement.model';

const iso = (d: Date): string => d.toISOString();

export const toItCatalogItemDto = (doc: ItCatalogItemDoc): ItCatalogItemDto => ({
  id: String(doc._id),
  kind: doc.kind,
  code: doc.code,
  name: doc.name,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItVendorDto = (doc: ItVendorDoc): ItVendorDto => ({
  id: String(doc._id),
  name: doc.name,
  code: doc.code,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  services: doc.services,
  contacts: doc.contacts.map((c) => ({
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
  })),
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItAssetDto = (doc: ItAssetDoc): ItAssetDto => ({
  id: String(doc._id),
  assetCode: doc.assetCode,
  name: doc.name,
  description: doc.description,
  categoryId: String(doc.categoryId),
  status: doc.status,
  serialNumber: doc.serialNumber,
  model: doc.model,
  manufacturer: doc.manufacturer,
  externalTag: doc.externalTag,
  branchId: String(doc.branchId),
  location: doc.location,
  currentAssignmentId: doc.currentAssignmentId === null ? null : String(doc.currentAssignmentId),
  disposal:
    doc.disposal === null
      ? null
      : {
          at: iso(doc.disposal.at),
          method: doc.disposal.method,
          reason: doc.disposal.reason,
          notes: doc.disposal.notes,
        },
  purchase:
    doc.purchase === null
      ? null
      : {
          date: doc.purchase.date === null ? null : iso(doc.purchase.date),
          cost: doc.purchase.cost,
          vendorId: doc.purchase.vendorId === null ? null : String(doc.purchase.vendorId),
          invoiceRef: doc.purchase.invoiceRef,
        },
  warranty:
    doc.warranty === null
      ? null
      : {
          vendorId: doc.warranty.vendorId === null ? null : String(doc.warranty.vendorId),
          start: iso(doc.warranty.start),
          end: iso(doc.warranty.end),
          terms: doc.warranty.terms,
        },
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItAssetAssignmentDto = (doc: ItAssetAssignmentDoc): ItAssetAssignmentDto => ({
  id: String(doc._id),
  assetId: String(doc.assetId),
  assignedToEmployeeId: String(doc.assignedToEmployeeId),
  assignedByUserId: doc.assignedByUserId === null ? null : String(doc.assignedByUserId),
  assignedAt: iso(doc.assignedAt),
  conditionOnIssue: doc.conditionOnIssue,
  expectedReturnAt: doc.expectedReturnAt === null ? null : iso(doc.expectedReturnAt),
  returnedAt: doc.returnedAt === null ? null : iso(doc.returnedAt),
  returnedToUserId: doc.returnedToUserId === null ? null : String(doc.returnedToUserId),
  conditionOnReturn: doc.conditionOnReturn,
  notes: doc.notes,
  branchId: String(doc.branchId),
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * History entry (design §2.3). The stored key is `subjectId` — uniform across the module's
 * timelines — and the API names it `assetId`, which is what a reader of this endpoint expects.
 *
 * `metadata` defaults to `{}` on the way out as well as in the schema: the collection sets
 * `minimize: false` so an empty object survives the round trip, and this is the second belt for a
 * row that predates that (PR #117's lesson, applied at both ends).
 */
export const toItAssetHistoryEntryDto = (doc: ItAssetEventDoc): ItAssetHistoryEntryDto => ({
  id: String(doc._id),
  assetId: String(doc.subjectId),
  type: doc.type,
  at: iso(doc.at),
  actorUserId: doc.actorUserId === null ? null : String(doc.actorUserId),
  actorName: doc.actorName,
  metadata: doc.metadata ?? {},
  notes: doc.notes,
});

// ── Help desk (IT-3) ────────────────────────────────────────────────────────

export const toItTicketPriorityDto = (doc: ItTicketPriorityDoc): ItTicketPriorityDto => ({
  id: String(doc._id),
  name: doc.name,
  rank: doc.rank,
  responseMinutes: doc.responseMinutes,
  resolutionMinutes: doc.resolutionMinutes,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItTicketDto = (doc: ItTicketDoc): ItTicketDto => ({
  id: String(doc._id),
  ticketCode: doc.ticketCode,
  title: doc.title,
  description: doc.description,
  requesterUserId: String(doc.requesterUserId),
  branchId: doc.branchId === null ? null : String(doc.branchId),
  categoryId: String(doc.categoryId),
  priorityId: String(doc.priorityId),
  assetId: doc.assetId === null ? null : String(doc.assetId),
  assignedTechnicianUserId:
    doc.assignedTechnicianUserId === null ? null : String(doc.assignedTechnicianUserId),
  status: doc.status,
  sla: {
    policy: {
      responseMinutes: doc.sla.policy.responseMinutes,
      resolutionMinutes: doc.sla.policy.resolutionMinutes,
    },
    responseDueAt: iso(doc.sla.responseDueAt),
    resolutionDueAt: iso(doc.sla.resolutionDueAt),
    firstResponseAt: doc.sla.firstResponseAt === null ? null : iso(doc.sla.firstResponseAt),
    responseBreachedAt:
      doc.sla.responseBreachedAt === null ? null : iso(doc.sla.responseBreachedAt),
    resolutionBreachedAt:
      doc.sla.resolutionBreachedAt === null ? null : iso(doc.sla.resolutionBreachedAt),
    pausedMs: doc.sla.pausedMs,
    holdStartedAt: doc.sla.holdStartedAt === null ? null : iso(doc.sla.holdStartedAt),
  },
  resolution:
    doc.resolution === null
      ? null
      : {
          summary: doc.resolution.summary,
          resolvedByUserId: String(doc.resolution.resolvedByUserId),
          resolvedAt: iso(doc.resolution.resolvedAt),
        },
  closedAt: doc.closedAt === null ? null : iso(doc.closedAt),
  reopenCount: doc.reopenCount,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * A stream entry.
 *
 * @param includeInternal the caller's `itTicket.edit`. The repository already excludes internal
 * rows from the QUERY for anyone without it (FR-7) — this redaction is the second belt: if such a
 * row ever reached here through a future code path, the body still does not go over the wire.
 */
export const toItTicketEventDto = (
  doc: ItTicketEventDoc,
  includeInternal: boolean,
): ItTicketEventDto => {
  const redacted = doc.visibility === 'internal' && !includeInternal;
  return {
    id: String(doc._id),
    ticketId: String(doc.subjectId),
    type: doc.type,
    at: iso(doc.at),
    actorUserId: doc.actorUserId === null ? null : String(doc.actorUserId),
    actorName: doc.actorName,
    fromStatus: doc.fromStatus,
    toStatus: doc.toStatus,
    body: redacted ? null : doc.body,
    visibility: doc.visibility,
    metadata: doc.metadata ?? {},
    notes: doc.notes,
  };
};

// ── Maintenance and the spare-parts store (IT-4) ────────────────────────────

export const toItMaintenancePlanDto = (doc: ItMaintenancePlanDoc): ItMaintenancePlanDto => ({
  id: String(doc._id),
  assetId: String(doc.assetId),
  name: doc.name,
  intervalDays: doc.intervalDays,
  checklist: doc.checklist,
  lastCompletedAt: doc.lastCompletedAt === null ? null : iso(doc.lastCompletedAt),
  nextDueAt: iso(doc.nextDueAt),
  active: doc.active,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * An order. Its consumed parts are deliberately NOT here: they are movement rows keyed by `orderId`
 * (ADR-024), read through `GET /it/maintenance-orders/:id/parts`. Embedding them would put a second
 * copy of the ledger on the wire, and a mapper that assembled one would be inventing a fact.
 */
export const toItMaintenanceOrderDto = (doc: ItMaintenanceOrderDoc): ItMaintenanceOrderDto => ({
  id: String(doc._id),
  orderCode: doc.orderCode,
  kind: doc.kind,
  assetId: String(doc.assetId),
  planId: doc.planId === null ? null : String(doc.planId),
  ticketId: doc.ticketId === null ? null : String(doc.ticketId),
  status: doc.status,
  scheduledFor: doc.scheduledFor === null ? null : iso(doc.scheduledFor),
  startedAt: doc.startedAt === null ? null : iso(doc.startedAt),
  completedAt: doc.completedAt === null ? null : iso(doc.completedAt),
  performedByUserId: doc.performedByUserId === null ? null : String(doc.performedByUserId),
  vendorId: doc.vendorId === null ? null : String(doc.vendorId),
  cost: doc.cost,
  summary: doc.summary,
  assetStatusBefore: doc.assetStatusBefore,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItSparePartDto = (doc: ItSparePartDoc): ItSparePartDto => ({
  id: String(doc._id),
  partCode: doc.partCode,
  name: doc.name,
  unit: doc.unit,
  onHandQty: doc.onHandQty,
  minQty: doc.minQty,
  active: doc.active,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/** A ledger row carries no `version`: it is append-only, so there is nothing to edit optimistically. */
export const toItSparePartMovementDto = (
  doc: ItSparePartMovementDoc,
): ItSparePartMovementDto => ({
  id: String(doc._id),
  partId: String(doc.partId),
  qty: doc.qty,
  orderId: doc.orderId === null ? null : String(doc.orderId),
  at: iso(doc.at),
  byUserId: doc.byUserId === null ? null : String(doc.byUserId),
  note: doc.note,
  createdAt: iso(doc.createdAt),
});
