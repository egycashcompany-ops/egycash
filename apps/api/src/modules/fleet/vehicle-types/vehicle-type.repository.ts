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

  async findActiveById(id: string): Promise<FleetVehicleTypeDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.isActive ? doc : null;
  }
}

export const fleetVehicleTypeRepository = new FleetVehicleTypeRepository();
