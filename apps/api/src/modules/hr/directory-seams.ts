// HR side of the employee-directory seam (platform/directory): the platform cannot import HR,
// so the employee lookup and the leave lookup register here at module load — the same pattern
// as `identity-seams`. Consumers today: Fleet (driver = employee + fleet-owned profile, design
// §9.1; availability reads approved/active leave when `fleet.availability.useHrLeave` is on).
// OP-6 adds the SELF lookup — "which employee is this login?" — which the captain-mobile read
// surface uses so a captain's identity comes from the token, never from a client-supplied id.
import {
  type DirectoryEmployee,
  registerAttendanceDayLookup,
  registerDirectoryNameSource,
  registerEmployeeBatchLookup,
  registerEmployeeByCodeLookup,
  registerEmployeeLookup,
  registerEmployeesByDepartmentLookup,
  registerEmployeesByJobTitlesLookup,
  registerEmployeesByNamesLookup,
  registerLeaveLookup,
  registerSelfEmployeeLookup,
} from '../../platform/directory';
import { employeeRepository } from './employee-management/employees/employee.repository';
import { EmployeeModel } from './employee-management/employees/employee.model';
import { matchEmployeesByName } from './employee-management/employees/employee-name-match';
import { LeaveRequestModel } from './leave-management/leave-requests/leave-request.model';
import { AttendanceDayModel } from './attendance/day-records/day-record.model';

/**
 * ONE employee, as the platform sees them — the shape every registration below hands back.
 *
 * It used to be written out five times, which is five places for the seam's shape to drift and
 * five to edit when it grows. It grew (phone, governorate, hire date — the columns Fleet's
 * drivers registry sorts by), so it is one function now.
 *
 * The ADDRESS follows the same precedence the screens use: the official address first, the
 * current one behind it. Both may be absent, and then the governorate is `null` rather than a
 * guess — a driver with no address on file is not from Cairo.
 */
const toDirectoryEmployee = (employee: {
  _id: unknown;
  code: string;
  status: 'probation' | 'active' | 'onLeave' | 'suspended' | 'exited';
  branchId: unknown;
  departmentId: unknown;
  hiredAt?: Date | null;
  personal: {
    fullNameAr: string;
    contact?: { primaryPhone?: string | null } | null;
    officialAddress?: {
      governorate?: string | null;
      line1?: string | null;
      city?: string | null;
    } | null;
    currentAddress?: {
      governorate?: string | null;
      line1?: string | null;
      city?: string | null;
    } | null;
  };
}): DirectoryEmployee => {
  const address = employee.personal.officialAddress ?? employee.personal.currentAddress ?? null;
  return {
    employeeId: String(employee._id),
    code: employee.code,
    fullNameAr: employee.personal.fullNameAr,
    status: employee.status,
    branchId: String(employee.branchId),
    departmentId: String(employee.departmentId),
    phone: employee.personal.contact?.primaryPhone ?? null,
    governorate: address?.governorate ?? null,
    hiredAt: employee.hiredAt ?? null,
    // The same two parts the drivers registry has always printed, joined the same way. Joined
    // HERE rather than on the screen so the one seam answers with the one string — the registry
    // and the sheet exported from it were already sharing a helper to avoid exactly that drift.
    address:
      address == null
        ? null
        : [address.line1, address.city].filter((part) => part != null && part !== '').join('، ') ||
          null,
  };
};

export const registerHrDirectorySeams = (): void => {
  registerEmployeeLookup(async (employeeId) => {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return null;
    return toDirectoryEmployee(employee);
  });

  // The first LIST on this seam: "who is in this part of the company". Operations' crew roster is
  // the org chart rather than a list it keeps, so it has to be able to ask.
  registerEmployeesByDepartmentLookup(async (departmentIds) => {
    const employees = await employeeRepository.listByDepartmentsSystem(departmentIds);
    return employees.map(toDirectoryEmployee);
  });

  // The same LIST question along the other axis: "who holds these seats". Fleet's drivers registry
  // is every employee whose job title requires a driving test, so the roster is the org chart
  // rather than a list Fleet keeps and has to remember to update.
  registerEmployeesByJobTitlesLookup(async (jobTitleIds, options) => {
    // `includeExited`: the same seats, with the people who have since left — a screen that
    // records history (a fine from last year) still has to be able to name them.
    const employees =
      options?.includeExited === true
        ? await employeeRepository.listByJobTitlesAnyStatusSystem(jobTitleIds)
        : await employeeRepository.listByJobTitlesSystem(jobTitleIds);
    return employees.map(toDirectoryEmployee);
  });

  // By code — «which employee is 0100026?» — for a consumer holding a file named for a person.
  registerEmployeeByCodeLookup(async (code) => {
    const employee = await employeeRepository.findByCodeSystem(code);
    if (employee === null) return null;
    return toDirectoryEmployee(employee);
  });

  // By NAME — «which employee is «مصطفى عثمان محمود عثمان»?» — for the go-live step bringing the
  // old fleet book across, where a driver is a spelling and nothing else. HR's rule
  // (`employee-name-match.ts`) answers with candidates; the consumer takes one, reports none or
  // several. Any status: a driver who has left still drove last year.
  registerEmployeesByNamesLookup(async (names) => {
    const employees = await employeeRepository.listAllForNameMatchSystem();
    const matched = matchEmployeesByName(
      names,
      employees.map((employee) => ({ name: employee.personal.fullNameAr, employee })),
    );
    return new Map(
      [...matched].map(([name, candidates]) => [
        name,
        candidates.map((candidate) => toDirectoryEmployee(candidate.employee)),
      ]),
    );
  });

  registerSelfEmployeeLookup(async (userId) => {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) return null;
    return toDirectoryEmployee(employee);
  });

  // B5 adds the ATTENDANCE-DAY lookup. Read-only and batch: the Operations crew board shows a
  // day's attendance beside the roster, and attendance is NOT an eligibility gate there (legacy
  // never queried absence for the cash-transfer department at all — discovery §10.2), so this
  // seam deliberately answers a question and grants nothing.
  registerAttendanceDayLookup(async (employeeIds, date) => {
    const rows = await AttendanceDayModel.find({
      employeeId: { $in: employeeIds },
      workDate: date,
      isDeleted: false,
    })
      .lean()
      .exec();
    return new Map(
      rows.map((row) => [
        String(row.employeeId),
        {
          employeeId: String(row.employeeId),
          status: row.status,
          onLeave: row.status === 'onLeave',
        },
      ]),
    );
  });

  // IT-6 — the same fact, in bulk, for list screens. One `$in` per page rather than one query
  // per row; the shape is the single lookup's, so a consumer reads one type either way.
  registerEmployeeBatchLookup(async (employeeIds) => {
    const docs = await employeeRepository.findByIdsSystem([...new Set(employeeIds)]);
    return new Map(docs.map((employee) => [String(employee._id), toDirectoryEmployee(employee)]));
  });

  // WHERE the names live, for a consumer that has to ORDER by one. HR declares the join; Fleet
  // performs it through the platform, never spelling this collection itself — see
  // `DirectoryNameSource`. The Arabic name, because that is the one every screen prints.
  registerDirectoryNameSource({
    collection: EmployeeModel.collection.name,
    nameField: 'personal.fullNameAr',
  });

  registerLeaveLookup(async (employeeId, date) => {
    // approved/active only — a pending request is not yet a fact a roster may plan around.
    const covering = await LeaveRequestModel.exists({
      employeeId,
      status: { $in: ['approved', 'active'] },
      startDate: { $lte: date },
      endDate: { $gte: date },
    });
    return covering !== null;
  });
};
