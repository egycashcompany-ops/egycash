import { Types, type FilterQuery } from 'mongoose';
import { addDays, toDateOnly } from '../../shared/business-date';
import { cairoInstant } from '../day-records/derive-day';
import { type ListPunchesQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';

class PunchRepository extends BaseRepository<AttendancePunchDoc> {
  constructor() {
    // Evidence never soft-deletes (D9).
    //
    // THE AXIS IS THE EMPLOYEE'S BRANCH, NOT THE PUNCH'S. Before AT-D1 this scoped on
    // `branchIdAtPunch`, which was harmless only because import stamped the employee's own branch
    // into it. D12.7 made that field record the DEVICE's location, so scoping on it would have
    // silently changed who reads what: a manager would gain other branches' people who punched on
    // their wall, and lose their own person who punched at head office. Reach follows the person.
    super(AttendancePunchModel, { branchField: 'employeeBranchId', softDelete: false });
  }

  /**
   * THE SCOPE IS PASSED, and before AT-D1 it was not.
   *
   * This method declared a branch axis on the class and then called `list` without a selector.
   * `baseFilter(undefined)` adds no clause, so the read returned every punch in the organization
   * to every caller holding `attendance.view` — a key the attendance migration grants to the
   * Employee Self-Service role. The declaration was there; nothing carried it to the query.
   *
   * It is fixed here rather than filed away because this phase is about that exact axis on that
   * exact collection, and shipping a change to which branch a punch records while leaving the read
   * unscoped would be indefensible.
   */
  async listPunches(
    query: ListPunchesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AttendancePunchDoc>> {
    const filter: FilterQuery<AttendancePunchDoc> = {};
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.source !== undefined) filter.source = query.source;
    if (query.importBatchId !== undefined) filter.importBatchId = query.importBatchId;
    // THE DATES ARE CAIRO CALENDAR DAYS, AND BOTH ENDS ARE INCLUSIVE.
    //
    // They were compared against the punch INSTANT as they arrived, and `z.coerce.date()` turns
    // `2026-11-18` into `2026-11-18T00:00:00Z`. Two consequences, both wrong and both silent:
    // `from=D&to=D` asked for a zero-width window and answered 0 punches for a day that had
    // seventy-four, and every other window was shifted two hours into the previous Cairo day
    // (`00:00Z` is `02:00` in Cairo), so the first two hours of `to` were dropped and the last two
    // of the day before `from` were counted.
    //
    // So `from` opens at Cairo midnight of that date and `to` closes at Cairo midnight of the day
    // AFTER it, exclusive — which is the same window `deriveDay` attributes a shift-less day from,
    // and the reason it is spelled with `$lt` rather than `$lte`.
    if (query.from !== undefined || query.to !== undefined) {
      filter.at = {
        ...(query.from === undefined
          ? {}
          : { $gte: cairoInstant(toDateOnly(query.from), '00:00') }),
        ...(query.to === undefined
          ? {}
          : { $lt: cairoInstant(addDays(toDateOnly(query.to), 1), '00:00') }),
      };
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at', 'createdAt'],
      scope,
    });
  }

  /**
   * The newest scan any of these employees made inside a window, or null.
   *
   * It is the daily sheet's «آخر بصمة»: one indexed read (`ix_employee_at`), sorted descending and
   * stopped at the first row, rather than loading a day of punches to look at the last one.
   * Superseded punches are left out — a correction replaced them, and the device moment they
   * recorded is no longer the one the screen should report.
   */
  async lastPunchIn(
    employeeIds: Types.ObjectId[],
    from: Date,
    to: Date,
  ): Promise<Date | null> {
    const newest = await this.model
      .findOne({ employeeId: { $in: employeeIds }, at: { $gte: from, $lt: to }, supersededBy: null })
      .sort({ at: -1 })
      .select({ at: 1 })
      .lean<{ at: Date } | null>()
      .exec();
    return newest?.at ?? null;
  }

  /**
   * ONE EMPLOYEE'S FIRST SCAN EVER, whatever period is being looked at.
   *
   * The period picker needs a floor. «Previous month» has to know whether there IS an earlier month
   * to walk back to, and the custom range has to refuse a start before the machines first saw this
   * person rather than drawing an empty year. Indexed on `ix_employee_at`, so it is one row read.
   */
  async firstPunchEver(employeeId: Types.ObjectId): Promise<Date | null> {
    const oldest = await this.model
      .findOne({ employeeId, supersededBy: null, isDeleted: false })
      .sort({ at: 1 })
      .select({ at: 1 })
      .lean<{ at: Date } | null>()
      .exec();
    return oldest?.at ?? null;
  }

  /** The engine's read: every punch for one employee inside a window, oldest first. */
  async listForWindow(
    employeeId: Types.ObjectId,
    from: Date,
    to: Date,
  ): Promise<AttendancePunchDoc[]> {
    return this.model
      .find({ employeeId, at: { $gte: from, $lte: to }, supersededBy: null })
      .sort({ at: 1 })
      .lean<AttendancePunchDoc[]>()
      .exec();
  }
}

export const punchRepository = new PunchRepository();
