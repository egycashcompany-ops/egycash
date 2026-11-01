// The leader list — `GET /atm/leaders/options` for the pickers, and the /atm/settings card that
// says which departments it is drawn from (`GET/PUT /atm/leaders/departments`).
//
// Drawn from the departments ticked on the card (`atm.maintenanceLeaderDepartmentIds`) or, while
// none is, from every active department whose name is the ATM department's (leader-list.ts). The
// same list feeds the maintenance close — whose employee is required — and both kinds' edit
// dialogs. The card is `atmSettings.manage` at organization scope (shared/settings-authority.ts):
// who staffs ATM is one fact about the company. Its save goes THROUGH the platform settings
// service, so it is audited (`platform.setting`) like every other ATM setting.
import {
  AtmSettingKeys,
  type AtmLeaderDepartmentDto,
  type AtmLeaderDepartmentsDto,
  type AtmLeaderDepartmentsSource,
  type AtmLeaderOptionDto,
  type OrgUnitOptionDto,
  type SaveAtmLeaderDepartments,
} from '@ecms/contracts';
import { listDirectoryEmployeesByDepartment } from '../../../platform/directory';
import { branchService, departmentService } from '../../../platform/organization';
import { settingsService } from '../../../platform/settings';
import { ValidationError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { asSettingsEditor, assertAtmSettingsManager } from '../shared/settings-authority';
import { isAtmDepartmentName, toLeaderOptions } from './leader-list';

const ORG_SUBJECT = { userId: null, branchId: null };

interface LeaderSource {
  configuredIds: string[];
  /** Every active department, org-wide. */
  departments: OrgUnitOptionDto[];
  /** The departments the list is drawn from now. */
  effectiveIds: string[];
  source: AtmLeaderDepartmentsSource;
}

class AtmLeadersService {
  /** The ticked departments, or — none ticked — the ATM department(s) found by name. */
  private async source(): Promise<LeaderSource> {
    const configuredIds = await settingsService.resolve<string[]>(
      AtmSettingKeys.MaintenanceLeaderDepartmentIds,
      ORG_SUBJECT,
    );
    const departments = await departmentService.options();
    if (configuredIds.length > 0) {
      return { configuredIds, departments, effectiveIds: configuredIds, source: 'configured' };
    }
    const byName = departments.filter((unit) => isAtmDepartmentName(unit.name)).map((u) => u.id);
    return {
      configuredIds,
      departments,
      effectiveIds: byName,
      source: byName.length > 0 ? 'byName' : 'none',
    };
  }

  /** The pickers' names — `[]` when no department is ticked and none is named for ATM. */
  async options(): Promise<AtmLeaderOptionDto[]> {
    const { effectiveIds } = await this.source();
    return toLeaderOptions(await listDirectoryEmployeesByDepartment(effectiveIds));
  }

  /** The card: every active department (and any stored id gone since), with what is in the list. */
  async departments(ctx: AuthContext): Promise<AtmLeaderDepartmentsDto> {
    assertAtmSettingsManager(ctx);
    const { configuredIds, departments, effectiveIds, source } = await this.source();
    const active = new Map(departments.map((unit) => [unit.id, unit]));
    const listedIds = [...active.keys(), ...configuredIds.filter((id) => !active.has(id))];
    const effective = new Set(effectiveIds);

    // One read of everybody the card can tick, counted per department.
    const working = toLeaderOptionsByDepartment(
      await listDirectoryEmployeesByDepartment(listedIds),
    );
    const branchNames = new Map(
      (await branchService.options()).map((branch) => [branch.id, branch.name]),
    );

    const rows: AtmLeaderDepartmentDto[] = listedIds.map((id) => {
      const unit = active.get(id);
      return {
        id,
        name: unit?.name ?? null,
        branchName:
          unit === undefined || unit.parentId === null
            ? null
            : (branchNames.get(unit.parentId) ?? null),
        selected: effective.has(id),
        matchesName: unit !== undefined && isAtmDepartmentName(unit.name),
        employees: working.get(id)?.size ?? 0,
      };
    });
    rows.sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        Number(b.matchesName) - Number(a.matchesName) ||
        (a.name?.ar ?? '').localeCompare(b.name?.ar ?? '', 'ar') ||
        (a.branchName?.ar ?? '').localeCompare(b.branchName?.ar ?? '', 'ar'),
    );

    const offered = new Set<string>();
    for (const id of effectiveIds)
      for (const employeeId of working.get(id) ?? []) offered.add(employeeId);
    return { configuredIds, source, departments: rows, employees: offered.size };
  }

  /**
   * The ticked departments, replacing the stored list; `[]` returns to the name rule. 400 at the
   * index naming a department that is not active — one already stored may stay, so a card showing
   * a department retired since can still be saved without unticking it first.
   */
  async saveDepartments(
    input: SaveAtmLeaderDepartments,
    ctx: AuthContext,
  ): Promise<AtmLeaderDepartmentsDto> {
    assertAtmSettingsManager(ctx);
    const ids = [...new Set(input.departmentIds.map((id) => id.toLowerCase()))];
    const { configuredIds, departments } = await this.source();
    const allowed = new Set([...departments.map((unit) => unit.id), ...configuredIds]);
    const issues = ids.flatMap((id, index) =>
      allowed.has(id)
        ? []
        : [
            {
              field: `body.departmentIds.${String(index)}`,
              code: 'DEPARTMENT_NOT_ACTIVE',
              message: 'the department does not exist or is not active',
            },
          ],
    );
    if (issues.length > 0) throw new ValidationError(issues);

    await settingsService.set(asSettingsEditor(ctx), {
      key: AtmSettingKeys.MaintenanceLeaderDepartmentIds,
      scope: 'organization',
      value: ids,
    });
    return this.departments(ctx);
  }
}

/** departmentId → the working employees in it (each once). */
const toLeaderOptionsByDepartment = (
  employees: Awaited<ReturnType<typeof listDirectoryEmployeesByDepartment>>,
): Map<string, Set<string>> => {
  const byDepartment = new Map<string, Set<string>>();
  for (const employee of employees) {
    if (employee.status === 'exited' || employee.departmentId === null) continue;
    const set = byDepartment.get(employee.departmentId) ?? new Set<string>();
    set.add(employee.employeeId);
    byDepartment.set(employee.departmentId, set);
  }
  return byDepartment;
};

export const atmLeadersService = new AtmLeadersService();
