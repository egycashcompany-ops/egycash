import { type FilterQuery } from 'mongoose';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { type Paginated } from '@ecms/contracts';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';

class FleetVehicleRepository extends BaseRepository<FleetVehicleDoc> {
  constructor() {
    // Vehicles are branch-scoped assets (design §7): a branch-scoped caller sees that branch's
    // fleet, exactly as the legacy hardcoded `المهندسين` filter intended (§13-Q4 answered).
    super(FleetVehicleModel, { branchField: 'branchId', departmentField: 'departmentId' });
  }

  async findByCode(code: string): Promise<FleetVehicleDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<FleetVehicleDoc>().exec();
  }

  async listVehicles(params: ListParams<FleetVehicleDoc>): Promise<Paginated<FleetVehicleDoc>> {
    return this.list({ ...params, sortableFields: ['code', 'createdAt', 'licenseExpiresAt'] });
  }
}

const escaped = (term: string): RegExp =>
  new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** Substring search over the four physical identifiers at once (design §2.1 list page). */
export const vehicleSearchFilter = (term: string): FilterQuery<FleetVehicleDoc> => {
  const rx = escaped(term);
  return {
    $or: [{ code: rx }, { plateNumber: rx }, { chassisNumber: rx }, { motorNumber: rx }],
  };
};

/**
 * ONE identifier, narrowed. The per-column filters are ANDed by the caller, which is what makes
 * "plate 123 AND chassis ABC" answerable — `vehicleSearchFilter` can only ever answer "either".
 */
export const vehicleIdentifierFilter = (
  field: 'code' | 'plateNumber' | 'chassisNumber' | 'motorNumber',
  term: string,
): FilterQuery<FleetVehicleDoc> => ({ [field]: escaped(term) }) as FilterQuery<FleetVehicleDoc>;

export const fleetVehicleRepository = new FleetVehicleRepository();
