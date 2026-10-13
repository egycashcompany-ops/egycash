// The query/write surface replenishments and maintenances SHARE — one lifecycle, two collections
// (legacy `atm_rep_log` / `atm_maint_log` differ only in their extra fields). Everything here is
// a port of a specific legacy query, cited inline.
import { Types, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type BaseDocFields } from '../../../shared/base/base.model';
import { type ScopeSelector } from '../../../shared/types';
import { type Paginated } from '@ecms/contracts';
import { cairoDayRange, cairoShiftWindow } from './cairo-time';

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

export class AtmOperationLogRepository<T extends AtmOperationLogFields> extends BaseRepository<T> {
  /**
   * The open board (contad_app.js:263 / :1100): open rows, optionally narrowed by bank and area,
   * sorted by area DESC exactly as every legacy variant did (`.sort({ area: -1 })`).
   *
   * One deliberate deviation, decision D4: the legacy floor `open_time >= today 00:00` made any
   * open row with a PAST open date invisible on every screen forever — it could never be closed
   * again. Open is open here; the client still renders non-today rows as the grey carried-over
   * group (no timer, the visible legacy behaviour) — and, since the owner's rule made an open row
   * of any day block its machine (OD-1), with the close control the legacy group lacked (D4).
   */
  async listOpen(params: OpenListParams): Promise<Paginated<T>> {
    const filter: FilterQuery<T> = { closedAt: null } as FilterQuery<T>;
    if (params.banks !== undefined && params.banks.length > 0) {
      (filter as Record<string, unknown>).bankName = { $in: [...params.banks] };
    }
    if (params.areas !== undefined && params.areas.length > 0) {
      (filter as Record<string, unknown>).area = { $in: [...params.areas] };
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
   * OPEN operation of this kind. COMPANY-WIDE and therefore unscoped on purpose — a code open in
   * a branch the caller cannot read still blocks — so it answers with codes only, never a row:
   * nothing about the other branch can leave through it.
   */
  async openMachineCodes(machineCodes: readonly string[]): Promise<Set<string>> {
    const wanted = [...new Set(machineCodes)].filter((code) => code !== '');
    if (wanted.length === 0) return new Set();
    const open = (await this.model
      .distinct('machineCode', {
        isDeleted: false,
        closedAt: null,
        machineCode: { $in: wanted },
      } as FilterQuery<T>)
      .exec()) as string[];
    return new Set(open);
  }

  /**
   * The same question for one code, not counting `exceptId` — a reopen never blocks itself. An
   * empty code identifies no machine, so it never blocks: the same exclusion `openMachineCodes`
   * makes and the index's partial filter (`machineCode: { $gt: '' }`) encodes.
   */
  async hasOpenOperation(machineCode: string, exceptId?: string): Promise<boolean> {
    if (machineCode === '') return false;
    const filter: Record<string, unknown> = { isDeleted: false, closedAt: null, machineCode };
    if (exceptId !== undefined && Types.ObjectId.isValid(exceptId)) {
      filter._id = { $ne: new Types.ObjectId(exceptId) };
    }
    return (await this.model.exists(filter as FilterQuery<T>).exec()) !== null;
  }

  /**
   * The filter dropdown sources (contad_app.js:261-262): banks = distinct over ALL open rows;
   * areas = distinct over open rows OF THE SELECTED BANKS — with none selected the legacy passed
   * `$in: []` and got an empty area list, and that shape is preserved.
   */
  async facets(
    scope: ScopeSelector,
    selectedBanks: readonly string[],
  ): Promise<{ banks: string[]; areas: string[] }> {
    const openFilter = this.baseFilter(scope, { closedAt: null } as FilterQuery<T>);
    const banks = (await this.model.distinct('bankName', openFilter).exec()) as string[];
    const areas =
      selectedBanks.length === 0
        ? []
        : ((await this.model
            .distinct(
              'area',
              this.baseFilter(scope, {
                closedAt: null,
                bankName: { $in: [...selectedBanks] },
              } as FilterQuery<T>),
            )
            .exec()) as string[]);
    return { banks: banks.sort(), areas: areas.sort() };
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
