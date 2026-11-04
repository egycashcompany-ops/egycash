// The query/write surface replenishments and maintenances SHARE — one lifecycle, two collections
// (legacy `atm_rep_log` / `atm_maint_log` differ only in their extra fields). Everything here is
// a port of a specific legacy query, cited inline.
import { Types, type ClientSession, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type BaseDocFields } from '../../../shared/base/base.model';
import { type ScopeSelector } from '../../../shared/types';
import { ATM_OPEN_BOARD_MAX_ROWS, type Paginated } from '@ecms/contracts';
import { cairoDayRange, cairoShiftWindow } from './cairo-time';
import { boardNames, storedSpellingsOf } from './board-filter';
import { OPEN_BOARD_ORDER } from './open-board-index';

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

/** The open board's two filters and the caller's scope — what the list and the board read share. */
export interface OpenBoardParams {
  banks?: readonly string[] | undefined;
  areas?: readonly string[] | undefined;
  scope: ScopeSelector;
}

export interface OpenListParams extends OpenBoardParams {
  page: number;
  pageSize: number;
}

/** The board read's answer — see `AtmOpenBoardDto` in the contracts. */
export interface OpenBoard<T> {
  items: T[];
  truncated: boolean;
  totalItems: number;
}

/** An open row's two filterable names, as `openNames` reads them. */
export interface OpenNames {
  bankName: string;
  area: string;
}

/** Pure: each stored value of `field` once — what `distinct` answered, read off the rows. */
export const distinctOf = (rows: readonly OpenNames[], field: keyof OpenNames): string[] => [
  ...new Set(
    rows.map((row) => row[field]).filter((value): value is string => typeof value === 'string'),
  ),
];

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
    return this.list({
      filter: await this.openFilter(params),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'area',
      sortDir: 'desc',
      sortableFields: ['area'],
      scope: params.scope,
    });
  }

  /**
   * The open board WHOLE, in one read — what the screens show (GET /atm/{kind}/board). The same
   * rows, filters, scope and order as `listOpen`, without its pages: ONE `find`, lean, no
   * `countDocuments`. The paged list cost the board a find and a count per page, every page read
   * again on every realtime signal by every viewer; this is one query per refresh.
   *
   * Cut at `cap` rows (`ATM_OPEN_BOARD_MAX_ROWS`): one row past it is asked for, so a board that
   * fits is never counted, and only a board that does not is — once — to say how far it runs.
   *
   * Index: an organization-wide caller has no `branchId` to lead `ix_branch_open_area` with, so
   * without `ix_open_board` (partial on the open, live rows, keyed in the board order) its read
   * was a scan of the whole log, closed history included. A branch caller is served by either.
   */
  async listOpenBoard(
    params: OpenBoardParams,
    cap: number = ATM_OPEN_BOARD_MAX_ROWS,
  ): Promise<OpenBoard<T>> {
    const filter = this.baseFilter(params.scope, await this.openFilter(params));
    const rows = await this.model
      .find(filter)
      .sort(OPEN_BOARD_ORDER)
      .limit(cap + 1)
      .lean<T[]>()
      .exec();
    if (rows.length <= cap) return { items: rows, truncated: false, totalItems: rows.length };
    const totalItems = await this.model.countDocuments(filter).exec();
    return { items: rows.slice(0, cap), truncated: true, totalItems };
  }

  /**
   * The open rows' filter for a bank and area choice, before scope and soft delete (`baseFilter`
   * adds both). A requested name is resolved to every stored spelling of it first — over the open
   * rows in scope, one read for both filters (`openNames`) — so the filter itself is a plain `$in`
   * on the stored field.
   */
  private async openFilter(params: OpenBoardParams): Promise<FilterQuery<T>> {
    const filter: Record<string, unknown> = { closedAt: null };
    const banks = params.banks ?? [];
    const areas = params.areas ?? [];
    if (banks.length === 0 && areas.length === 0) return filter as FilterQuery<T>;
    const names = await this.openNames(params.scope);
    if (banks.length > 0) {
      filter.bankName = { $in: storedSpellingsOf(distinctOf(names, 'bankName'), banks) };
    }
    if (areas.length > 0) {
      filter.area = { $in: storedSpellingsOf(distinctOf(names, 'area'), areas) };
    }
    return filter as FilterQuery<T>;
  }

  /**
   * Which of these machine codes already have an OPEN operation of this kind ON `day` (a Cairo
   * calendar day). It was the owner's rule's question (shared/open-operation.ts) and is now the
   * mail `duplication` flag's only — a warning, asked of the maintenance log (OD-1c). COMPANY-WIDE
   * and therefore unscoped on purpose — a code open in a branch the caller cannot read still flags
   * — so it answers with codes only, never a row: nothing about the other branch can leave through
   * it.
   *
   * Asked by the open time's day RANGE, not by the stored `openDay`, so a row written before that
   * field existed counts for its day all the same. `exceptIds` leaves rows out.
   */
  async openMachineCodes(
    machineCodes: readonly string[],
    day: string,
    exceptIds: readonly string[] = [],
    session: ClientSession | null = null,
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
      .session(session)
      .exec()) as string[];
    return new Set(open);
  }

  /**
   * The same question for one code on one day, not counting `exceptId` — the mail ingest's
   * `duplicationAtIngest`. An empty code identifies no machine, so it is never open: the same
   * exclusion `openMachineCodes` makes.
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

  /**
   * The bank and area of every open row in scope — what the dropdowns list and a filter's names
   * resolve against (`storedSpellingsOf`), from ONE read.
   *
   * A projected `find` in the board order, not a `distinct` per field: the planner only considers
   * a partial index for a query that names its keys in a predicate or in the sort, and `distinct`
   * has no sort — so for an organization-wide caller, with no branch to lead `ix_branch_open_area`
   * with, every dropdown and every filtered board read scanned the whole log, closed history
   * included. Sorted in the board order, the same rows come from `ix_open_board`, open rows only,
   * and are made distinct here (`distinctOf`).
   */
  private async openNames(scope: ScopeSelector): Promise<OpenNames[]> {
    return this.model
      .find(this.baseFilter(scope, { closedAt: null } as FilterQuery<T>))
      .select({ bankName: 1, area: 1 })
      .sort(OPEN_BOARD_ORDER)
      .lean<OpenNames[]>()
      .exec();
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
    // One read of the open rows' bank and area (`openNames`); the cascade narrows it here, to the
    // rows of the chosen banks' every stored spelling — what a second query over `bankName $in`
    // used to answer.
    const names = await this.openNames(scope);
    const storedBanks = distinctOf(names, 'bankName');
    const chosen =
      selectedBanks.length > 0 ? new Set(storedSpellingsOf(storedBanks, selectedBanks)) : null;
    const storedAreas = distinctOf(
      chosen === null ? names : names.filter((row) => chosen.has(row.bankName)),
      'area',
    );
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
   * everything opened in [from, to) — that day, or since 2026-11-02 a period of days — and how much
   * of it is still open. Deleted rows are excluded by `baseFilter`, exactly as the legacy
   * `deleted: 0` match did.
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
    meta: { by: string; scope: ScopeSelector; onlyOpen?: boolean; session?: ClientSession },
  ): Promise<T[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    const extra: FilterQuery<T> = { _id: { $in: objectIds } } as FilterQuery<T>;
    if (meta.onlyOpen === true) (extra as Record<string, unknown>).closedAt = null;
    const filter = this.baseFilter(meta.scope, extra);
    await this.model
      .updateMany(
        filter,
        {
          $set: { ...set, updatedBy: new Types.ObjectId(meta.by) },
          $inc: { __v: 1 },
        } as UpdateQuery<T>,
        meta.session === undefined ? {} : { session: meta.session },
      )
      .exec();
    return this.findByIds(ids, meta.scope, meta.session ?? null);
  }

  /** The rows of `ids` the caller's scope reaches, as stored now — a bulk write's answer. */
  async findByIds(
    ids: readonly string[],
    scope: ScopeSelector,
    session: ClientSession | null = null,
  ): Promise<T[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    return this.model
      .find(this.baseFilter(scope, { _id: { $in: objectIds } } as FilterQuery<T>))
      .session(session)
      .lean<T[]>()
      .exec();
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
