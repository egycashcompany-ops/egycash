// Enrolment data access. The branch axis and the reason it is declared both live here.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import {
  AttendanceEnrollmentModel,
  type AttendanceEnrollmentDoc,
} from './attendance-enrollment.model';

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class AttendanceEnrollmentRepository extends BaseRepository<AttendanceEnrollmentDoc> {
  constructor() {
    // The EMPLOYEE's branch, not the device's, and the distinction is the AT-D1 one restated: a
    // mapping row is a fact about a person, so the reader's axis is where that person is filed.
    // Declared rather than assumed — an undeclared axis widens silently (see the model).
    super(AttendanceEnrollmentModel, { branchField: 'employeeBranchId', softDelete: true });
  }

  /**
   * Resolve what the device reported to the employee it means.
   *
   * UNSCOPED, for the same reason `findByCodeSystem` is: the caller is the import path, a machine
   * reading rows rather than a person browsing. A mapping narrowed by whatever scope the importing
   * account happened to hold would quarantine real punches for a reason nobody could see.
   */
  async findByEnrollmentSystem(
    deviceId: Types.ObjectId,
    enrollmentNo: string,
  ): Promise<AttendanceEnrollmentDoc | null> {
    return AttendanceEnrollmentModel.findOne({
      deviceId,
      enrollmentNo: enrollmentNo.trim(),
      isDeleted: false,
    })
      .lean<AttendanceEnrollmentDoc>()
      .exec();
  }

  async listFiltered(
    f: { deviceId?: string | undefined; employeeId?: string | undefined; search?: string | undefined },
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<AttendanceEnrollmentDoc>> {
    const clauses: FilterQuery<AttendanceEnrollmentDoc>[] = [];
    if (f.deviceId !== undefined) clauses.push({ deviceId: new Types.ObjectId(f.deviceId) });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.search !== undefined) clauses.push({ enrollmentNo: new RegExp(escaped(f.search), 'i') });
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'enrollmentNo',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['enrollmentNo', 'createdAt'],
      scope,
    });
  }
}

export const attendanceEnrollmentRepository = new AttendanceEnrollmentRepository();
