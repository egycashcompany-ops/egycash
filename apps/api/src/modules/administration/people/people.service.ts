// WHO THE MODULE MAY NAME (design §7.8) — the company's employees, as the module's screens print
// them, under the module's own keys. In Phase 1 that is a warehouse's keeper, «أمين المخزن»
// (OD-10 keeper (i)); from P2.2 a purchase request's requester, who is always the caller (OD-16 A,
// design §7.3) and so is read as the caller's own employee (`self`), never picked; the recipients of
// later documents join with their phases. Every person the module names comes through this door.
//
// Never through HR: no `employee.view`, which is the whole HR file, and no import of HR. The
// module asks the platform directory, which is the org chart answering a question, and publishes
// exactly the seven facts of `AdministrationPersonDto`. It stores and writes none of it: every fact
// is HR's and is read fresh — a keeper's name included, so no name copy of a person sits on a
// warehouse for HR's permanent delete to chase.
//
// Two reads, both scoped to the keys that open them (IT's `/it/people` shape, not its unscoped
// hand-over box: a warehouse's keeper works in its branch):
//   • the PICKER — the people who work here today, for the text typed: a new reference never names
//     a leaver;
//   • ONE PERSON by id, whatever their status — a form holding a stored keeper still shows who it
//     is, a leaver marked as one.
// Beside them, the warehouse feature's two system reads: the keeper a write names, whom the write
// then holds to the picker's own reach (`peopleScopesOf`, then `get`) before the rule that refuses
// a leaver judges them, and the keepers a page of warehouses names. And the documents' two (P2.2):
// the caller's own employee, and the snapshot a document copies of a person (design §2.1, D-22) —
// the one fact the module STORES of somebody, frozen once the document leaves draft, so a reprint
// reproduces the signed paper; HR's permanent delete rewrites its name (§6.4 of the P2 plan).
import {
  type AdministrationPersonDto,
  type AdministrationWarehouseKeeperDto,
  type ListAdministrationPeopleQuery,
  type LocalizedString,
  type Paginated,
} from '@ecms/contracts';
import {
  getDirectoryEmployee,
  getDirectoryEmployees,
  getSelfDirectoryEmployee,
  searchDirectoryEmployees,
  type DirectoryEmployee,
} from '../../../platform/directory';
import { departmentRepository, jobTitleRepository } from '../../../platform/organization';
import { NotFoundError } from '../../../shared/errors';
import {
  hasPermission,
  scopeSelector,
  type AuthContext,
  type ScopeSelector,
} from '../../../shared/types';
import { toAdministrationKeeperDto, toAdministrationPersonDto } from '../administration.mappers';

/**
 * The keys that open the people reads: whoever names a warehouse's keeper — on a create or an edit
 * (§7.8). A purchase request adds none: its requester is the caller, read through `self`, so no
 * picker names a person (OD-16 A). The list grows only with a document whose form picks one.
 */
export const ADMINISTRATION_PEOPLE_GRANTS: readonly [string, ...string[]] = [
  'administrationWarehouse.create',
  'administrationWarehouse.edit',
];

/**
 * Where the picker reaches for this caller: one selector per gate key they hold, each exactly as
 * its register applies it, OR-ed by the directory (`anyOfScopes`). Never the widest key standing
 * for the others: a create key over A and an edit key over B reach both. Here, not in the
 * controller, because a write that names a person is held to this same reach — what the picker
 * would not offer, the body cannot name either.
 */
export const peopleScopesOf = (ctx: AuthContext): ScopeSelector[] =>
  ADMINISTRATION_PEOPLE_GRANTS.filter((key) => hasPermission(ctx, key)).map((key) =>
    scopeSelector(ctx, key),
  );

/**
 * What a document prints beside a person's name (design §2.1, `PersonSnap`): the employee code,
 * the job title and the department, each name as the organization catalogue holds it at the
 * moment of the copy. `departmentId` is reference-only: it is the department the name was read
 * for, and it grants nothing.
 */
export interface AdministrationPersonSnap {
  employeeCode: string | null;
  jobTitle: LocalizedString | null;
  departmentId: string | null;
  departmentName: LocalizedString | null;
}

/** One organization unit's name, or null for no id or a unit no longer on file. */
const unitName = async (
  units: {
    findByIdsSystem: (ids: readonly string[]) => Promise<{ name: LocalizedString }[]>;
  },
  id: string | null | undefined,
): Promise<LocalizedString | null> => {
  if (id === null || id === undefined) return null;
  const [unit] = await units.findByIdsSystem([id]);
  return unit === undefined ? null : { ar: unit.name.ar, en: unit.name.en };
};

class AdministrationPeopleService {
  /**
   * The picker: one page of the people employed today whom ANY of `scopes` reaches — one selector
   * per gate key the caller holds, OR-ed by the directory, so no key's reach is traded for
   * another's. EMPTY scopes read nobody, never everybody.
   */
  async list(
    query: ListAdministrationPeopleQuery,
    scopes: readonly ScopeSelector[],
  ): Promise<Paginated<AdministrationPersonDto>> {
    const page = await searchDirectoryEmployees({
      search: query.search,
      status: 'employed',
      branchId: query.branchId,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      anyOfScopes: scopes,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: page.items.map(toAdministrationPersonDto), meta: page.meta };
  }

  /**
   * One person by id, through the same scoped read as the picker — a person the reader could not
   * find by searching is a 404 here too — but of every status: resolving a stored id is not
   * offering it (ADR-019 rule 5).
   */
  async get(
    employeeId: string,
    scopes: readonly ScopeSelector[],
  ): Promise<AdministrationPersonDto> {
    const page = await searchDirectoryEmployees({
      employeeIds: [employeeId],
      status: 'all',
      anyOfScopes: scopes,
      page: 1,
      pageSize: 1,
    });
    const person = page.items[0];
    if (person === undefined) throw new NotFoundError('employee not found');
    return toAdministrationPersonDto(person);
  }

  /**
   * The person a write names, unscoped, or null when the directory cannot say — no HR source, or
   * an id it does not know. A person it can name is then held to the writer's reach (`get` over
   * `peopleScopesOf`), and the write's own rule decides the rest (`keeperRefusal`).
   */
  async find(employeeId: string): Promise<DirectoryEmployee | null> {
    return getDirectoryEmployee(employeeId);
  }

  /**
   * The caller's own employee — the login's link, as the directory answers it — or null for a
   * login that names none, or no HR source. A document's requester is read this way only (OD-16
   * A): nobody names another person as the one asking.
   */
  async self(userId: string): Promise<DirectoryEmployee | null> {
    return getSelfDirectoryEmployee(userId);
  }

  /**
   * The person as a document copies them (design §2.1, D-22): the directory's Arabic name, and
   * the snapshot printed beside it. IT's receipt holder without its identity facts: the job
   * title's and the department's names are the organization catalogue's, each null when the id is
   * null or names no row. It never refuses — the document's own rules judge the person first.
   */
  async resolvePerson(
    employee: DirectoryEmployee,
  ): Promise<{ name: string; snap: AdministrationPersonSnap }> {
    const [jobTitle, departmentName] = await Promise.all([
      unitName(jobTitleRepository, employee.jobTitleId),
      unitName(departmentRepository, employee.departmentId),
    ]);
    return {
      name: employee.fullNameAr,
      snap: {
        employeeCode: employee.code,
        jobTitle,
        departmentId: employee.departmentId,
        departmentName,
      },
    };
  }

  /**
   * The keepers a page of warehouses names, by id, in one read. An id HR cannot name is simply
   * absent — after a workforce reset, a keeper who is nobody — and the warehouse shows it as such.
   */
  async keepers(
    employeeIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdministrationWarehouseKeeperDto>> {
    if (employeeIds.length === 0) return new Map();
    const found = await getDirectoryEmployees([...new Set(employeeIds)]);
    return new Map(
      [...found.values()].map((employee) => [
        employee.employeeId,
        toAdministrationKeeperDto(employee),
      ]),
    );
  }
}

export const administrationPeopleService = new AdministrationPeopleService();
