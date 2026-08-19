// HR side of the employee-directory seam (platform/directory): the platform cannot import HR,
// so the employee lookup and the leave lookup register here at module load — the same pattern
// as `identity-seams`. Consumers today: Fleet (driver = employee + fleet-owned profile, design
// §9.1; availability reads approved/active leave when `fleet.availability.useHrLeave` is on).
import {
  registerEmployeeBatchLookup,
  registerEmployeeLookup,
  registerLeaveLookup,
} from '../../platform/directory';
import { employeeRepository } from './employee-management/employees/employee.repository';
import { LeaveRequestModel } from './leave-management/leave-requests/leave-request.model';

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
