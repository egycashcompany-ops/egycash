import { type ListItSoftwareProductsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItSoftwareProductModel, type ItSoftwareProductDoc } from './product.model';

class ItSoftwareProductRepository extends BaseRepository<ItSoftwareProductDoc> {
  constructor() {
    // Company-wide reference data, like vendors: a product is not owned by a branch, and giving it
    // a branch dimension would invent a business fact §7 does not describe.
    super(ItSoftwareProductModel, {});
  }

  /** Uniqueness pre-check — produces the good error message; `ux_product_name` is what holds. */
  async findByName(name: string): Promise<ItSoftwareProductDoc | null> {
    return this.model.findOne({ name, isDeleted: false }).lean<ItSoftwareProductDoc>().exec();
  }

  async listFiltered(
    query: ListItSoftwareProductsQuery,
  ): Promise<Paginated<ItSoftwareProductDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { publisher: pattern }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'publisher', 'createdAt'],
    });
  }
}

export const itSoftwareProductRepository = new ItSoftwareProductRepository();
