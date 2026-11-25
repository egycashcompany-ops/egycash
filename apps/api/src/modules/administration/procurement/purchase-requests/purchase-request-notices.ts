// Who a purchase request's acts tell (P2 plan §11.1; OD-61 A): each notice after the act's commit,
// best-effort — a notice must never undo an act that was rightly recorded, so a failed send, a
// missing template among them, is swallowed; the module's seed spec is what keeps every template
// it sends seeded (RK-22). Each carries the request's `entityRef` and its number, and nothing
// personal. The approvers' notice ships with the submission (P2.3); the requester's, procurement's
// and the stuck notice with the acts that send them (P2.4, P2.5, P2.7).
import { AdministrationTemplates } from '@ecms/contracts';
import { notificationsService } from '../../../../platform/notifications';
import { purchaseRequestEntityRef } from './purchase-request-audit';
import type { AdministrationPurchaseRequestDoc } from './purchase-request.model';

/**
 * The live rung's eligible approvers are told the request awaits their decision — by name, as the
 * engine read them, never by a key, so a holder of the key on another rung hears nothing of it.
 */
export const notifyAwaitingDecision = async (
  doc: AdministrationPurchaseRequestDoc,
  approvers: readonly string[],
): Promise<void> => {
  if (approvers.length === 0 || doc.number === null) return;
  await notificationsService
    .notify({
      template: AdministrationTemplates.PurchaseRequestAwaitingDecision,
      to: { userIds: [...approvers] },
      data: { number: doc.number },
      entityRef: purchaseRequestEntityRef(String(doc._id)),
    })
    .catch(() => undefined);
};
