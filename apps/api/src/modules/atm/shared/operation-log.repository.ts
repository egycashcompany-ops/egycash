// The query/write surface replenishments and maintenances SHARE — one lifecycle, two collections
// (legacy `atm_rep_log` / `atm_maint_log` differ only in their extra fields). Everything here is
// a port of a specific legacy query, cited inline.
import { Types, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type BaseDocFields } from '../../../shared/base/base.model';
import { type ScopeSelector } from '../../../shared/types';
import { type Paginated } from '@ecms/contracts';
import { cairoDayRange, cairoShiftWindow } from './cairo-time';
import { codesBlockedByMove } from './open-operation';
import { boardNames, storedSpellingsOf } from './board-filter';

/** The lifecycle fields both operation kinds carry. */
export interface AtmOperationLogFields extends BaseDocFields {
  branchId: Types.ObjectId;
  machineId: Types.ObjectId;
  machineCode: string;
  bankName: string;
  machineName: string;
  zone: string;
  area: string;
  openedAt: Date;
  /** The Cairo day of `openedAt` — see `openDayOf` (shared/open-operation.ts). */
  openDay: string | null;
  closedAt: Date | null;
  leaderName: string | null;
  openedById: Types.ObjectId | null;
  openedByName: string | null;
  closedById: Types.ObjectId | null;
  closedByName: string | null;
}

export interface OpenListParams {
  banks?: readonly string[] | undefined;
  areas?: readonly string[] | undefined;
  page: number;
  pageSize: number;
  scope: ScopeSelector;
}

/**
 * Pure: the distinct (branch, area, shift window) groups of a set of rows — one leader cascade per
 * group, for the bulk edit's «الوردية» box, so ten checked rows of one area and shift cost one
 * write, not ten. Keyed by the window's start, which names the shift exactly.
 */
export const leaderCascadeGroups = <
  R extends Pick<AtmOperationLogFields, 'branchId' | 'area' | 'openedAt'>,
>(
  rows: readonly R[],
): R[] => {
  const seen = new Set<string>();
  const groups: R[] = [];
  for (const row of rows) {
    const key = `${String(row.branchId)}|${row.area}|${String(cairoShiftWindow(row.openedAt).start.getTime())}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(row);
  }
  return groups;
};

export class AtmOperationLogRepository<T extends AtmOperationLogFields> extends BaseRepository<T> {
  /**
   * The open board (contad_app.js:263 / :1100): open rows, optionally narrowed by bank and area,
   * sorted by area DESC exactly as every legacy variant did (`.sort({ area: -1 })`).
   *
   * One deliberate deviation, decision D4: the legacy floor `open_time >= today 00:00` made any
   * open row with a PAST open date invisible on every screen forever — it could never be closed
   * again. Open is open here; the client picks the day it shows (today by default, then tomorrow,
   * everything scheduled ahead, or earlier days left open — 2026-10-27), and an earlier day's row
   * keeps the close control the legacy grey group lacked (D4).
   *
   * A requested bank or area matches every stored spelling of it that differs only by
   * surrounding spaces (`board-filter.ts`) — resolved to those spellings first, so the page itself
   * is still a plain `$in` on the stored field, sorted and cut by the same index as before.
   */
  async listOpen(params: OpenListParams): Promise<Paginated<T>> {
    const filter: FilterQuery<T> = { closedAt: null } as FilterQuery<T>;
    if (params.banks !== undefined && params.banks.length > 0) {
      (filter as Record<string, unknown>).bankName = {
        $in: await this.openSpellings('bankName', params.banks, params.scope),
      };
    }
    if (params.areas !== undefined && params.areas.length > 0) {
      (filter as Record<string, unknown>).area = {
        $in: await this.openSpellings('area', params.areas, params.scope),
      };
    }
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'area',
      sortDir: 'desc',
      sortableFields: ['area'],
      scope: params.scope,
    });
  }

  /**
   * The owner's rule (shared/open-operation.ts): which of these machine codes already have an
   * OPEN operation of this kind ON `day` (a Cairo calendar day). COMPANY-WIDE and therefore
   * unscoped on purpose — a code open in a branch the caller cannot read still blocks — so it
   * answers with codes only, never a row: nothing about the other branch can leave through it.
   *
   * Asked by the open time's day RANGE, not by the stored `openDay`, so a row written before that
   * field existed blocks its day all the same. `exceptIds` leaves rows out — a write never blocks
   * itself (a reopen, an edit moving its own rows).
   */
  async openMachineCodes(
    machineCodes: readonly string[],
    day: string,
    exceptIds: readonly string[] = [],
  ): Promise<Set<string>> {
    const wanted = [...new Set(machineCodes)].filter((code) => code !== '');
    if (wanted.length === 0) return new Set();
    const { start, end } = cairoDayRange(day);
    const filter: Record<string, unknown> = {
      isDeleted: false,
      closedAt: null,
      machineCode: { $in: wanted },
      openedAt: { $gte: start, $lt: end },
    };
    const except = exceptIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (except.length > 0) filter._id = { $nin: except };
    const open = (await this.model
      .distinct('machineCode', filter as FilterQuery<T>)
      .exec()) as string[];
    return new Set(open);
  }

  /**
   * The same question for one code on one day, not counting `exceptId` — a reopen never blocks
   * itself. An empty code identifies no machine, so it never blocks: the same exclusion
   * `openMachineCodes` makes and the index's partial filter (`machineCode: { $gt: '' }`) encodes.
   */
  async hasOpenOperation(machineCode: string, day: string, exceptId?: string): Promise<boolean> {
    if (machineCode === '') return false;
    const open = await this.openMachineCodes(
      [machineCode],
      day,
      exceptId === undefined ? [] : [exceptId],
    );
    return open.has(machineCode);
  }

  /** The stored spellings of `field` among the open rows in scope, for `storedSpellingsOf`. */
  private async openSpellings(
    field: 'bankName' | 'area',
    requested: readonly string[],
    scope: ScopeSelector,
  ): Promise<string[]> {
    const stored = (await this.model
      .distinct(field, this.baseFilter(scope, { closedAt: null } as FilterQuery<T>))
      .exec()) as string[];
    return storedSpellingsOf(stored, requested);
  }

  /**
   * The filter dropdown sources, over the open rows in the caller's scope — the same rows, under
   * the same scope, that `listOpen` pages through, so every name offered finds its rows.
   *
   * banks = every open row's bank (contad_app.js:261). areas = the open rows' areas, OF THE
   * SELECTED BANKS when there are any (the saved filter's cascade, contad_app.js:262) and of EVERY
   * open row when there are none. The legacy saved filter offered no area until a bank was chosen
   * (`$in: []`), but the same page's table-header filter row listed every area on the board
   * (atm_replenishment.ejs:1001, atm_maintenance.ejs:1285) — so an area could always be filtered
   * on its own, and the port, which has no header row, restores that here (port doc D8).
   */
  async facets(
    scope: ScopeSelector,
    selectedBanks: readonly string[],
  ): Promise<{ banks: string[]; areas: string[] }> {
    const openFilter = this.baseFilter(scope, { closedAt: null } as FilterQuery<T>);
    const storedBanks = (await this.model.distinct('bankName', openFilter).exec()) as string[];
    const areaFilter: Record<string, unknown> = { closedAt: null };
    if (selectedBanks.length > 0) {
      areaFilter.bankName = { $in: storedSpellingsOf(storedBanks, selectedBanks) };
    }
    const storedAreas = (await this.model
      .distinct('area', this.baseFilter(scope, areaFilter as FilterQuery<T>))
      .exec()) as string[];
    return { banks: boardNames(storedBanks), areas: boardNames(storedAreas) };
  }

  /**
   * The done pages (contad_app.js:972-978): `close_time` inside an inclusive day range, ascending.
   * Days are Cairo calendar days — part of the T1 time normalization; the legacy compared against
   * `Z` boundaries only because it stored shifted clocks.
   */
  async listDone(params: {
    from: string;
    to: string;
    page: number;
    pageSize: number;
    scope: ScopeSelector;
  }): Promise<Paginated<T>> {
    const { start } = cairoDayRange(params.from);
    const { end } = cairoDayRange(params.to);
    return this.list({
      filter: { closedAt: { $gte: start, $lt: end } } as FilterQuery<T>,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'closedAt',
      sortDir: 'asc',
      sortableFields: ['closedAt'],
      scope: params.scope,
    });
  }

  /**
   * The daily report's one aggregation (legacy /reports_atm, contad_app.js:2234-2320): per bank,
   * everything opened that day and how much of it is still open. Deleted rows are excluded by
   * `baseFilter`, exactly as the legacy `deleted: 0` match did.
   */
  async countsByBankForDay(params: {
    from: Date;
    to: Date;
    scope: ScopeSelector;
  }): Promise<{ bankName: string; total: number; open: number }[]> {
    const rows = await this.model
      .aggregate<{ _id: string; total: number; open: number }>([
        {
          $match: this.baseFilter(params.scope, {
            openedAt: { $gte: params.from, $lt: params.to },
          } as FilterQuery<T>),
        },
        {
          $group: {
            _id: '$bankName',
            total: { $sum: 1 },
            open: { $sum: { $cond: [{ $eq: ['$closedAt', null] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    return rows.map((row) => ({ bankName: String(row._id), total: row.total, open: row.open }));
  }

  /**
   * A bulk write over checked rows — the legacy `updateMany({_id: {$in: iddds}})` shape
   * (contad_app.js:800, :875, :904). No version check, deliberately: the legacy multi-actions are
   * last-write-wins over an explicit selection, and imposing optimistic concurrency on them would
   * invent a rule. The scope filter still applies — a caller can only write rows they can see.
   * Returns the affected rows re-read, for the response and the audit trail.
   */
  async updateManyByIds(
    ids: readonly string[],
    set: UpdateQuery<T>['$set'],
    meta: { by: string; scope: ScopeSelector; onlyOpen?: boolean },
  ): Promise<T[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    const extra: FilterQuery<T> = { _id: { $in: objectIds } } as FilterQuery<T>;
    if (meta.onlyOpen === true) (extra as Record<string, unknown>).closedAt = null;
    const filter = this.baseFilter(meta.scope, extra);
    await this.model
      .updateMany(filter, {
        $set: { ...set, updatedBy: new Types.ObjectId(meta.by) },
        $inc: { __v: 1 },
      } as UpdateQuery<T>)
      .exec();
    return this.model
      .find(this.baseFilter(meta.scope, { _id: { $in: objectIds } } as FilterQuery<T>))
      .lean<T[]>()
      .exec();
  }

  /**
   * The owner's per-day rule for the bulk edit of the open time: which of the checked rows' machine
   * codes would be open twice on `day` once every checked row is moved there. Read under the
   * caller's scope (they can only move rows they can see); the "open elsewhere" half is the rule's
   * own company-wide question, the checked rows left out of it. Codes only.
   */
  async codesBlockedOnDay(
    ids: readonly string[],
    day: string,
    scope: ScopeSelector,
  ): Promise<string[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    const rows = await this.model
      .find(this.baseFilter(scope, { _id: { $in: objectIds } } as FilterQuery<T>))
      .select({ machineCode: 1, closedAt: 1 })
      .lean<{ machineCode: string; closedAt: Date | null }[]>()
      .exec();
    const open = rows.filter((row) => row.closedAt === null).map((row) => row.machineCode);
    return codesBlockedByMove(rows, await this.openMachineCodes(open, day, ids));
  }

  /**
   * The bulk edit's cascade: the leader over every open row sharing a checked row's branch, area
   * and shift — one `cascadeLeader` per distinct group (`leaderCascadeGroups`).
   */
  async cascadeLeaderOverRows(
    rows: readonly T[],
    leaderName: string | null,
    by: string,
  ): Promise<number> {
    let touched = 0;
    for (const row of leaderCascadeGroups(rows)) {
      touched += await this.cascadeLeader({
        branchId: row.branchId,
        area: row.area,
        openedAt: row.openedAt,
        leaderName,
        by,
      });
    }
    return touched;
  }

  /**
   * The leader cascade (contad_app.js:861-867 / :2023-2031): every OPEN row of the same branch
   * and area whose open time falls in the same Cairo shift window gets the new leader. Returns
   * how many rows the cascade touched.
   */
  async cascadeLeader(params: {
    branchId: Types.ObjectId;
    area: string;
    openedAt: Date;
    leaderName: string | null;
    by: string;
  }): Promise<number> {
    const window = cairoShiftWindow(params.openedAt);
    const result = await this.model
      .updateMany(
        {
          isDeleted: false,
          branchId: params.branchId,
          area: params.area,
          closedAt: null,
          openedAt: { $gte: window.start, $lt: window.end },
        } as FilterQuery<T>,
        {
          $set: { leaderName: params.leaderName, updatedBy: new Types.ObjectId(params.by) },
          $inc: { __v: 1 },
        } as UpdateQuery<T>,
      )
      .exec();
    return result.modifiedCount;
  }
}
