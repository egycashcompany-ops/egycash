// Warehouses (design §2.3.5, §5.3, §7.2, §19.3): the stores of each branch, audited, no events.
// Nothing is deleted: `isActive: false` retires a warehouse, which keeps its code and name.
//
// A BRANCH RECORD, READ FAIL-CLOSED. Every read goes through the caller's selector for the key the
// route authorized, and the repository answers it with the shared branch rule (PC-12): an
// organization holder reads everything (narrowed by the top bar's branch), a branch holder their
// branches, a home department or section holder their branch, a department copy the branch it sits
// in, `own` nothing. A browser `branchId` only narrows — outside the reach it is a 400 — and a
// warehouse outside the reach is a 404, on a read and on an edit alike.
//
// WRITES ARE THE KEY'S IN THE BRANCH. A create asks that `.create` reach the body's branch; an edit
// loads the warehouse through `.edit`'s own selector (a key the caller does not hold reads as
// `own`, which finds nothing), then asks that `.edit` reach its branch. A department or section
// grant never does — those read, and never write — and the department a warehouse names is
// reference-only (OD-10 department (i)), so it widens nothing. Master-data's organization rule
// (OD-04) is not asked: warehouses are branch records (§6.7).
//
// THE CHECKS. An edit is first held to its version, so a body written against an older row is a
// 409 before any rule judges it. A keeper named anew must be somebody the picker would offer this
// writer — inside the reach of the people keys they hold, else a 404 as the picker's by-id read
// answers, before anything is said of their status — and must still work here; a branch or
// department named anew must be an active one, the department a copy in the warehouse's own
// branch; a retirement asks what holds the warehouse (OD-70 B). Names and codes are checked before
// the write for the early answer, and a unique index refusing a write that raced past is answered
// with the field it guards (§5.15).
import {
  foldName,
  type AdministrationDuplicateField,
  type AdministrationWarehouseBranchOptionDto,
  type AdministrationWarehouseKeeperDto,
  type CreateAdministrationWarehouse,
  type ListAdministrationWarehousesQuery,
  type LocalizedString,
  type Paginated,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { branchRepository, departmentRepository } from '../../../../platform/organization';
import { branchScopeBranches, narrowToBranch } from '../../../../shared/base/branch-scope';
import { ForbiddenError, NotFoundError, type AppError } from '../../../../shared/errors';
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../../shared/types';
import { administrationPeopleService, peopleScopesOf } from '../../people/index';
import { activeBranchIds } from '../../shared/branch-scope';
import {
  assertCurrentVersion,
  assertNotTaken,
  explainDuplicate,
  masterSearchClause,
} from '../../shared/master-data';
import { auditWarehouseCreated, auditWarehouseEdited } from './warehouse-audit';
import { warehouseHolds } from './warehouse-holds';
import { deactivationProblem, isRetirement, keeperRefusal } from './warehouse-rules';
import { type AdministrationWarehouseDoc } from './warehouse.model';
import { administrationWarehouseRepository as repository } from './warehouse.repository';

const VIEW = 'administrationWarehouse.view';
const CREATE = 'administrationWarehouse.create';
const EDIT = 'administrationWarehouse.edit';

/** The names a warehouse's DTO carries (§19.4): its branch's, and its keeper as HR answers now. */
export interface WarehouseLabels {
  branches: ReadonlyMap<string, LocalizedString>;
  keepers: ReadonlyMap<string, AdministrationWarehouseKeeperDto>;
}

/** The code and the name a write would leave the row with — what the duplicate checks compare. */
interface Claim {
  branchId: string;
  nameKey: string;
  code: string;
}

/** An id as the database spells it: the contract takes A-F too, and ids compare as strings. */
const canonicalId = (id: string): string => String(new Types.ObjectId(id));

/** A nullable id as the body sends it — absent (keep), null (clear) or an id — canonicalised. */
const canonicalRef = (id: string | null | undefined): string | null | undefined =>
  id === undefined || id === null ? id : canonicalId(id);

/** A stored reference as the body would spell it, for "did the edit change it?". */
const idOf = (id: Types.ObjectId | null): string | null => (id === null ? null : String(id));

const refuseIf = (refusal: AppError | null): void => {
  if (refusal !== null) throw refusal;
};

class AdministrationWarehouseService {
  /** The register, within the reader's `.view` reach; a `branchId` outside it is a 400. */
  async list(
    query: ListAdministrationWarehousesQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AdministrationWarehouseDoc>> {
    const scope = scopeSelector(ctx, VIEW);
    const branchId = query.branchId === undefined ? undefined : canonicalId(query.branchId);
    const filter: Record<string, unknown> = { ...narrowToBranch(scope, branchId) };
    if (query.type !== undefined) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const search = masterSearchClause(query.search);
    if (search !== null) filter.$or = search;
    // The scope is its own `$and` clause in the repository's filter, so the narrowing above can
    // never overwrite it.
    return repository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'name.ar', 'createdAt'],
      scope,
    });
  }

  /** One warehouse, retired or not, within the reader's `.view` reach — else a 404. */
  async get(id: string, ctx: AuthContext): Promise<AdministrationWarehouseDoc> {
    const doc = await repository.findById(id, scopeSelector(ctx, VIEW));
    if (doc === null) throw new NotFoundError('warehouse not found');
    return doc;
  }

  /**
   * The DTO's `canEdit`: whether `update` would take this reader's edit, so the screen can trust
   * it (§19.3) — `.edit` reaches the warehouse's branch, AND its selector, which the top bar
   * narrows, loads the row. An organization editor narrowed to A who just created a store in B
   * is told false: their PATCH would find nothing until the top bar lets B back in.
   */
  canEdit(ctx: AuthContext, doc: AdministrationWarehouseDoc): boolean {
    const branchId = String(doc.branchId);
    const loadable = branchScopeBranches(scopeSelector(ctx, EDIT));
    return (
      keyReachesBranch(ctx, EDIT, branchId) && (loadable === 'all' || loadable.includes(branchId))
    );
  }

  /** The labels of the rows at hand, read by id and unfiltered: a closed branch still names itself. */
  async labels(docs: readonly AdministrationWarehouseDoc[]): Promise<WarehouseLabels> {
    const keeperIds = docs.flatMap((doc) =>
      doc.responsibleEmployeeId === null ? [] : [String(doc.responsibleEmployeeId)],
    );
    const [branches, keepers] = await Promise.all([
      this.branchNames(docs.map((doc) => String(doc.branchId))),
      administrationPeopleService.keepers(keeperIds),
    ]);
    return { branches, keepers };
  }

  /**
   * Every active branch, named and ordered as the top bar's switcher names and orders them, each
   * with what this reader may do there (§19.3): `canView` is `.view`'s reach under the top bar's
   * choice — so the register's filter never offers a branch it would then answer empty — and
   * `canCreate` is `.create`'s reach, which the top bar does not narrow (a write names its branch).
   */
  async branchOptions(ctx: AuthContext): Promise<AdministrationWarehouseBranchOptionDto[]> {
    const ids = await activeBranchIds();
    const names = await this.branchNames(ids);
    const viewable = branchScopeBranches(scopeSelector(ctx, VIEW));
    return ids.flatMap((branchId) => {
      const name = names.get(branchId);
      if (name === undefined) return [];
      return [
        {
          branchId,
          name,
          canView: viewable === 'all' || viewable.includes(branchId),
          canCreate: keyReachesBranch(ctx, CREATE, branchId),
        },
      ];
    });
  }

  async create(
    input: CreateAdministrationWarehouse,
    ctx: AuthContext,
  ): Promise<AdministrationWarehouseDoc> {
    const branchId = canonicalId(input.branchId);
    // The scope that hides another branch's stores from the caller must not let them open one.
    if (!keyReachesBranch(ctx, CREATE, branchId)) {
      throw new ForbiddenError(`${CREATE} does not reach this branch`);
    }
    if (!(await activeBranchIds()).includes(branchId)) {
      throw new NotFoundError('no such active branch');
    }
    const departmentId = canonicalRef(input.departmentId) ?? null;
    const keeperId = canonicalRef(input.responsibleEmployeeId) ?? null;
    await this.assertDepartment(departmentId, branchId);
    await this.assertKeeper(keeperId, ctx);
    const claim: Claim = { branchId, nameKey: foldName(input.name.ar), code: input.code };
    await assertNotTaken(() => this.takenField(claim, undefined));

    await repository.ensureCollection();
    let doc: AdministrationWarehouseDoc;
    try {
      doc = await repository.create(
        {
          code: claim.code,
          name: input.name,
          nameKey: claim.nameKey,
          branchId: new Types.ObjectId(branchId),
          type: input.type,
          departmentId: departmentId === null ? null : new Types.ObjectId(departmentId),
          responsibleEmployeeId: keeperId === null ? null : new Types.ObjectId(keeperId),
          location: input.location ?? null,
          notes: input.notes ?? null,
          isActive: true,
        },
        { by: ctx.userId },
      );
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, undefined));
    }
    await auditWarehouseCreated(doc);
    return doc;
  }

  async update(
    id: string,
    input: UpdateAdministrationWarehouse,
    ctx: AuthContext,
  ): Promise<AdministrationWarehouseDoc> {
    const scope = scopeSelector(ctx, EDIT);
    const before = await repository.findById(id, scope);
    if (before === null) throw new NotFoundError('warehouse not found');
    const branchId = String(before.branchId);
    // Read is not write: a department or section holder finds their branch's stores and edits none.
    if (!keyReachesBranch(ctx, EDIT, branchId)) {
      throw new ForbiddenError(`${EDIT} does not reach this warehouse's branch`);
    }
    assertCurrentVersion(before, input.version);
    const warehouseId = String(before._id);

    // A reference the edit leaves as it was is kept, retired or left as it may be; only one it
    // names anew is judged.
    const departmentId = canonicalRef(input.departmentId);
    const keeperId = canonicalRef(input.responsibleEmployeeId);
    const isDepartmentNamed =
      departmentId !== undefined && departmentId !== idOf(before.departmentId);
    const isKeeperNamed = keeperId !== undefined && keeperId !== idOf(before.responsibleEmployeeId);
    if (isDepartmentNamed) await this.assertDepartment(departmentId, branchId);
    if (isKeeperNamed) await this.assertKeeper(keeperId, ctx);
    if (isRetirement(before, input.isActive)) {
      refuseIf(deactivationProblem(await warehouseHolds(warehouseId)));
    }
    const claim: Claim = {
      branchId,
      nameKey: input.name === undefined ? before.nameKey : foldName(input.name.ar),
      code: input.code ?? before.code,
    };
    await assertNotTaken(() => this.takenField(claim, warehouseId));

    // Never `branchId`: the store's branch is set once, at its create (§2.3.5).
    const set: Partial<AdministrationWarehouseDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = claim.nameKey;
    }
    if (input.type !== undefined) set.type = input.type;
    if (isDepartmentNamed) {
      set.departmentId = departmentId === null ? null : new Types.ObjectId(departmentId);
    }
    if (isKeeperNamed) {
      set.responsibleEmployeeId = keeperId === null ? null : new Types.ObjectId(keeperId);
    }
    if (input.location !== undefined) set.location = input.location;
    if (input.notes !== undefined) set.notes = input.notes;
    // A deactivation is this field (§5.3), judged above by what holds the warehouse (OD-70 B).
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationWarehouseDoc;
    try {
      updated = await repository.updateById(id, set, {
        by: ctx.userId,
        version: input.version,
        scope,
      });
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, warehouseId));
    }
    await auditWarehouseEdited(before, updated);
    return updated;
  }

  /** The branches' names, by id, read unfiltered — the switcher's names, retired ones included. */
  private async branchNames(ids: readonly string[]): Promise<ReadonlyMap<string, LocalizedString>> {
    const branches = await branchRepository.findByIdsSystem([...new Set(ids)]);
    return new Map(
      branches.map((branch) => [String(branch._id), { ar: branch.name.ar, en: branch.name.en }]),
    );
  }

  /**
   * A department named anew is an active department copy of the warehouse's own branch: the Unit
   * a count or an adjustment is approved over (§7.6) pairs the two, and a copy in another branch
   * would pair the store with that branch's managers. Anything else names no such department: 404.
   */
  private async assertDepartment(departmentId: string | null, branchId: string): Promise<void> {
    if (departmentId === null) return;
    const department = await departmentRepository.findById(departmentId);
    if (
      department === null ||
      department.status !== 'active' ||
      String(department.branchId) !== branchId
    ) {
      throw new NotFoundError('no such active department in this branch');
    }
  }

  /**
   * A keeper named anew is somebody the picker would offer this writer, and still works here.
   *
   * The reach first: a person the directory knows is read again through the picker's own scoped
   * by-id read (`peopleScopesOf`), which answers 404 outside it — so a body cannot name, and the
   * DTO then print, somebody `GET /people/:employeeId` hides from this writer (§7.8: the picker
   * keeps the scoped read). It runs before the leaver rule, so nobody's status is told outside
   * the reach. Then `keeperRefusal`. An id the directory cannot read passes both, as OD-44's rule
   * does: no HR source, or a person it does not know.
   */
  private async assertKeeper(employeeId: string | null, ctx: AuthContext): Promise<void> {
    if (employeeId === null) return;
    const keeper = await administrationPeopleService.find(employeeId);
    if (keeper !== null) await administrationPeopleService.get(employeeId, peopleScopesOf(ctx));
    refuseIf(keeperRefusal(keeper));
  }

  /**
   * What a live warehouse, `exceptId` aside, already holds: the name in this branch, then the code
   * anywhere — the early answer, and the field a unique index guarded after it refused a write.
   */
  private async takenField(
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    if (
      (await repository.findLiveByBranchAndNameKey(claim.branchId, claim.nameKey, exceptId)) !==
      null
    ) {
      return 'name';
    }
    if ((await repository.findLiveByCode(claim.code, exceptId)) !== null) return 'code';
    return null;
  }
}

export const administrationWarehouseService = new AdministrationWarehouseService();
