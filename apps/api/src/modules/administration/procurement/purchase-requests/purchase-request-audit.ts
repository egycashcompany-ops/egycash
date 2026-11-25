// What a purchase request's writes leave behind, after the write (design §9.1, §10.1–§10.2): one
// audit row per act under its §10.2 verb, and — after EVERY act, whatever its verb — one `update`
// signal WITH the request's branch.
//
// Why a signal after every act: the audit row announces itself to the organization-wide room only
// (it names no branch), and a requester holds `.view` at department scope, which joins only their
// branch's room (OD-16 A). Without the branch signal, a draft saved, a decision taken or a request
// cancelled in their branch would refresh nobody's screen there. Later verbs — `statusChange`,
// `approvalDecision`, `cancel` — are not all broadcast, so the signal is what carries them (P2 plan
// §10.1). IT's `signalConsumable` precedent, as the warehouse's.
import { auditService } from '../../../../platform/audit';
import { publishAuditedChange } from '../../../../platform/realtime';
import { diffChanges } from '../../../../shared/utils/diff';
import type { AdministrationPurchaseRequestDoc } from './purchase-request.model';

/** The audited request — a LITERAL pair, so the realtime registry's scan can classify it. */
export const purchaseRequestEntityRef = (id: string) => ({
  moduleId: 'administration',
  entityType: 'purchaseRequest',
  entityId: id,
});

/** A stored date-only value as its Cairo day, 'YYYY-MM-DD'. */
const dayOf = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10);

/**
 * The request's facts as the trail compares them (design §10.1: lines summarized). Ids for the
 * references and the requester — the trail is a security record HR's permanent delete never
 * rewrites, so it copies no person's name, only the id the request already holds — and each line
 * as its item's code, its quantity and its notes: what a reader of the trail asks of a draft's
 * edit. The snapshots' names are left out; they are the item's and the branch's, read from them.
 */
export const purchaseRequestSnapshot = (
  doc: AdministrationPurchaseRequestDoc,
): Record<string, unknown> => ({
  number: doc.number,
  status: doc.status,
  orderStatus: doc.orderStatus,
  branchId: String(doc.branchId),
  departmentId: String(doc.departmentId),
  requesterUserId: String(doc.requesterUserId),
  requesterEmployeeId: String(doc.requesterEmployeeId),
  neededBy: dayOf(doc.neededBy),
  justification: doc.justification,
  notes: doc.notes,
  lines: doc.lines.map((line) => ({ itemCode: line.itemCode, qty: line.qty, notes: line.notes })),
});

/** The request's topic, WITH its branch: the organization room and that branch's room both. */
export const signalPurchaseRequest = (id: string, branchId: string): void => {
  publishAuditedChange({
    entityRef: purchaseRequestEntityRef(id),
    action: 'update',
    at: new Date().toISOString(),
    branchId,
  });
};

/** A draft created: one `create` row, then its signal. */
export const auditPurchaseRequestCreated = async (
  doc: AdministrationPurchaseRequestDoc,
): Promise<void> => {
  const id = String(doc._id);
  await auditService.record({
    entityRef: purchaseRequestEntityRef(id),
    action: 'create',
    changes: diffChanges({}, purchaseRequestSnapshot(doc)),
  });
  signalPurchaseRequest(id, String(doc.branchId));
};

/**
 * A draft edited: one `update` row and its signal — and nothing at all when the facts the trail
 * compares did not change (design §10.2), a save that only refreshed the snapshots.
 */
export const auditPurchaseRequestEdited = async (
  before: AdministrationPurchaseRequestDoc,
  after: AdministrationPurchaseRequestDoc,
): Promise<void> => {
  const changes = diffChanges(purchaseRequestSnapshot(before), purchaseRequestSnapshot(after));
  if (changes.length === 0) return;
  const id = String(after._id);
  await auditService.record({
    entityRef: purchaseRequestEntityRef(id),
    action: 'update',
    changes,
  });
  signalPurchaseRequest(id, String(after.branchId));
};
