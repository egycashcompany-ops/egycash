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
// Three populations:
//   • PEOPLE — everyone HR has, leavers included, inside the reader's scope over the custody
//     registers (a person ANY of `itAsset.view`, `itMobileLine.view` and `itConsumable.view` they
//     hold reaches, each in its own scope): the filter boxes, the employees register, a person's
//     history. What each holds of the ASSETS is counted only within `itAsset.view`, and not at
//     all without it. A person's page is also open to a reader whose registers NAME the person —
//     somebody the reader's branch handed something to in another branch («المُسلِّم يرى ما
//     سلّمه», 2026-11-18).
//   • RECIPIENTS — whom a hand-over may name: anybody who works here today, in ANY branch, for
//     whoever holds a hand-over grant (owner, 2026-11-18: «لما حد فى فرع بيسلم جهاز لحد فى فرع
//     تاني مش بيعرف يشوف اسمه … أسمح إنه يعرف يسلم لحد فى فرع تاني»). Searched, a few at a time,
//     with a name, a code and a branch only.
//   • TECHNICIANS — the IT departments' people (`it.technicianDepartmentIds`), whoever is asking:
//     a branch dispatcher hands work to head-office IT like anybody else.
//
// IT stores and writes none of it (§9.1). Every fact is HR's and is read fresh.
import { Types } from 'mongoose';
import {
  ItSettingKeys,
  type ItPersonDto,
  type ItRecipientDto,
  type ItTechniciansPageDto,
  type ListItPeopleQuery,
  type ListItRecipientsQuery,
  type ListItTechniciansQuery,
  type Paginated,
} from '@ecms/contracts';
import {
  getSelfDirectoryEmployee,
  searchDirectoryEmployees,
  type DirectoryEmployeeListing,
} from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { itAssetAssignmentRepository } from '../assets/assignment.repository';
import { itConsumableMovementRepository } from '../consumables/consumable-movement.repository';
import { itMobileLineAssignmentRepository } from '../mobile-lines/line-assignment.repository';
import { toItPersonDto, toItTechnicianDto } from '../it.mappers';

const ORG = { userId: null, branchId: null };

/**
 * Each register's own read scope, as that register's list applies it — null for a grant the
 * reader does not hold. `assets` also bounds what a person's open custody counts.
 */
export interface ItRegisterScopes {
  assets: ScopeSelector | null;
  lines: ScopeSelector | null;
  consumables: ScopeSelector | null;
}

/** What a hand-over's box prints about a person — these four facts, and nothing else of HR's. */
const toItRecipientDto = (person: DirectoryEmployeeListing): ItRecipientDto => ({
  employeeId: person.employeeId,
  code: person.code,
  fullNameAr: person.fullNameAr,
  branchId: person.branchId,
});

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
   * so a person the reader could not find by searching is a 404 here too, whoever typed the URL —
   * unless the reader's own registers NAME the person (`namedByRegisters`): somebody in another
   * branch the reader's branch handed a device, a line or consumables to. «المُسلِّم يرى ما سلّمه»
   * (2026-11-18): the sender opens the page, read from the directory unscoped, and every section
   * of it is still the sender's own registers — the open custody counted within `registers.assets`.
   */
  async get(
    employeeId: string,
    scopes: readonly ScopeSelector[],
    registers: ItRegisterScopes,
  ): Promise<ItPersonDto> {
    const page = await searchDirectoryEmployees({
      employeeIds: [employeeId],
      status: 'all',
      anyOfScopes: scopes,
      page: 1,
      pageSize: 1,
    });
    const person = page.items[0] ?? (await this.namedPerson(employeeId, registers));
    if (person === undefined) throw new NotFoundError('employee not found');
    const held = await openAssetCounts([employeeId], registers.assets);
    return toItPersonDto(person, held.get(employeeId) ?? 0);
  }

  /**
   * The person the scoped read missed, when the reader's registers name them — read from the
   * directory UNSCOPED, since the reach was just proved by what the reader's own registers hold —
   * or undefined (the 404). Nothing is asked of HR for a person no register names.
   */
  private async namedPerson(
    employeeId: string,
    registers: ItRegisterScopes,
  ): Promise<DirectoryEmployeeListing | undefined> {
    if (!(await this.namedByRegisters(employeeId, registers))) return undefined;
    const page = await searchDirectoryEmployees({
      employeeIds: [employeeId],
      status: 'all',
      page: 1,
      pageSize: 1,
    });
    return page.items[0];
  }

  /**
   * Whether ANY register the reader holds names the person, each read exactly as that register's
   * own list is scoped — its own grant's selector over the row's own `branchId` (the interval's,
   * the movement's store): an asset custody interval, open or closed (`/it/assignments`); a line
   * custody interval (`/it/mobile-line-assignments`); a consumables movement naming them, which
   * only an issue or a return does (`/it/consumable-movements`). Only the registers the reader
   * holds a grant of are asked, one count each, and the first that names the person ends it.
   */
  private async namedByRegisters(
    employeeId: string,
    registers: ItRegisterScopes,
  ): Promise<boolean> {
    const person = new Types.ObjectId(employeeId);
    const asks: (() => Promise<number>)[] = [];
    const { assets, lines, consumables } = registers;
    if (assets !== null) {
      asks.push(() => itAssetAssignmentRepository.count({ assignedToEmployeeId: person }, assets));
    }
    if (lines !== null) {
      asks.push(() =>
        itMobileLineAssignmentRepository.count({ assignedToEmployeeId: person }, lines),
      );
    }
    if (consumables !== null) {
      asks.push(() => itConsumableMovementRepository.count({ employeeId: person }, consumables));
    }
    for (const ask of asks) if ((await ask()) > 0) return true;
    return false;
  }

  /**
   * «أسمح إنه يعرف يسلم لحد فى فرع تاني» (owner, 2026-11-18) — whom a hand-over's box may name: the
   * people who work here today (FR-15/16 — a hand-over names somebody employed), in EVERY branch,
   * for the code or the name typed, by name. Unscoped on purpose, like the technicians: the route's
   * hand-over grant, the required search and the small page bound the population, so neither a
   * grant's reach nor the command bar's branch is applied. Each row is `toItRecipientDto`'s four
   * facts — none of the register's dates, login or custody counts.
   */
  async recipients(query: ListItRecipientsQuery): Promise<ItRecipientDto[]> {
    const page = await searchDirectoryEmployees({
      search: query.search,
      status: 'employed',
      sortBy: 'name',
      sortDir: 'asc',
      page: 1,
      pageSize: query.pageSize,
    });
    return page.items.map(toItRecipientDto);
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
