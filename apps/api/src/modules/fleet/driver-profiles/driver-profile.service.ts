// Driver profiles (fleet design §2.3, FR-11). Creation validates the employee through the
// platform directory seam — Fleet never imports HR — and refuses an exited employee: a profile
// is an operational capability, and you cannot enroll someone who is no longer employed.
// No domain events: the frozen surface (§8) has none for profiles; enrollment is configuration.
import {
  type CreateFleetDriverProfile,
  type ListFleetDriversQuery,
  type Paginated,
  type UpdateFleetDriverProfile,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetDriverProfileRepository } from './driver-profile.repository';
import { DRIVER_PROFILE_KIND, type FleetDriverProfileDoc } from './driver-profile.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'driverProfile',
  entityId: id,
});

const snapshot = (doc: FleetDriverProfileDoc) => ({
  employeeId: String(doc.employeeId),
  licenseNumber: doc.licenseNumber,
  licenseExpiresAt: doc.licenseExpiresAt,
  specialization: doc.specialization,
  area: doc.area,
  isActive: doc.isActive,
});

class FleetDriverProfileService {
  async create(input: CreateFleetDriverProfile, by: string): Promise<FleetDriverProfileDoc> {
    const employee = await getDirectoryEmployee(input.employeeId);
    if (employee === null) {
      throw new ValidationError([
        { field: 'body.employeeId', code: 'UNKNOWN', message: 'employee not found' },
      ]);
    }
    if (employee.status === 'exited') {
      throw new ConflictError('an exited employee cannot be enrolled as a driver');
    }
    const existing = await fleetDriverProfileRepository.findDriverByEmployeeId(input.employeeId);
    if (existing !== null) {
      throw new ConflictError(`employee ${employee.code} already has a driver profile`);
    }

    const doc = await fleetDriverProfileRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        kind: DRIVER_PROFILE_KIND,
        licenseNumber: input.licenseNumber,
        licenseExpiresAt: input.licenseExpiresAt,
        specialization: input.specialization,
        area: input.area ?? null,
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListFleetDriversQuery): Promise<Paginated<FleetDriverProfileDoc>> {
    const clauses: FilterQuery<FleetDriverProfileDoc>[] = [];
    if (query.specialization !== undefined) {
      clauses.push({ specialization: query.specialization });
    }
    if (query.isActive !== undefined) clauses.push({ isActive: query.isActive });
    if (query.licenseExpiresBefore !== undefined) {
      clauses.push({ licenseExpiresAt: { $lte: query.licenseExpiresBefore } });
    }
    if (query.search !== undefined) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({ licenseNumber: rx });
    }
    return fleetDriverProfileRepository.listDrivers({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  async getById(id: string): Promise<FleetDriverProfileDoc> {
    return fleetDriverProfileRepository.getById(id);
  }

  async update(
    id: string,
    input: UpdateFleetDriverProfile,
    by: string,
  ): Promise<FleetDriverProfileDoc> {
    const before = await fleetDriverProfileRepository.getById(id);
    const set: Partial<FleetDriverProfileDoc> = {};
    if (input.licenseNumber !== undefined) set.licenseNumber = input.licenseNumber;
    if (input.licenseExpiresAt !== undefined) set.licenseExpiresAt = input.licenseExpiresAt;
    if (input.specialization !== undefined) set.specialization = input.specialization;
    if (input.area !== undefined) set.area = input.area ?? null;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    const updated = await fleetDriverProfileRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /** `hr.employee.exited` subscription (design §9.1): leaving the company leaves the pool. */
  async deactivateForExitedEmployee(employeeId: string): Promise<void> {
    const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employeeId);
    if (profile === null || !profile.isActive) return;
    await fleetDriverProfileRepository.updateById(
      String(profile._id),
      { isActive: false },
      { by: null, version: profile.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(profile._id)),
      action: 'update',
      changes: [{ field: 'isActive', old: true, new: false }],
    });
  }
}

export const fleetDriverProfileService = new FleetDriverProfileService();
