// Public surface of the Employees feature (Stage 5). The HR manifest and tests import from
// here; internal files are not reached across the feature boundary.
export { buildEmployeesRouter } from './employee.routes';
export { employeeService } from './employee.service';
export { type EmployeeDoc } from './employee.model';
