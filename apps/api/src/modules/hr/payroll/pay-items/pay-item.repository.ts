import { BaseRepository } from '../../../../shared/base/base.repository';
import { PayItemModel, type PayItemDoc } from './pay-item.model';

class PayItemRepository extends BaseRepository<PayItemDoc> {
  constructor() {
    super(PayItemModel, {}); // an organization-wide catalog: no branch or own axis
  }
}

export const payItemRepository = new PayItemRepository();
