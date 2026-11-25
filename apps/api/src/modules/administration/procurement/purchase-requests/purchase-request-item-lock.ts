// The purchase request's answer to "does a line name this item in its unit?" (design §2.3.4,
// §3.6): registered with the item feature at module load, so an item edit that changes the unit
// asks it first (`ADMINISTRATION_ITEM_UNIT_LOCKED`). The first registrant of the item's registry
// (P2.2); a hint, not the guard — P5's posting is that.
import { registerItemReferenceChecker } from '../../catalog/items/index';
import { administrationPurchaseRequestRepository as repository } from './purchase-request.repository';

registerItemReferenceChecker(async (itemId) =>
  (await repository.namesItem(itemId)) ? 'purchaseRequestLine' : null,
);
