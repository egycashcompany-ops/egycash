// WHO THE MODULE MAY NAME (design §7.8) — the company's employees, as the module's screens print
// them, under the module's own keys. In Phase 1 that is a warehouse's keeper, «أمين المخزن»
// (OD-10 keeper (i)); from P2 the documents add their requesters and recipients, each with its key.
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
// Beside them, two system reads for the warehouse feature: the keeper a write names, judged
// unscoped by the rule that refuses a leaver, and the keepers a page of warehouses names.
import {
  type AdministrationPersonDto,
  type AdministrationWarehouseKeeperDto,
  type ListAdministrationPeopleQuery,
  type Paginated,
} from '@ecms/contracts';
import {
  getDirectoryEmployee,
  getDirectoryEmployees,
  searchDirectoryEmployees,
  type DirectoryEmployee,
} from '../../../platform/directory';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { toAdministrationKeeperDto, toAdministrationPersonDto } from '../administration.mappers';

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
   * an id it does not know. The write's own rule decides what that means (`keeperRefusal`).
   */
  async find(employeeId: string): Promise<DirectoryEmployee | null> {
    return getDirectoryEmployee(employeeId);
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
