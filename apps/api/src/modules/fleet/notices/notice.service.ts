// Filled insurance notices — create, read, edit, soft-delete. Audited like every Fleet record.
import { Types } from 'mongoose';
import {
  type CreateFleetNotice,
  type FleetNoticeDto,
  type ListFleetNoticesQuery,
  type Paginated,
  type UpdateFleetNotice,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetNoticeRepository } from './notice.repository';
import { type FleetNoticeDoc } from './notice.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'notice', entityId: id });

const idOrNull = (value: string | null | undefined): Types.ObjectId | null =>
  value === null || value === undefined ? null : new Types.ObjectId(value);
const stringOrNull = (value: Types.ObjectId | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** Only the boxes that say something — an emptied box is dropped rather than stored as ''. */
const filled = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([, text]) => text.trim() !== ''));
const ticked = (checks: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(checks).filter(([, chosen]) => chosen.length > 0));

const snapshot = (doc: FleetNoticeDoc) => ({
  template: doc.template,
  values: doc.values,
  checks: doc.checks,
  vehicleId: stringOrNull(doc.vehicleId),
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  accidentId: stringOrNull(doc.accidentId),
});

export const toNoticeDto = (doc: FleetNoticeDoc): FleetNoticeDto => ({
  id: String(doc._id),
  template: doc.template,
  values: doc.values ?? {},
  checks: doc.checks ?? {},
  vehicleId: stringOrNull(doc.vehicleId),
  driverEmployeeId: stringOrNull(doc.driverEmployeeId),
  accidentId: stringOrNull(doc.accidentId),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class FleetNoticeService {
  async list(query: ListFleetNoticesQuery): Promise<Paginated<FleetNoticeDoc>> {
    return fleetNoticeRepository.list({
      filter: query.template === undefined ? {} : { template: query.template },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'updatedAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['updatedAt', 'createdAt'],
    });
  }

  async get(id: string): Promise<FleetNoticeDoc> {
    return fleetNoticeRepository.getById(id);
  }

  async create(input: CreateFleetNotice, by: string): Promise<FleetNoticeDoc> {
    const doc = await fleetNoticeRepository.create(
      {
        template: input.template,
        values: filled(input.values),
        checks: ticked(input.checks),
        vehicleId: idOrNull(input.vehicleId),
        driverEmployeeId: idOrNull(input.driverEmployeeId),
        accidentId: idOrNull(input.accidentId),
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

  async update(id: string, input: UpdateFleetNotice, by: string): Promise<FleetNoticeDoc> {
    const before = await fleetNoticeRepository.getById(id);
    const set: Partial<FleetNoticeDoc> = {};
    if (input.values !== undefined) set.values = filled(input.values);
    if (input.checks !== undefined) set.checks = ticked(input.checks);
    if (input.vehicleId !== undefined) set.vehicleId = idOrNull(input.vehicleId);
    if (input.driverEmployeeId !== undefined) {
      set.driverEmployeeId = idOrNull(input.driverEmployeeId);
    }
    if (input.accidentId !== undefined) set.accidentId = idOrNull(input.accidentId);
    const updated = await fleetNoticeRepository.updateById(id, set, {
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

  async remove(id: string, by: string): Promise<void> {
    const before = await fleetNoticeRepository.getById(id);
    await fleetNoticeRepository.softDeleteById(id, { by });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges(snapshot(before), {}),
    });
  }
}

export const fleetNoticeService = new FleetNoticeService();
