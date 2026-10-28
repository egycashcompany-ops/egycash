import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../mobile-lines/ensure-collection';
import { ItConsumableMemoModel, type ItConsumableMemoDoc } from './consumable-memo.model';

class ItConsumableMemoRepository extends BaseRepository<ItConsumableMemoDoc> {
  readonly ensureCollection = collectionReady(ItConsumableMemoModel);

  constructor() {
    // Branch-scoped on the store the memo's items came from, like the items themselves.
    super(ItConsumableMemoModel, { branchField: 'branchId' });
  }
}

export const itConsumableMemoRepository = new ItConsumableMemoRepository();
