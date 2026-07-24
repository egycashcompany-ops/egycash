// The shared HR business calendar (Leave design §5): weekend days (org setting) + public
// holidays, and the day-counting primitives Leave uses now and Attendance reuses later.
// All date parameters are UTC-midnight date-only values (business-date.ts, R10).
import {
  HrLeaveSettingKeys,
  type CreateHoliday,
  type HolidayDto,
  type UpdateHoliday,
  type WorkCalendarDto,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { settingsService } from '../../../platform/settings';
import { addDays, calendarDaysInclusive, dateOnlyIso, isoWeekday, toDateOnly } from '../shared/business-date';
import { HolidayModel, type HolidayDoc } from './holiday.model';
import { holidayRepository } from './holiday.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'holiday', entityId: id });

export const toHolidayDto = (doc: HolidayDoc): HolidayDto => ({
  id: String(doc._id),
  date: dateOnlyIso(doc.date),
  name: doc.name,
  version: doc.__v,
});

class WorkCalendarService {
  async weekendDays(): Promise<number[]> {
    return settingsService.resolve<number[]>(HrLeaveSettingKeys.WeekendDays, {
      userId: null,
      branchId: null,
    });
  }

  async listHolidays(from: Date, to: Date): Promise<HolidayDoc[]> {
    return HolidayModel.find({
      isDeleted: false,
      date: { $gte: toDateOnly(from), $lte: toDateOnly(to) },
    })
      .sort({ date: 1 })
      .lean<HolidayDoc[]>()
      .exec();
  }

  async calendar(from: Date, to: Date): Promise<WorkCalendarDto> {
    if (calendarDaysInclusive(toDateOnly(from), toDateOnly(to)) > 400) {
      throw new BusinessRuleError('calendar range is limited to 400 days');
    }
    const [weekendDays, holidays] = await Promise.all([
      this.weekendDays(),
      this.listHolidays(from, to),
    ]);
    return { weekendDays, holidays: holidays.map(toHolidayDto) };
  }

  /** Holiday date-only set for a range — the counting primitive. */
  private async holidaySet(from: Date, to: Date): Promise<Set<string>> {
    const rows = await this.listHolidays(from, to);
    return new Set(rows.map((r) => dateOnlyIso(r.date)));
  }

  /**
   * Count leave days in [from, to] (date-only, inclusive): `calendarDays` counts every day;
   * `workdays` skips weekends + holidays. Half-day flags subtract 0.5 when their boundary day
   * counts. Frozen at request submission (R7) — never recomputed.
   */
  async countLeaveDays(params: {
    from: Date;
    to: Date;
    countingMode: 'workdays' | 'calendarDays';
    halfDayStart: boolean;
    halfDayEnd: boolean;
  }): Promise<number> {
    const from = toDateOnly(params.from);
    const to = toDateOnly(params.to);
    const weekend = new Set(await this.weekendDays());
    const holidays =
      params.countingMode === 'workdays' ? await this.holidaySet(from, to) : new Set<string>();

    let days = 0;
    let firstCounts = false;
    let lastCounts = false;
    for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
      const counts =
        params.countingMode === 'calendarDays' ||
        (!weekend.has(isoWeekday(d)) && !holidays.has(dateOnlyIso(d)));
      if (counts) {
        days += 1;
        if (d.getTime() === from.getTime()) firstCounts = true;
        if (d.getTime() === to.getTime()) lastCounts = true;
      }
    }
    if (params.halfDayStart && firstCounts) days -= 0.5;
    if (params.halfDayEnd && lastCounts && to.getTime() !== from.getTime()) days -= 0.5;
    return days;
  }

  // ── Holiday administration (workCalendar.manage) ──────────────────────────

  async createHoliday(ctx: AuthContext, input: CreateHoliday): Promise<HolidayDoc> {
    const date = toDateOnly(input.date);
    const existing = await HolidayModel.findOne({ date, isDeleted: false }).lean().exec();
    if (existing !== null) throw new ConflictError('a holiday already exists on this date');
    const doc = await holidayRepository.create({ date, name: input.name }, { by: ctx.userId });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'date', old: null, new: dateOnlyIso(date) }],
    });
    return doc;
  }

  async updateHoliday(ctx: AuthContext, id: string, input: UpdateHoliday): Promise<HolidayDoc> {
    const current = await holidayRepository.findById(id);
    if (current === null) throw new NotFoundError('holiday not found');
    const patch: Partial<HolidayDoc> = {};
    if (input.date !== undefined) patch.date = toDateOnly(input.date);
    if (input.name !== undefined) patch.name = input.name;
    const updated = await holidayRepository.updateById(id, patch, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'date', old: dateOnlyIso(current.date), new: dateOnlyIso(updated.date) }],
    });
    return updated;
  }

  async deleteHoliday(ctx: AuthContext, id: string): Promise<void> {
    const current = await holidayRepository.findById(id);
    if (current === null) throw new NotFoundError('holiday not found');
    await holidayRepository.softDeleteById(id, { by: ctx.userId });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: [{ field: 'date', old: dateOnlyIso(current.date), new: null }],
    });
  }
}

export const workCalendarService = new WorkCalendarService();
