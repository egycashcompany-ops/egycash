// The purchase request's line lock registers with the item feature as this index loads, with the
// manifest (design §3.6): from then on an item edit that changes a unit asks it.
import './purchase-request-item-lock';

export { buildAdministrationPurchaseRequestsRouter } from './purchase-request.routes';
export {
  administrationPurchaseRequestService,
  ensurePurchaseRequestNumberCounter,
} from './purchase-request.service';
