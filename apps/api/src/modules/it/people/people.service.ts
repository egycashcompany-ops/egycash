// WHO IT MAY NAME — the company's employees, as IT's screens print them, under IT's own grants.
//
// «اعمل شاشه فيها كل المواظفيين اللى مشيوا واللى موجودين واللى ادوس عليه يجيب الهيستورى بتاعه كله
// ونفس الموضوع فى الفلاتر فى كل الشاشات لكن فى حاله اضافه اى حاجه لازم يكون المواظفيين يكونوا
// موجودين. الفنى يكون من مموظفيين الit بس».
//
// Custody references employees (§9.1) and any employee may hold an asset, so IT names people it
// does not own. It used to ask HR's own employee endpoint under `employee.view` — the whole HR file
// — so a technician who could hand out a laptop could not see who they were handing it to until
// somebody gave them «الموظفون». IT now asks the platform directory, which is the org chart
// answering a question, and publishes exactly what its screens print.
//
// Two populations:
//   • PEOPLE — everyone HR has, leavers included, inside the reader's scope over the custody
//     registers (a person ANY of `itAsset.view`, `itMobileLine.view` and `itConsumable.view` they
//     hold reaches, each in its own scope): the holder searches, the employees register, a person's history. `employed` narrows
//     the box a hand-over picks from. What each holds of the ASSETS is counted only within
//     `itAsset.view`, and not at all without it.
//   • TECHNICIANS — the IT departments' people (`it.technicianDepartmentIds`), whoever is asking:
//     a branch dispatcher hands work to head-office IT like anybody else.
//
// IT stores and writes none of it (§9.1). Every fact is HR's and is read fresh.
import {
  ItSettingKeys,
  type ItPersonDto,
  type ItTechniciansPageDto,
  type ListItPeopleQuery,
  type ListItTechniciansQuery,
  type Paginated,
} from '@ecms/contracts';
import { getSelfDirectoryEmployee, searchDirectoryEmployees } from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { itAssetAssignmentRepository } from '../assets/assignment.repository';
import { toItPersonDto, toItTechnicianDto } from '../it.mappers';

const ORG = { userId: null, branchId: null };

/**
 * The assets each person holds now, within `assetScope` — or none counted at all when it is null
 * (a reader without `itAsset.view`): the register is not asked, and every person carries 0, the
 * DTO's own «open custody intervals the reader may see».
 */
const openAssetCounts = async (
  employeeIds: readonly string[],
  assetScope: ScopeSelector | null,
): Promise<Map<string, number>> =>
  assetScope === null
    ? new Map()
    : itAssetAssignmentRepository.countOpenByEmployees(employeeIds, assetScope);

class ItPeopleService {
  /**
   * The register and every holder search: one page of people, each with what they hold now.
   * A person is found when ANY of `scopes` reaches them — one selector per register read grant the
   * caller holds, OR-ed by the directory (`anyOfScopes`); `assetScope` counts their assets (null:
   * nothing counted).
   */
  async list(
    query: ListItPeopleQuery,
    scopes: readonly ScopeSelector[],
    assetScope: ScopeSelector | null,
  ): Promise<Paginated<ItPersonDto>> {
    const page = await searchDirectoryEmployees({
      search: query.search,
      status: query.status,
      branchId: query.branchId,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      anyOfScopes: scopes,
      page: query.page,
      pageSize: query.pageSize,
    });
    const held = await openAssetCounts(
      page.items.map((person) => person.employeeId),
      assetScope,
    );
    return {
      items: page.items.map((person) => toItPersonDto(person, held.get(person.employeeId) ?? 0)),
      meta: page.meta,
    };
  }

  /**
   * One person — the head of their history page. Found through the same scoped read as the list,
   * so a person the reader could not find by searching is a 404 here too, whoever typed the URL.
   */
  async get(
    employeeId: string,
    scopes: readonly ScopeSelector[],
    assetScope: ScopeSelector | null,
  ): Promise<ItPersonDto> {
    const page = await searchDirectoryEmployees({
      employeeIds: [employeeId],
      status: 'all',
      anyOfScopes: scopes,
      page: 1,
      pageSize: 1,
    });
    const person = page.items[0];
    if (person === undefined) throw new NotFoundError('employee not found');
    const held = await openAssetCounts([employeeId], assetScope);
    return toItPersonDto(person, held.get(employeeId) ?? 0);
  }

  private async technicianDepartmentIds(): Promise<string[]> {
    return settingsService.resolve<string[]>(ItSettingKeys.TechnicianDepartmentIds, ORG);
  }

  /**
   * The IT departments' people, searched. `configured: false` when no department has been chosen —
   * which the screen says, because «nobody is configured» is fixed in the help-desk settings and
   * «nobody matches» is not.
   */
  async technicians(query: ListItTechniciansQuery): Promise<ItTechniciansPageDto> {
    const departmentIds = await this.technicianDepartmentIds();
    if (departmentIds.length === 0) return { configured: false, items: [] };
    const page = await searchDirectoryEmployees({
      departmentIds,
      search: query.search,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { configured: true, items: page.items.map(toItTechnicianDto) };
  }

  /**
   * The ticket-assign guard: work goes to somebody who works in IT TODAY — «الفنى يكون من موظفين
   * الـ IT بس», and «فى حاله اضافه اى حاجه لازم يكون المواظفيين يكونوا موجودين».
   *
   * The login is resolved to its employee through the directory; somebody with no employee behind
   * their login, outside the IT departments, or gone, is refused. Until a department has been
   * chosen there is no «IT» to check against, and assignment behaves exactly as it did before —
   * the picker is the one that says so, and it offers nobody.
   */
  async assertAssignableTechnician(userId: string): Promise<void> {
    const departmentIds = await this.technicianDepartmentIds();
    if (departmentIds.length === 0) return;
    const employee = await getSelfDirectoryEmployee(userId);
    const inIt =
      employee !== null &&
      employee.status !== 'exited' &&
      employee.departmentId !== null &&
      departmentIds.includes(employee.departmentId);
    if (!inIt) {
      throw new BusinessRuleError(
        'A ticket can be assigned only to a current employee of the departments in “Help desk technicians’ departments” (System settings → IT).',
      );
    }
  }
}

export const itPeopleService = new ItPeopleService();
