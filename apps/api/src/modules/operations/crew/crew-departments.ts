// Which org units the operations crew is drawn from — the saved setting, read as COMPANY departments.
//
// `operations.crewDepartmentIds` holds department (org-unit) ids, and a department is one unit per
// branch. Read literally, ticking «نقل الأموال» in one branch left the other six branches' «نقل
// الأموال» out, and a branch that opened later was out until somebody found the card again. The
// owner: «القائمة دي كانت معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب
// الفروع. فإحنا عايزين نعدل الموضوع ده».
//
// So a saved id now stands for the company department it is a branch copy of: every ACTIVE unit of
// the same catalog entry (or, never linked, of the same folded name — `orgUnitGroupKeys`) is crew,
// today's branches and any branch that adds the department tomorrow. The stored value did not
// change shape, which is why nothing had to be migrated: every id saved before still selects at
// least what it selected then, and widens only to the same department elsewhere.
//
// Two reads of the options, because the option DTO carries no status: the inactive units are the
// POPULATION (a saved id of a unit deactivated since still says which department was meant), the
// active ones are what the department widens to.
import { expandOrgUnitSelection } from '@ecms/contracts';
import { departmentService } from '../../../platform/organization';

/** The saved ids, widened to their departments in every active branch; `[]` for none saved. */
export const resolveCrewDepartmentIds = async (configured: readonly string[]): Promise<string[]> => {
  if (configured.length === 0) return [];
  const [active, population] = await Promise.all([
    departmentService.options(),
    departmentService.options({ includeInactive: true }),
  ]);
  return expandOrgUnitSelection(configured, population, active);
};
