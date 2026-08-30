// The device registry (frozen design v1.3 §17.2 — D12.5, D12.7).
//
// SMALL ON PURPOSE. This phase answers «which devices exist and where do they stand», and stops
// there. No protocol, no host, no credential, no polling: D12-T is open, and a connection field
// added before the physical unit is read would be a guess wearing a schema.
import { Types } from 'mongoose';
import {
  normalizeDeviceCode,
  type AttendanceDeviceDto,
  type CreateAttendanceDevice,
  type ListAttendanceDevicesQuery,
  type Paginated,
  type UpdateAttendanceDevice,
} from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { branchService } from '../../../../platform/organization/branches';
import { diffChanges } from '../../../../shared/utils/diff';
import { type AttendanceDeviceDoc } from './attendance-device.model';
import { attendanceDeviceRepository } from './attendance-device.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'attendanceDevice', entityId: id });

const snapshot = (doc: AttendanceDeviceDoc) => ({
  name: doc.name,
  branchId: String(doc.branchId),
  isActive: doc.isActive,
  note: doc.note,
});

export const toAttendanceDeviceDto = (
  doc: AttendanceDeviceDoc,
  branchName: AttendanceDeviceDto['branchName'] = null,
): AttendanceDeviceDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  branchId: String(doc.branchId),
  branchName,
  isActive: doc.isActive,
  note: doc.note,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class AttendanceDeviceService {
  async list(
    query: ListAttendanceDevicesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AttendanceDeviceDoc>> {
    return attendanceDeviceRepository.listFiltered(
      { branchId: query.branchId, isActive: query.isActive, search: query.search },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<AttendanceDeviceDoc> {
    return attendanceDeviceRepository.getById(id, scope);
  }

  /**
   * The branch is VALIDATED, not trusted. A device filed against a branch that does not exist
   * would stamp `branchIdAtPunch` with a dangling reference, and the cross-branch flag downstream
   * would compare a real branch against a ghost.
   */
  async create(ctx: AuthContext, input: CreateAttendanceDevice): Promise<AttendanceDeviceDoc> {
    await branchService.getById(input.branchId);
    const code = normalizeDeviceCode(input.code);
    const existing = await attendanceDeviceRepository.findByCodeSystem(code);
    if (existing !== null) {
      throw new ConflictError(`a device with code ${code} already exists`);
    }
    const doc = await attendanceDeviceRepository.create(
      {
        code,
        name: input.name,
        branchId: new Types.ObjectId(input.branchId),
        isActive: true,
        note: input.note ?? null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'code', old: null, new: code },
        { field: 'branchId', old: null, new: input.branchId },
      ],
    });
    return doc;
  }

  /**
   * `code` cannot be changed — see the contract. Moving a device between branches CAN happen and
   * is allowed: the punches it already produced keep the branch they were stamped with, because a
   * punch records where it happened at the time and history is not restated by a later move.
   */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateAttendanceDevice,
    scope: ScopeSelector,
  ): Promise<AttendanceDeviceDoc> {
    const before = await attendanceDeviceRepository.getById(id, scope);
    if (input.branchId !== undefined) await branchService.getById(input.branchId);
    const updated = await attendanceDeviceRepository.updateById(
      id,
      {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.branchId === undefined ? {} : { branchId: new Types.ObjectId(input.branchId) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.note === undefined ? {} : { note: input.note }),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const attendanceDeviceService = new AttendanceDeviceService();
