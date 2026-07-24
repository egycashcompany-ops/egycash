// Balance & ledger service (frozen design §4). SIGN CONVENTION — ledger `days` is a positive
// magnitude except `adjust` (signed); the KIND carries the semantics:
//   grant/carryover → granted/carriedOver + · reserve → reserved + · release → reserved −
//   consume → reserved −, consumed + · adjust(signed) → adjusted · expire → adjusted −
// Rebuild recomputes the cache from these sums. THE reservation gate (R1) is the conditional
// update in `tryReserve` — no other code path may increase `reserved`.
import { Types } from 'mongoose';
import {
  HrLeaveEvents,
  HrLeaveSettingKeys,
  HrLeaveTemplates,
  type AdjustLeaveBalance,
  type LeaveBalanceDto,
  type LeaveLedgerEntryDto,
  type LeavePaidBreakdownDto,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { settingsService } from '../../../../platform/settings';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { cairoToday, dateOnlyIso, leaveYearOf, toDateOnly } from '../../shared/business-date';
import { entitledDays, leaveTypeRepository, type LeaveTypeDoc } from '../leave-types';
import { availableOf, LeaveBalanceModel, type LeaveBalanceDoc } from './leave-balance.model';
import { LeaveLedgerModel, type LeaveLedgerDoc } from './leave-ledger.model';

const ORG_SUBJECT = { userId: null, branchId: null };
const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000;

const entityRef = (employeeId: string) => ({
  moduleId: 'hr',
  entityType: 'employee',
  entityId: employeeId,
});

/** One year-slice of a request span with its frozen day count (§4 — Dec-31 splits). */
export interface YearPortion {
  year: number;
  days: number;
  from: Date;
  to: Date;
}

export const toLedgerEntryDto = (doc: LeaveLedgerDoc): LeaveLedgerEntryDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  typeId: String(doc.typeId),
  balanceTypeId: doc.balanceTypeId === null ? null : String(doc.balanceTypeId),
  year: doc.year,
  kind: doc.kind,
  days: doc.days,
  requestId: doc.requestId === null ? null : String(doc.requestId),
  effectiveFrom: doc.effectiveFrom === null ? null : dateOnlyIso(doc.effectiveFrom),
  effectiveTo: doc.effectiveTo === null ? null : dateOnlyIso(doc.effectiveTo),
  paidBreakdown: doc.paidBreakdown,
  note: doc.note,
  by: doc.by === null ? null : String(doc.by),
  createdAt: doc.createdAt.toISOString(),
});

/** Whole months of employed service across employment periods, as of a date. */
export const serviceMonthsOf = (
  employee: Pick<EmployeeDoc, 'employmentPeriods' | 'hiredAt'>,
  asOf: Date,
  acrossPeriods: boolean,
): number => {
  const periods =
    employee.employmentPeriods.length > 0
      ? employee.employmentPeriods
      : [{ hiredAt: employee.hiredAt, exitedAt: null }];
  const relevant = acrossPeriods ? periods : periods.slice(-1);
  let ms = 0;
  for (const p of relevant) {
    const start = toDateOnly(p.hiredAt);
    if (start.getTime() > asOf.getTime()) continue;
    const end = p.exitedAt === null ? asOf : toDateOnly(p.exitedAt);
    ms += Math.max(0, Math.min(end.getTime(), asOf.getTime()) - start.getTime());
  }
  return Math.floor(ms / (30.44 * 24 * 60 * 60 * 1000));
};

export const ageOf = (employee: EmployeeDoc, asOf: Date): number | null => {
  const birth = employee.personal.birthDate;
  if (birth === null) return null;
  const years = (asOf.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.floor(years);
};

class LeaveBalanceService {
  private async ensureRow(employeeId: string, typeId: string, year: number): Promise<void> {
    await LeaveBalanceModel.updateOne(
      { employeeId: new Types.ObjectId(employeeId), typeId: new Types.ObjectId(typeId), year },
      { $setOnInsert: { granted: 0, carriedOver: 0, adjusted: 0, reserved: 0, consumed: 0 } },
      { upsert: true },
    ).exec();
  }

  private async appendLedger(entry: Omit<LeaveLedgerDoc, '_id' | 'createdAt'>): Promise<boolean> {
    try {
      await LeaveLedgerModel.create(entry);
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /**
   * THE gate (R1): atomically reserve `days` against (employee, banked type, year), honoring
   * the per-type negative cap (L5). Returns false when the balance cannot cover it.
   */
  private async tryReserve(
    employeeId: string,
    balanceTypeId: string,
    year: number,
    days: number,
    negativeCapDays: number,
  ): Promise<boolean> {
    await this.ensureRow(employeeId, balanceTypeId, year);
    const res = await LeaveBalanceModel.findOneAndUpdate(
      {
        employeeId: new Types.ObjectId(employeeId),
        typeId: new Types.ObjectId(balanceTypeId),
        year,
        $expr: {
          $gte: [
            {
              $subtract: [
                { $add: ['$granted', '$carriedOver', '$adjusted'] },
                { $add: ['$reserved', '$consumed', days] },
              ],
            },
            -negativeCapDays,
          ],
        },
      },
      { $inc: { reserved: days } },
      { new: true },
    ).exec();
    return res !== null;
  }

  /**
   * Reserve every year portion of a request span; on any shortfall the portions already taken
   * are compensated (released) and a business error is thrown. Untracked types skip the gate.
   */
  async reserveForRequest(params: {
    employeeId: string;
    typeId: string;
    balanceTypeId: string | null;
    negativeCapDays: number;
    portions: YearPortion[];
    requestId: string;
    by: string;
  }): Promise<void> {
    if (params.balanceTypeId === null) return;
    const taken: YearPortion[] = [];
    for (const portion of params.portions) {
      if (portion.days <= 0) continue;
      const okay = await this.tryReserve(
        params.employeeId,
        params.balanceTypeId,
        portion.year,
        portion.days,
        params.negativeCapDays,
      );
      if (!okay) {
        for (const t of taken) {
          await LeaveBalanceModel.updateOne(
            {
              employeeId: new Types.ObjectId(params.employeeId),
              typeId: new Types.ObjectId(params.balanceTypeId),
              year: t.year,
            },
            { $inc: { reserved: -t.days } },
          ).exec();
        }
        throw new BusinessRuleError('insufficient leave balance for the requested span');
      }
      taken.push(portion);
      const inserted = await this.appendLedger({
        employeeId: new Types.ObjectId(params.employeeId),
        typeId: new Types.ObjectId(params.typeId),
        balanceTypeId: new Types.ObjectId(params.balanceTypeId),
        year: portion.year,
        kind: 'reserve',
        days: portion.days,
        requestId: new Types.ObjectId(params.requestId),
        effectiveFrom: portion.from,
        effectiveTo: portion.to,
        paidBreakdown: [],
        note: null,
        by: new Types.ObjectId(params.by),
      });
      if (!inserted) {
        // Same request re-reserving (retry path) — undo the double-count.
        await LeaveBalanceModel.updateOne(
          {
            employeeId: new Types.ObjectId(params.employeeId),
            typeId: new Types.ObjectId(params.balanceTypeId),
            year: portion.year,
          },
          { $inc: { reserved: -portion.days } },
        ).exec();
      }
    }
  }

  /** Release the unconsumed reservation of a request (reject/cancel/early-return remainder). */
  async releaseForRequest(params: {
    employeeId: string;
    typeId: string;
    balanceTypeId: string | null;
    portions: YearPortion[];
    requestId: string;
    by: string | null;
    note: string;
  }): Promise<void> {
    if (params.balanceTypeId === null) return;
    for (const portion of params.portions) {
      if (portion.days <= 0) continue;
      const inserted = await this.appendLedger({
        employeeId: new Types.ObjectId(params.employeeId),
        typeId: new Types.ObjectId(params.typeId),
        balanceTypeId: new Types.ObjectId(params.balanceTypeId),
        year: portion.year,
        kind: 'release',
        days: portion.days,
        requestId: new Types.ObjectId(params.requestId),
        effectiveFrom: portion.from,
        effectiveTo: portion.to,
        paidBreakdown: [],
        note: params.note,
        by: params.by === null ? null : new Types.ObjectId(params.by),
      });
      if (inserted) {
        await LeaveBalanceModel.updateOne(
          {
            employeeId: new Types.ObjectId(params.employeeId),
            typeId: new Types.ObjectId(params.balanceTypeId),
            year: portion.year,
          },
          { $inc: { reserved: -portion.days } },
        ).exec();
      }
    }
  }

  /**
   * Tiered-pay breakdown for `days` consumed in `year` (R7): walks the type's tiers from the
   * year-to-date consumption of the SAME type, snapshotting the split forever.
   */
  private async paidBreakdownFor(
    type: LeaveTypeDoc,
    employeeId: string,
    year: number,
    days: number,
  ): Promise<LeavePaidBreakdownDto[]> {
    if (type.payModel === 'paid') return [{ days, payRate: 100 }];
    if (type.payModel === 'unpaid') return [{ days, payRate: 0 }];
    const prior = await LeaveLedgerModel.aggregate<{ _id: null; total: number }>([
      {
        $match: {
          employeeId: new Types.ObjectId(employeeId),
          typeId: type._id,
          year,
          kind: 'consume',
        },
      },
      { $group: { _id: null, total: { $sum: '$days' } } },
    ]).exec();
    // Tiers are cumulative windows over the year's consumption: with prior consumption C,
    // the next D days fill window space from position C onward.
    let cursor = prior[0]?.total ?? 0;
    let remaining = days;
    let boundary = 0;
    const out: LeavePaidBreakdownDto[] = [];
    for (const tier of type.payTiers) {
      if (remaining <= 0) break;
      const boundaryEnd = boundary + tier.days;
      const take = Math.min(remaining, Math.max(0, boundaryEnd - cursor));
      if (take > 0) {
        out.push({ days: take, payRate: tier.payRate });
        cursor += take;
        remaining -= take;
      }
      boundary = boundaryEnd;
    }
    if (remaining > 0) out.push({ days: remaining, payRate: 0 });
    return out;
  }

  /** Turn a request's reservation into dated consumption (completion / early return). */
  async consumeForRequest(params: {
    employeeId: string;
    type: LeaveTypeDoc;
    balanceTypeId: string | null;
    portions: YearPortion[];
    requestId: string;
    by: string | null;
  }): Promise<void> {
    for (const portion of params.portions) {
      if (portion.days <= 0) continue;
      const breakdown = await this.paidBreakdownFor(
        params.type,
        params.employeeId,
        portion.year,
        portion.days,
      );
      const inserted = await this.appendLedger({
        employeeId: new Types.ObjectId(params.employeeId),
        typeId: params.type._id,
        balanceTypeId: params.balanceTypeId === null ? null : new Types.ObjectId(params.balanceTypeId),
        year: portion.year,
        kind: 'consume',
        days: portion.days,
        requestId: new Types.ObjectId(params.requestId),
        effectiveFrom: portion.from,
        effectiveTo: portion.to,
        paidBreakdown: breakdown,
        note: null,
        by: params.by === null ? null : new Types.ObjectId(params.by),
      });
      if (inserted && params.balanceTypeId !== null) {
        await LeaveBalanceModel.updateOne(
          {
            employeeId: new Types.ObjectId(params.employeeId),
            typeId: new Types.ObjectId(params.balanceTypeId),
            year: portion.year,
          },
          { $inc: { reserved: -portion.days, consumed: portion.days } },
        ).exec();
      }
    }
  }

  // ── Grants, carryover, expiry (L3/L6, §4) ─────────────────────────────────

  /** The current employment period's start (rehires open a fresh period, R12). */
  private periodStartOf(employee: EmployeeDoc): Date {
    const currentPeriod =
      employee.employmentPeriods.find((p) => p.exitedAt === null) ??
      employee.employmentPeriods[employee.employmentPeriods.length - 1];
    return toDateOnly(currentPeriod?.hiredAt ?? employee.hiredAt);
  }

  /** Pro-rated grant amount for one employee × banked type × year (L3 — hire-year pro-rata). */
  private async grantDaysFor(employee: EmployeeDoc, type: LeaveTypeDoc, year: number): Promise<number> {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const acrossPeriods = await settingsService.resolve<boolean>(
      HrLeaveSettingKeys.ServiceAcrossPeriods,
      ORG_SUBJECT,
    );
    const periodStart = this.periodStartOf(employee);
    if (periodStart.getTime() > yearEnd.getTime()) return 0;
    const months = serviceMonthsOf(employee, yearEnd, acrossPeriods);
    const entitled = entitledDays(type, Math.floor(months / 12), ageOf(employee, yearEnd));
    if (periodStart.getTime() <= yearStart.getTime()) return entitled;
    const monthsInYear = 12 - periodStart.getUTCMonth();
    return Math.round(((entitled * monthsInYear) / 12) * 2) / 2;
  }

  /** Pro-rated grant for one employee × banked type × year. Idempotent via the grant key. */
  async grantForEmployee(employee: EmployeeDoc, type: LeaveTypeDoc, year: number): Promise<boolean> {
    const granted = await this.grantDaysFor(employee, type, year);
    if (granted <= 0) return false;
    const inserted = await this.appendLedger({
      employeeId: employee._id,
      typeId: type._id,
      balanceTypeId: type._id,
      year,
      kind: 'grant',
      days: granted,
      requestId: null,
      effectiveFrom: new Date(Date.UTC(year, 0, 1)),
      effectiveTo: new Date(Date.UTC(year, 11, 31)),
      paidBreakdown: [],
      note: `annual grant (${dateOnlyIso(this.periodStartOf(employee))})`,
      by: null,
    });
    if (inserted) {
      await this.ensureRow(String(employee._id), String(type._id), year);
      await LeaveBalanceModel.updateOne(
        { employeeId: employee._id, typeId: type._id, year },
        { $inc: { granted } },
      ).exec();
    }
    return inserted;
  }

  /**
   * Rehire re-grant (R12): a SAME-YEAR rehire finds the year's grant key already consumed by
   * the previous employment period (whose availability the exit expired), so the fresh period's
   * pro-rata lands as a period-keyed compensating adjustment instead. Later-year rehires take
   * the plain grant path.
   */
  async regrantOnRehire(employeeId: string): Promise<void> {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return;
    const year = leaveYearOf(cairoToday());
    const periodNote = `rehire grant (${dateOnlyIso(this.periodStartOf(employee))})`;
    for (const type of await leaveTypeRepository.listActiveBanked()) {
      if (await this.grantForEmployee(employee, type, year)) continue;
      const granted = await this.grantDaysFor(employee, type, year);
      if (granted <= 0) continue;
      const already = await LeaveLedgerModel.exists({
        employeeId: employee._id,
        balanceTypeId: type._id,
        year,
        kind: 'adjust',
        note: periodNote,
      });
      if (already !== null) continue;
      await this.appendLedger({
        employeeId: employee._id,
        typeId: type._id,
        balanceTypeId: type._id,
        year,
        kind: 'adjust',
        days: granted,
        requestId: null,
        effectiveFrom: null,
        effectiveTo: null,
        paidBreakdown: [],
        note: periodNote,
        by: null,
      });
      await this.ensureRow(String(employee._id), String(type._id), year);
      await LeaveBalanceModel.updateOne(
        { employeeId: employee._id, typeId: type._id, year },
        { $inc: { adjusted: granted } },
      ).exec();
    }
  }

  /** Carry the previous year's remaining availability forward per type config (L6). */
  private async carryoverForRow(row: LeaveBalanceDoc, type: LeaveTypeDoc, intoYear: number): Promise<void> {
    if (type.carryoverMode === 'none') return;
    let carry = Math.max(0, availableOf(row));
    if (type.carryoverMode === 'cap' && type.carryoverCapDays !== null) {
      carry = Math.min(carry, type.carryoverCapDays);
    }
    if (carry <= 0) return;
    const inserted = await this.appendLedger({
      employeeId: row.employeeId,
      typeId: row.typeId,
      balanceTypeId: row.typeId,
      year: intoYear,
      kind: 'carryover',
      days: carry,
      requestId: null,
      effectiveFrom: new Date(Date.UTC(intoYear, 0, 1)),
      effectiveTo: null,
      paidBreakdown: [],
      note: `carried over from ${String(row.year)}`,
      by: null,
    });
    if (inserted) {
      await this.ensureRow(String(row.employeeId), String(row.typeId), intoYear);
      await LeaveBalanceModel.updateOne(
        { employeeId: row.employeeId, typeId: row.typeId, year: intoYear },
        { $inc: { carriedOver: carry } },
      ).exec();
      // Close the source year so the days exist exactly once (expire the carried amount).
      await this.appendLedger({
        employeeId: row.employeeId,
        typeId: row.typeId,
        balanceTypeId: row.typeId,
        year: row.year,
        kind: 'expire',
        days: carry,
        requestId: null,
        effectiveFrom: null,
        effectiveTo: null,
        paidBreakdown: [],
        note: 'moved to carryover',
        by: null,
      });
      await LeaveBalanceModel.updateOne(
        { employeeId: row.employeeId, typeId: row.typeId, year: row.year },
        { $inc: { adjusted: -carry } },
      ).exec();
    }
  }

  /** Expire still-unconsumed carryover after the configured window (first run past the date). */
  private async expireCarryoverIfDue(row: LeaveBalanceDoc, type: LeaveTypeDoc, today: Date): Promise<void> {
    if (type.carryoverExpiryMonths === null || row.carriedOver <= 0) return;
    const expiryDate = new Date(Date.UTC(row.year, type.carryoverExpiryMonths, 1));
    if (today.getTime() < expiryDate.getTime()) return;
    const already = await LeaveLedgerModel.exists({
      employeeId: row.employeeId,
      balanceTypeId: row.typeId,
      year: row.year,
      kind: 'expire',
      note: 'carryover expiry',
    });
    if (already !== null) return;
    const expire = Math.max(0, Math.min(row.carriedOver, availableOf(row)));
    if (expire <= 0) return;
    await this.appendLedger({
      employeeId: row.employeeId,
      typeId: row.typeId,
      balanceTypeId: row.typeId,
      year: row.year,
      kind: 'expire',
      days: expire,
      requestId: null,
      effectiveFrom: expiryDate,
      effectiveTo: null,
      paidBreakdown: [],
      note: 'carryover expiry',
      by: null,
    });
    await LeaveBalanceModel.updateOne(
      { _id: row._id },
      { $inc: { adjusted: -expire } },
    ).exec();
  }

  /**
   * Year-end + boot catch-up (§10): carry the previous year forward, grant the current year
   * for every employed employee × active banked type, apply due carryover expiry. Idempotent.
   */
  async yearEndProcessing(): Promise<number> {
    const today = cairoToday();
    const year = leaveYearOf(today);
    const types = await leaveTypeRepository.listActiveBanked();
    if (types.length === 0) return 0;
    const typeById = new Map(types.map((t) => [String(t._id), t]));

    // 1 — carryover from last year's rows (only rows that still have availability).
    const prevRows = await LeaveBalanceModel.find({ year: year - 1 }).lean<LeaveBalanceDoc[]>().exec();
    for (const row of prevRows) {
      const type = typeById.get(String(row.typeId));
      if (type !== undefined) await this.carryoverForRow(row, type, year);
    }

    // 2 — current-year grants for everyone employed.
    let processed = 0;
    const employed = await employeeRepository.listEmployedSystem();
    for (const employee of employed) {
      for (const type of types) {
        await this.grantForEmployee(employee, type, year);
      }
      processed += 1;
    }

    // 3 — carryover expiry windows that have lapsed.
    const currentRows = await LeaveBalanceModel.find({ year, carriedOver: { $gt: 0 } })
      .lean<LeaveBalanceDoc[]>()
      .exec();
    for (const row of currentRows) {
      const type = typeById.get(String(row.typeId));
      if (type !== undefined) await this.expireCarryoverIfDue(row, type, today);
    }
    return processed;
  }

  /**
   * Hire/rehire grant (§4): employees who join AFTER the boot/year-end run get their pro-rated
   * current-year grant immediately (event-driven; idempotent via the ledger grant key).
   */
  async grantCurrentYearFor(employeeId: string): Promise<void> {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return;
    const year = leaveYearOf(cairoToday());
    for (const type of await leaveTypeRepository.listActiveBanked()) {
      await this.grantForEmployee(employee, type, year);
    }
  }

  /** Exit closure (R12): expire whatever availability remains, every year. */
  async expireAllFor(employeeId: string, note: string): Promise<void> {
    const rows = await LeaveBalanceModel.find({ employeeId: new Types.ObjectId(employeeId) })
      .lean<LeaveBalanceDoc[]>()
      .exec();
    for (const row of rows) {
      const remaining = Math.max(0, availableOf(row));
      if (remaining <= 0) continue;
      await this.appendLedger({
        employeeId: row.employeeId,
        typeId: row.typeId,
        balanceTypeId: row.typeId,
        year: row.year,
        kind: 'expire',
        days: remaining,
        requestId: null,
        effectiveFrom: null,
        effectiveTo: null,
        paidBreakdown: [],
        note,
        by: null,
      });
      await LeaveBalanceModel.updateOne({ _id: row._id }, { $inc: { adjusted: -remaining } }).exec();
    }
  }

  // ── Reads + manual adjustment ─────────────────────────────────────────────

  async balancesFor(employeeId: string, year: number): Promise<LeaveBalanceDto[]> {
    const rows = await LeaveBalanceModel.find({ employeeId: new Types.ObjectId(employeeId), year })
      .lean<LeaveBalanceDoc[]>()
      .exec();
    const types = await leaveTypeRepository.listAll();
    const codeById = new Map(types.map((t) => [String(t._id), t.code]));
    return rows
      .map((r) => ({
        typeId: String(r.typeId),
        typeCode: codeById.get(String(r.typeId)) ?? '?',
        year: r.year,
        granted: r.granted,
        carriedOver: r.carriedOver,
        adjusted: r.adjusted,
        reserved: r.reserved,
        consumed: r.consumed,
        available: availableOf(r),
      }))
      .sort((a, b) => a.typeCode.localeCompare(b.typeCode));
  }

  async availableFor(employeeId: string, balanceTypeId: string, year: number): Promise<number> {
    const row = await LeaveBalanceModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      typeId: new Types.ObjectId(balanceTypeId),
      year,
    })
      .lean<LeaveBalanceDoc>()
      .exec();
    return row === null ? 0 : availableOf(row);
  }

  /** Sum of reserved+consumed days of a TYPE (not balance target) in a year — per-year caps. */
  async usedOfTypeInYear(employeeId: string, typeId: string, year: number): Promise<number> {
    const rows = await LeaveLedgerModel.aggregate<{ _id: string; total: number }>([
      {
        $match: {
          employeeId: new Types.ObjectId(employeeId),
          typeId: new Types.ObjectId(typeId),
          year,
          kind: { $in: ['reserve', 'consume', 'release'] },
        },
      },
      { $group: { _id: '$kind', total: { $sum: '$days' } } },
    ]).exec();
    const byKind = new Map(rows.map((r) => [r._id, r.total]));
    // consume decrements the reservation it finalizes, so used = reserve − release.
    return Math.max(0, (byKind.get('reserve') ?? 0) - (byKind.get('release') ?? 0));
  }

  /** Times a type was ever consumed/reserved across the whole service (Hajj/maternity caps). */
  async occasionsOfTypeAllTime(employeeId: string, typeId: string): Promise<number> {
    const ids = await LeaveLedgerModel.distinct('requestId', {
      employeeId: new Types.ObjectId(employeeId),
      typeId: new Types.ObjectId(typeId),
      kind: { $in: ['reserve', 'consume'] },
      requestId: { $ne: null },
    }).exec();
    return ids.length;
  }

  async ledgerFor(
    employeeId: string,
    query: { typeId?: string | undefined; year?: number | undefined; page: number; pageSize: number },
  ): Promise<Paginated<LeaveLedgerDoc>> {
    const filter: Record<string, unknown> = { employeeId: new Types.ObjectId(employeeId) };
    if (query.typeId !== undefined) filter['typeId'] = new Types.ObjectId(query.typeId);
    if (query.year !== undefined) filter['year'] = query.year;
    const totalItems = await LeaveLedgerModel.countDocuments(filter).exec();
    const items = await LeaveLedgerModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<LeaveLedgerDoc[]>()
      .exec();
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  /** Audited manual correction (leave.adjustBalances); reason is mandatory. */
  async adjust(ctx: AuthContext, employeeId: string, input: AdjustLeaveBalance): Promise<void> {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) throw new NotFoundError('employee not found');
    const type = await leaveTypeRepository.findById(input.typeId);
    if (type === null) throw new NotFoundError('leave type not found');
    if (type.balanceSource !== 'self') {
      throw new BusinessRuleError('balances exist for banked types only');
    }
    await this.ensureRow(employeeId, input.typeId, input.year);
    await this.appendLedger({
      employeeId: new Types.ObjectId(employeeId),
      typeId: new Types.ObjectId(input.typeId),
      balanceTypeId: new Types.ObjectId(input.typeId),
      year: input.year,
      kind: 'adjust',
      days: input.days,
      requestId: null,
      effectiveFrom: null,
      effectiveTo: null,
      paidBreakdown: [],
      note: input.reason,
      by: new Types.ObjectId(ctx.userId),
    });
    await LeaveBalanceModel.updateOne(
      { employeeId: new Types.ObjectId(employeeId), typeId: new Types.ObjectId(input.typeId), year: input.year },
      { $inc: { adjusted: input.days } },
    ).exec();
    await auditService.record({
      entityRef: entityRef(employeeId),
      action: 'leaveBalanceAdjustment',
      changes: [
        { field: 'typeId', old: null, new: input.typeId },
        { field: 'days', old: null, new: String(input.days) },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    await emit(HrLeaveEvents.BalanceAdjusted, {
      employeeId,
      typeId: input.typeId,
      year: input.year,
      days: input.days,
    });
    if (employee.userId !== null) {
      await notificationsService
        .notify({
          template: HrLeaveTemplates.BalanceAdjusted,
          to: { userIds: [String(employee.userId)] },
          data: { typeCode: type.code, days: String(input.days), year: String(input.year) },
          entityRef: entityRef(employeeId),
        })
        .catch(() => undefined);
    }
  }

  /** Maintenance: recompute one employee's cache rows from the ledger (drift reconciliation). */
  async rebuildFor(employeeId: string): Promise<void> {
    const sums = await LeaveLedgerModel.aggregate<{
      _id: { balanceTypeId: Types.ObjectId; year: number; kind: string };
      total: number;
    }>([
      {
        $match: { employeeId: new Types.ObjectId(employeeId), balanceTypeId: { $ne: null } },
      },
      {
        $group: {
          _id: { balanceTypeId: '$balanceTypeId', year: '$year', kind: '$kind' },
          total: { $sum: '$days' },
        },
      },
    ]).exec();
    const rows = new Map<
      string,
      { typeId: Types.ObjectId; year: number; sums: Map<string, number> }
    >();
    for (const s of sums) {
      const key = `${String(s._id.balanceTypeId)}:${String(s._id.year)}`;
      const row = rows.get(key) ?? { typeId: s._id.balanceTypeId, year: s._id.year, sums: new Map() };
      row.sums.set(s._id.kind, s.total);
      rows.set(key, row);
    }
    for (const row of rows.values()) {
      const g = (k: string): number => row.sums.get(k) ?? 0;
      await LeaveBalanceModel.updateOne(
        { employeeId: new Types.ObjectId(employeeId), typeId: row.typeId, year: row.year },
        {
          $set: {
            granted: g('grant'),
            carriedOver: g('carryover'),
            adjusted: g('adjust') - g('expire'),
            reserved: g('reserve') - g('release') - g('consume'),
            consumed: g('consume'),
          },
        },
        { upsert: true },
      ).exec();
    }
  }
}

export const leaveBalanceService = new LeaveBalanceService();
