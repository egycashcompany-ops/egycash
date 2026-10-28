// The consumables' ledger (ADR-024's shape). It inherits `create` and the readers from the base and
// adds nothing that changes a row — no update, no delete, no correction in place. A mistaken
// movement is corrected by an opposing one, which is what keeps every on-hand figure explainable,
// and the missing methods are the cheapest enforcement of that.
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../mobile-lines/ensure-collection';
import {
  ItConsumableMovementModel,
  type ItConsumableMovementDoc,
} from './consumable-movement.model';

class ItConsumableMovementRepository extends BaseRepository<ItConsumableMovementDoc> {
  readonly ensureCollection = collectionReady(ItConsumableMovementModel);

  constructor() {
    // Scoped on the item's store, which a movement copies and an item never changes.
    super(ItConsumableMovementModel, { branchField: 'branchId' });
  }
}

export const itConsumableMovementRepository = new ItConsumableMovementRepository();
