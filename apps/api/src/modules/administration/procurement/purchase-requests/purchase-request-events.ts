// What a purchase request tells the rest of the system (design §8; P2 plan §10.3): one emitting
// helper per event name, each an in-process emit after the act's commit with its payload written
// as an object literal, one key per line — the form the platform's publisher scan reads its keys
// in (design §8.1). Facts only: ids, the number, the scope a filter needs, a count; no names, no
// free text, no amounts. Nothing that happens to a draft is an event, and a return emits nothing
// (design §8.2), so the first fact is the submission; the decisions and the cancel join with their
// acts (P2.4, P2.5).
import { AdministrationEvents } from '@ecms/contracts';
import { emit } from '../../../../platform/kernel/event-bus';
import type { AdministrationPurchaseRequestDoc } from './purchase-request.model';

/** A draft left for its chain, numbered (design §5.4 row 2): after the submission's commit. */
export const announcePurchaseRequestSubmitted = async (
  doc: AdministrationPurchaseRequestDoc,
): Promise<void> => {
  await emit(AdministrationEvents.PurchaseRequestSubmitted, {
    purchaseRequestId: String(doc._id),
    number: doc.number,
    branchId: String(doc.branchId),
    lineCount: doc.lines.length,
    departmentId: String(doc.departmentId),
    requesterUserId: String(doc.requesterUserId),
    requesterEmployeeId: String(doc.requesterEmployeeId),
  });
};
