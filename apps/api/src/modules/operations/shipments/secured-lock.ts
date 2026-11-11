// The vault's lock on a secured (محصنة) shipment — Round 10.
//
// «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من القادة او العمليات او الخزنه يعدل عليها»: once
// the vault has signed for a محصنة, its data is history. The rule itself is one pure function in the
// contracts (`isOperationsShipmentLocked`), shared with the screens so a button and the server can
// never disagree; this file is the server's refusal, in one spelling, for every write that changes
// the shipment's data (the shipment service, the pickup crew, the desk's pickup ✓).
//
// It lives apart from shipment.service.ts on purpose: the assignment service needs it too, and
// shipment.service already imports the assignment service, so a shared home avoids an import cycle.
import { ErrorCodes, isOperationsShipmentLocked } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { type OperationsShipmentDoc } from './shipment.model';

/**
 * 409 `OPERATIONS_SECURED_LOCKED` when the vault has received this secured shipment (any status but
 * `draft`). `what` names the refused act in the message, so a log line says what was tried.
 *
 * The way back is the cancelled receipt (`operationsVault.cancelReceipt`), never a quieter path.
 */
export const assertSecuredUnlocked = (
  shipment: Pick<OperationsShipmentDoc, 'shipmentType' | 'status'>,
  what: string,
): void => {
  if (isOperationsShipmentLocked(shipment)) {
    throw new ConflictError(
      `the vault has received this secured shipment (it is '${shipment.status}') — ${what} is locked; only a cancelled vault receipt reopens it`,
      ErrorCodes.OPERATIONS_SECURED_LOCKED,
    );
  }
};
