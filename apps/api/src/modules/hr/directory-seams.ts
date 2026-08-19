// HR side of the employee-directory seam (platform/directory): the platform cannot import HR,
// so the employee lookup and the leave lookup register here at module load — the same pattern
// as `identity-seams`. Consumers today: Fleet (driver = employee + fleet-owned profile, design
// §9.1; availability reads approved/active leave when `fleet.availability.useHrLeave` is on).
// OP-6 adds the SELF lookup — "which employee is this login?" — which the captain-mobile read
// surface uses so a captain's identity comes from the token, never from a client-supplied id.
import {
  registerAttendanceDayLookup,
  registerEmployeeBatchLookup,
  registerEmployeeLookup,
  registerEmployeesByDepartmentLookup,
  registerLeaveLookup,
  registerSelfEmployeeLookup,
} from '../../platform/directory';
import { employeeRepository } from './employee-management/employees/employee.repository';
import { LeaveRequestModel } from './leave-management/leave-requests/leave-request.model';
import { AttendanceDayModel } from './attendance/day-records/day-record.model';

export const registerHrDirectorySeams = (): void => {
  registerEmployeeLookup(async (employeeId) => {
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return null;
    return {
      employeeId: String(employee._id),
      code: employee.code,
      fullNameAr: employee.personal.fullNameAr,
      status: employee.status,
      branchId: String(employee.branchId),
      departmentId: String(employee.departmentId),
    };
  });

  // The first LIST on this seam: "who is in this part of the company". Operations' crew roster is
  // the org chart rather than a list it keeps, so it has to be able to ask.
  registerEmployeesByDepartmentLookup(async (departmentIds) => {
    const employees = await employeeRepository.listByDepartmentsSystem(departmentIds);
    return employees.map((employee) => ({
      employeeId: String(employee._id),
      code: employee.code,
      fullNameAr: employee.personal.fullNameAr,
      status: employee.status,
      branchId: String(employee.branchId),
      departmentId: String(employee.departmentId),
    }));
  });

  registerSelfEmployeeLookup(async (userId) => {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) return null;
    return {
      employeeId: String(employee._id),
      code: employee.code,
      fullNameAr: employee.personal.fullNameAr,
      status: employee.status,
      branchId: String(employee.branchId),
      departmentId: String(employee.departmentId),
    };
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
    return new Map(
      docs.map((employee) => [
        String(employee._id),
        {
          employeeId: String(employee._id),
          code: employee.code,
          fullNameAr: employee.personal.fullNameAr,
          status: employee.status,
          branchId: String(employee.branchId),
          departmentId: String(employee.departmentId),
        },
      ]),
    );
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
