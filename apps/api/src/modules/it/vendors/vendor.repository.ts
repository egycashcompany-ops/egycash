import { BaseRepository } from '../../../shared/base/base.repository';
import { ItVendorModel, type ItVendorDoc } from './vendor.model';

class ItVendorRepository extends BaseRepository<ItVendorDoc> {
  constructor() {
    super(ItVendorModel, {}); // organization-level reference data, no org scoping
  }

  async findByName(name: string): Promise<ItVendorDoc | null> {
    return this.model.findOne({ name, isDeleted: false }).lean<ItVendorDoc>().exec();
  }

  /** Active vendor or null — the reference check asset writes run before storing a vendorId. */
  async findActive(id: string): Promise<ItVendorDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.isActive ? doc : null;
  }
}

export const itVendorRepository = new ItVendorRepository();
