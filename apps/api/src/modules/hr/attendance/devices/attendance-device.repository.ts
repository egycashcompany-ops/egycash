// Device data access. BOTH the branch axis and the reason it is declared live here.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { AttendanceDeviceModel, type AttendanceDeviceDoc } from './attendance-device.model';

/** Escapes a user string used inside a regex — the same guard the other search readers use. */
const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class AttendanceDeviceRepository extends BaseRepository<AttendanceDeviceDoc> {
  constructor() {
    // BRANCH ONLY, and declared rather than assumed: a device stands in one branch and belongs to
    // no department — the people who walk past it come from several. `attendance-scope-guards`
    // asserts this declaration exists, because an undeclared axis widens silently (see the model).
    super(AttendanceDeviceModel, { branchField: 'branchId', softDelete: true });
  }

  /**
   * Resolve what a punch row reported to the device it came from.
   *
   * UNSCOPED, deliberately. The caller is the import path — a machine reading rows, not a person
   * browsing a list — and a device narrowed by whatever scope the importing account happened to
   * hold would quarantine real punches from a real device for a reason nobody could see.
   *
   * Matching is on the normalized (uppercase) code; see the model for why that normalization is
   * the single one.
   */
  async findByCodeSystem(code: string): Promise<AttendanceDeviceDoc | null> {
    return AttendanceDeviceModel.findOne({ code: code.trim().toUpperCase(), isDeleted: false })
      .lean<AttendanceDeviceDoc>()
      .exec();
  }

  async listFiltered(
    f: { branchId?: string | undefined; isActive?: boolean | undefined; search?: string | undefined },
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<AttendanceDeviceDoc>> {
    const clauses: FilterQuery<AttendanceDeviceDoc>[] = [];
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.isActive !== undefined) clauses.push({ isActive: f.isActive });
    if (f.search !== undefined) {
      const rx = new RegExp(escaped(f.search), 'i');
      clauses.push({ $or: [{ code: rx }, { name: rx }] });
    }
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'code',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['code', 'name', 'createdAt'],
      scope,
    });
  }
}

export const attendanceDeviceRepository = new AttendanceDeviceRepository();
