// The register's data access (spec §5.2) — and the ONE scope rule every register read obeys.
//
// DEC-29. `BaseRepository.scopeFilter` asks `orgScopeMatch` without options, and over a collection
// that carries a branch but no department or section, a department- or section-scoped grant then
// WIDENS to the whole company (shared/base/org-scope-match.ts). That is the gold lists' rule; it is
// not this register's, where the natural Efficiency grant is department-scoped and a widened read
// would hand every branch's key codes to it. So this repository narrows a finer scope to its
// branch instead (`finerNarrowsToBranch`, the dashboards' rule), and `own` to the rows the caller
// created. The entry list, the CSV export and the Data Report all match through
// `registerScopeMatch`, so the three can never disagree about which rows a caller sees.
//
// Reading is not writing: a department-, section- or own-scoped holder READS within that match,
// but every write and the reveal additionally require the key to cover the entry's branch
// (`keyCoversEntry`, register-secrets.ts).
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { orgScopeMatch } from '../../../shared/base/org-scope-match';
import { type ScopeSelector } from '../../../shared/types';
import { AtmRegisterEntryModel, type AtmRegisterEntryDoc } from './register.model';

/** The ONE match for every register read: entries, export, report. Finer scopes narrow to the branch. */
export const registerScopeMatch = (s: ScopeSelector): Record<string, unknown> =>
  orgScopeMatch(s, { branch: 'branchId' }, { finerNarrowsToBranch: true }) ?? {
    createdBy: new Types.ObjectId(s.userId),
  };

/**
 * The branch ids that match covers: 'all' for organization AND own (own is narrowed by
 * `createdBy`, not by branch). Derived from the SAME selector lists `orgScopeMatch` reads, so the
 * report's branches shown and its counts can never disagree (DEC-27); the spec pins both on the
 * same selectors.
 */
export const registerScopeBranches = (s: ScopeSelector): 'all' | string[] => {
  if (s.scope === 'organization' || s.scope === 'own') return 'all';
  if (s.scope !== 'section') {
    const branchIds = s.branchIds ?? [];
    const departmentIds = s.departmentIds ?? [];
    const departmentBranchIds = s.departmentBranchIds ?? [];
    // A department reach with no branch to narrow to is the one shape `orgScopeMatch` cannot
    // place, and it answers `{}` for it; say the same here. `scopeSelector` never builds it.
    if (departmentIds.length > 0 && departmentBranchIds.length === 0) return 'all';
    if (branchIds.length > 0 || departmentIds.length > 0) {
      return [...new Set([...branchIds, ...departmentBranchIds])];
    }
  }
  return s.branchId === null ? [] : [s.branchId];
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One row of the report's `$group`: ACTIVE entries per (branch, bank). */
export interface AtmRegisterActiveGroup {
  _id: { branchId: Types.ObjectId; bankCode: string | null };
  count: number;
}

/** The fields the branch-options endpoint offers as distinct values (§5.6). */
export type AtmRegisterDistinctField = 'area' | 'operationType' | 'vendor' | 'model' | 'hub';

class AtmRegisterEntryRepository extends BaseRepository<AtmRegisterEntryDoc> {
  constructor() {
    super(AtmRegisterEntryModel, { branchField: 'branchId' });
  }

  /** DEC-29: every scoped read — getById, list, updateById, softDeleteById — narrows the same way. */
  protected override scopeFilter(
    selector: ScopeSelector | undefined,
  ): FilterQuery<AtmRegisterEntryDoc> {
    if (selector === undefined || selector.scope === 'organization') return {};
    return registerScopeMatch(selector) as FilterQuery<AtmRegisterEntryDoc>;
  }

  /** Non-deleted OPEN rows with this code, in any branch — exempt pairs included (DEC-11). */
  async findOpenByCode(
    machineCode: string,
    session?: ClientSession,
  ): Promise<AtmRegisterEntryDoc[]> {
    return this.model
      .find({ isDeleted: false, status: 'open', machineCode })
      .session(session ?? null)
      .lean<AtmRegisterEntryDoc[]>()
      .exec();
  }

  /** The batch form, for the import plan (§6.4): code → its open rows. */
  async findOpenByCodes(
    codes: readonly string[],
  ): Promise<
    Map<
      string,
      { _id: Types.ObjectId; branchId: Types.ObjectId | null; importRow: number | null }[]
    >
  > {
    const out = new Map<
      string,
      { _id: Types.ObjectId; branchId: Types.ObjectId | null; importRow: number | null }[]
    >();
    if (codes.length === 0) return out;
    const rows = await this.model
      .find(
        { isDeleted: false, status: 'open', machineCode: { $in: [...new Set(codes)] } },
        { machineCode: 1, branchId: 1, importRow: 1 },
      )
      .lean<Pick<AtmRegisterEntryDoc, '_id' | 'machineCode' | 'branchId' | 'importRow'>[]>()
      .exec();
    for (const row of rows) {
      if (row.machineCode === null) continue;
      const list = out.get(row.machineCode) ?? [];
      list.push({ _id: row._id, branchId: row.branchId, importRow: row.importRow });
      out.set(row.machineCode, list);
    }
    return out;
  }

  /**
   * Rows whose sealed combination is not on `currentKeyId` — soft-deleted ones INCLUDED, because a
   * deleted entry's ref still has to open after the old key leaves the ring (DEC-33).
   */
  async listCombinationsNotOnKey(
    currentKeyId: string,
    limit: number,
  ): Promise<Pick<AtmRegisterEntryDoc, '_id' | '__v' | 'safeCombination'>[]> {
    return this.model
      .find(
        { safeCombination: { $ne: null }, 'safeCombination.keyId': { $ne: currentKeyId } },
        { safeCombination: 1, __v: 1 },
      )
      .limit(limit)
      .lean<Pick<AtmRegisterEntryDoc, '_id' | '__v' | 'safeCombination'>[]>()
      .exec();
  }

  /** How many OTHER open entries still hold this master (the 2013/2015 pairs, DEC-11). */
  async countOtherOpenForMachine(
    machineId: Types.ObjectId | string,
    excludeEntryId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<number> {
    return this.model
      .countDocuments({
        isDeleted: false,
        status: 'open',
        machineId: new Types.ObjectId(String(machineId)),
        _id: { $ne: new Types.ObjectId(String(excludeEntryId)) },
      })
      .session(session ?? null)
      .exec();
  }

  /** The open entries coupled to a master — they follow its area (DEC-4). */
  async findOpenForMachine(
    machineId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<AtmRegisterEntryDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        status: 'open',
        machineId: new Types.ObjectId(String(machineId)),
      })
      .session(session ?? null)
      .lean<AtmRegisterEntryDoc[]>()
      .exec();
  }

  /**
   * The Data Report's single `$group` (§5.8): ACTIVE = open ∧ branch set (D7). `match` is the
   * caller's `registerScopeMatch`, combined with `$and` so it can never replace the branch clause.
   */
  async groupActive(match: Record<string, unknown>): Promise<AtmRegisterActiveGroup[]> {
    const base = { isDeleted: false, status: 'open', branchId: { $ne: null } };
    return this.model
      .aggregate<AtmRegisterActiveGroup>([
        { $match: Object.keys(match).length === 0 ? base : { $and: [base, match] } },
        { $group: { _id: { branchId: '$branchId', bankCode: '$bankCode' }, count: { $sum: 1 } } },
      ])
      .exec();
  }

  /** Distinct non-empty values of one P field in one branch, sorted, at most 500 (branch options). */
  async distinctValues(field: AtmRegisterDistinctField, branchId: string): Promise<string[]> {
    const values = (await this.model
      .distinct(field, {
        isDeleted: false,
        branchId: new Types.ObjectId(branchId),
        [field]: { $type: 'string', $ne: '' },
      })
      .exec()) as unknown[];
    return values
      .filter((value): value is string => typeof value === 'string')
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 500);
  }

  /**
   * Another OPEN entry, under a different code, carrying the same serial (case-insensitive, exact,
   * escaped) — the D6 `serialDuplicate` warning. A warning only, so a cheap read is enough.
   */
  async findSerialOnOtherOpen(
    serial: string,
    machineCode: string | null,
    excludeEntryId?: string,
  ): Promise<boolean> {
    const filter: Record<string, unknown> = {
      isDeleted: false,
      status: 'open',
      serial: { $regex: `^${escapeRegExp(serial.trim())}$`, $options: 'i' },
    };
    if (machineCode !== null) filter.machineCode = { $ne: machineCode };
    if (excludeEntryId !== undefined) filter._id = { $ne: new Types.ObjectId(excludeEntryId) };
    return (await this.model.exists(filter).exec()) !== null;
  }
}

export const atmRegisterEntryRepository = new AtmRegisterEntryRepository();
export { escapeRegExp as escapeRegisterRegExp };
