import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetVehicleTypeModel, type FleetVehicleTypeDoc } from './vehicle-type.model';

class FleetVehicleTypeRepository extends BaseRepository<FleetVehicleTypeDoc> {
  constructor() {
    super(FleetVehicleTypeModel, {}); // organization-level catalog, no org scoping
  }

  async findByNameAr(nameAr: string): Promise<FleetVehicleTypeDoc | null> {
    return this.model
      .findOne({ 'name.ar': nameAr, isDeleted: false })
      .lean<FleetVehicleTypeDoc>()
      .exec();
  }

  /** Every live type — the dashboard names a matrix row per type and there are a handful. */
  async listAll(): Promise<FleetVehicleTypeDoc[]> {
    return this.model.find({ isDeleted: false }).lean<FleetVehicleTypeDoc[]>().exec();
  }

  /**
   * Write the makes' order: each id gets its position, in one `bulkWrite`. The version is left
   * alone — a place in a list is not a fact the edit dialog carries — as the catalogs' order is.
   */
  async writeOrder(ids: readonly Types.ObjectId[], by: string | null): Promise<void> {
    if (ids.length === 0) return;
    const updatedBy = by === null ? null : new Types.ObjectId(by);
    await this.model.bulkWrite(
      ids.map((_id, index) => ({
        updateOne: { filter: { _id }, update: { $set: { sortOrder: index, updatedBy } } },
      })),
    );
  }

  /** The highest place used in the makes' list, or null when it has never been arranged. */
  async maxOrder(): Promise<number | null> {
    const top = await this.model
      .findOne({ isDeleted: false, sortOrder: { $ne: null } })
      .sort({ sortOrder: -1 })
      .select({ sortOrder: 1 })
      .lean<{ sortOrder: number | null }>()
      .exec();
    return top?.sortOrder ?? null;
  }

  async findActiveById(id: string): Promise<FleetVehicleTypeDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.isActive ? doc : null;
  }
}

export const fleetVehicleTypeRepository = new FleetVehicleTypeRepository();
