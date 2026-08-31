// The enrolment map (AT-D3, D12-T·6) — the one place that says who a device id means.
//
// SMALL ON PURPOSE, like the device registry beside it. This phase answers «which device id is
// which employee», and stops. It carries no protocol, no host and no credential: the transport is
// AT-D4's, and a connection field added here would put two unrelated decisions in one row.
import { Types } from 'mongoose';
import {
  normalizeEnrollmentNo,
  type AttendanceEnrollmentDto,
  type CreateAttendanceEnrollment,
  type ListAttendanceEnrollmentsQuery,
  type Paginated,
  type UpdateAttendanceEnrollment,
} from '@ecms/contracts';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { employeeRepository } from '../../employee-management/employees';
import { attendanceDeviceRepository } from '../devices';
import { type AttendanceEnrollmentDoc } from './attendance-enrollment.model';
import { attendanceEnrollmentRepository } from './attendance-enrollment.repository';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'attendanceEnrollment',
  entityId: id,
});

const snapshot = (doc: AttendanceEnrollmentDoc) => ({
  employeeId: String(doc.employeeId),
  note: doc.note,
});

export const toAttendanceEnrollmentDto = (
  doc: AttendanceEnrollmentDoc,
  device: { code: string; name: string } | null = null,
  employee: { name: AttendanceEnrollmentDto['employeeName']; employeeNumber: string | null } | null = null,
): AttendanceEnrollmentDto => ({
  id: String(doc._id),
  deviceId: String(doc.deviceId),
  deviceCode: device?.code ?? '',
  deviceName: device?.name ?? null,
  enrollmentNo: doc.enrollmentNo,
  employeeId: String(doc.employeeId),
  employeeName: employee?.name ?? null,
  employeeNumber: employee?.employeeNumber ?? null,
  note: doc.note,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class AttendanceEnrollmentService {
  async list(
    query: ListAttendanceEnrollmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AttendanceEnrollmentDoc>> {
    return attendanceEnrollmentRepository.listFiltered(
      { deviceId: query.deviceId, employeeId: query.employeeId, search: query.search },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<AttendanceEnrollmentDoc> {
    return attendanceEnrollmentRepository.getById(id, scope);
  }

  /**
   * BOTH SIDES ARE VALIDATED, and neither is trusted from the request.
   *
   * A mapping to a device that does not exist could never resolve anything, and a mapping to an
   * employee who does not exist would attribute punches to a dangling reference — a row that reads
   * as a real answer and produces a day record belonging to nobody.
   *
   * `employeeBranchId` is COPIED here rather than joined at read time, because it is the reader's
   * scope axis: a filter cannot follow a reference. It is a snapshot of where the employee was
   * filed when the mapping was made, which is the same stance `employeeBranchId` takes on a punch.
   */
  async create(
    ctx: AuthContext,
    input: CreateAttendanceEnrollment,
  ): Promise<AttendanceEnrollmentDoc> {
    const device = await attendanceDeviceRepository.findById(input.deviceId);
    if (device === null) throw new NotFoundError(`no such device: ${input.deviceId}`);
    const employee = await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError(`no such employee: ${input.employeeId}`);

    const enrollmentNo = normalizeEnrollmentNo(input.enrollmentNo);
    const existing = await attendanceEnrollmentRepository.findByEnrollmentSystem(
      device._id as Types.ObjectId,
      enrollmentNo,
    );
    if (existing !== null) {
      throw new ConflictError(
        `enrolment ${enrollmentNo} on device ${device.code} is already mapped — delete it before mapping it to somebody else`,
      );
    }

    const doc = await attendanceEnrollmentRepository.create(
      {
        deviceId: device._id as Types.ObjectId,
        enrollmentNo,
        employeeId: new Types.ObjectId(input.employeeId),
        employeeBranchId: employee.employment.branchId,
        note: input.note ?? null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'deviceId', old: null, new: String(device._id) },
        { field: 'enrollmentNo', old: null, new: enrollmentNo },
        { field: 'employeeId', old: null, new: input.employeeId },
      ],
    });
    return doc;
  }

  /**
   * The device and the enrolment number cannot be changed — see the contract.
   *
   * Re-pointing WHO an enrolment means is allowed and is the whole point of the update: a finger
   * enrolled under a leaver's id and re-used for their replacement is an ordinary event. Punches
   * already attributed keep the employee they were stamped with, because a punch records who it
   * was resolved to at the time and history is not restated by a later mapping change.
   */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateAttendanceEnrollment,
    scope: ScopeSelector,
  ): Promise<AttendanceEnrollmentDoc> {
    const before = await attendanceEnrollmentRepository.getById(id, scope);
    let employeeBranchId: Types.ObjectId | null | undefined;
    if (input.employeeId !== undefined) {
      const employee = await employeeRepository.findById(input.employeeId);
      if (employee === null) throw new NotFoundError(`no such employee: ${input.employeeId}`);
      employeeBranchId = employee.employment.branchId;
    }
    const updated = await attendanceEnrollmentRepository.updateById(
      id,
      {
        ...(input.employeeId === undefined
          ? {}
          : { employeeId: new Types.ObjectId(input.employeeId), employeeBranchId }),
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

  /**
   * Unmapping is a SOFT delete, and the partial unique index is what makes that matter: the key
   * is freed, so the same enrolment id can be mapped again to somebody else, while the row that
   * recorded the old answer stays readable as the reason a month of punches went where it did.
   */
  async remove(ctx: AuthContext, id: string, scope: ScopeSelector): Promise<void> {
    const before = await attendanceEnrollmentRepository.getById(id, scope);
    await attendanceEnrollmentRepository.softDeleteById(id, { by: ctx.userId, scope });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: [
        { field: 'enrollmentNo', old: before.enrollmentNo, new: null },
        { field: 'employeeId', old: String(before.employeeId), new: null },
      ],
    });
  }
}

export const attendanceEnrollmentService = new AttendanceEnrollmentService();
