// The three ECMS integration seams, in one file.
//
// The gold system kept its own branches, its own vault-custodian list, and typed the crew leader
// and the vehicle number as free text on every receipt. Inside ECMS all four of those facts
// already exist, so the port resolves them from the platform instead of carrying a second copy:
//
//   · branches          → platform/organization (the caller's placement decides the scope)
//   · vault custodians  → platform/directory (HR employees)
//   · crew leader       → platform/directory (HR employees)
//   · vehicle           → Fleet, through `../fleet-boundary` (read-only)
//
// Every resolution returns an id AND a display SNAPSHOT. The snapshot is not a cache: a receipt is
// a printed document, and the name on the copy in the file must not change because somebody was
// renamed or a car was sold three years later. The id is the link; the snapshot is the record.
import { branchRepository } from '../../../platform/organization';
import { getDirectoryEmployee } from '../../../platform/directory';
import { BusinessRuleError, ValidationError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { fleetVehicleRepository } from '../fleet-boundary';

/** Employment states that may still be named on a NEW document (`exited` may not). */
const EMPLOYABLE = new Set(['probation', 'active', 'onLeave', 'suspended']);

export interface PersonRef {
  id: string | null;
  name: string | null;
}

export interface VehicleRef {
  id: string | null;
  /** The plate — the value the gold receipt has always printed as "رقم السيارة". */
  number: string | null;
}

const detail = (field: string, message: string): never => {
  throw new ValidationError([{ field, code: 'INVALID_REFERENCE', message }]);
};

/**
 * Resolve one ECMS employee into the (id, name) pair a gold document stores.
 *
 * `null`/`undefined` clears the field — a draft is saved from whatever the operator has so far,
 * and that stays true. A non-null id that HR cannot answer for is refused rather than stored: the
 * whole point of integration 2 is that the custodian on the receipt is a real person in ECMS.
 */
export const resolveEmployeeRef = async (
  employeeId: string | null | undefined,
  field: string,
): Promise<PersonRef> => {
  if (employeeId === null || employeeId === undefined) return { id: null, name: null };
  const employee = await getDirectoryEmployee(employeeId);
  if (employee === null) return detail(field, 'employee not found');
  if (!EMPLOYABLE.has(employee.status)) return detail(field, 'employee has left the company');
  return { id: employee.employeeId, name: employee.fullNameAr };
};

/** The same, for the Fleet vehicle that carried the shipment (integration 1). */
export const resolveVehicleRef = async (
  vehicleId: string | null | undefined,
  field = 'vehicleId',
): Promise<VehicleRef> => {
  if (vehicleId === null || vehicleId === undefined) return { id: null, number: null };
  const vehicle = await fleetVehicleRepository.findById(vehicleId);
  if (vehicle === null) return detail(field, 'vehicle not found');
  return { id: String(vehicle._id), number: vehicle.plateNumber };
};

/**
 * Which ECMS branch a newly created gold document belongs to (integration 3).
 *
 * This is the gold rule (`utils/branchScope.js#resolveCreateBranch`) reading ECMS branches instead
 * of its own collection, and it is kept because it is a business rule, not plumbing: an
 * installation with a single branch never asks, and an installation with several refuses to guess.
 *
 * Gold split the refusal in two, and so does this. An ordinary operator whose account was never
 * placed in a branch is an administration problem. An account that sees the whole company is a
 * deliberate shape — it is meant to see everything, which is exactly why it cannot GUESS where a
 * new document belongs; it has to say. Gold answered that with the branch switcher in its top bar,
 * and so does ECMS: picking a branch there narrows the caller, and the narrowed branch is what the
 * document is filed into.
 */
export const resolveCreateBranchId = async (ctx: AuthContext): Promise<string | null> => {
  if (ctx.branchId !== null) return ctx.branchId;
  // The command bar's choice. Only an organization-wide caller ever has one, because narrowing
  // does nothing to anybody already placed in a branch.
  const active = ctx.activeBranchId ?? null;
  if (active !== null) return active;
  const page = await branchRepository.list({ page: 1, pageSize: 2 });
  if (page.meta.totalItems === 0) return null; // single-branch / legacy mode
  const only = page.items[0];
  if (page.meta.totalItems === 1 && only !== undefined) return String(only._id);
  throw new BusinessRuleError(
    ctx.isPrivileged
      ? 'اختر فرعًا محددًا من القائمة العلوية قبل الإضافة.'
      : 'حسابك غير مرتبط بفرع. تواصل مع مدير النظام.',
  );
};

/**
 * Branch display names, as one map.
 *
 * Every gold list renders the branch a row belongs to, so this is asked for once per page rather
 * than once per row. Branches are a handful of records in any real installation, so reading the
 * whole set costs one query and no id bookkeeping.
 */
export const branchNames = async (): Promise<Map<string, string>> => {
  const page = await branchRepository.list({ page: 1, pageSize: 100 });
  // `name.ar` and not `name.ar!`: this map is built on EVERY gold list, so one branch row missing
  // its localized name would be a 500 on all of them. A branch with no Arabic name renders as the
  // empty string, which is what the cell would have shown anyway.
  return new Map(page.items.map((branch) => [String(branch._id), branch.name?.ar ?? '']));
};
