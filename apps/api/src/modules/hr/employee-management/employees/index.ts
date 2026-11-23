// Public surface of the Employees feature — the employee registry (frozen design). The HR
// manifest, sibling employee-management features, and tests import from here; internal files
// are not reached across the feature boundary.
export { buildEmployeesRouter } from './employee.routes';
export { employeeService } from './employee.service';
export { toEmployeeDto, toRehireCheckResultDto } from './employee.mapper';
export { employeeRepository } from './employee.repository';
export { resolvePlacements, type PlacementLookup } from './employee-placement';
export {
  ensureEmployeePhotoCategory,
  hrEmployeePhotoFileAuthorizers,
} from './employee-photo.files';
export { buildEmployeeCode } from './employee-number';
export {
  applyImportedExit,
  applyImportedHistory,
  applyImportedUpdate,
  type ImportedPeriod,
} from './employee.import';
export {
  migrateEmployeeIndexes,
  migrateEmployeesToRegistry,
  migrateExternalEmployeeNumbers,
  personalFromApplicant,
} from './employee.migration';
export {
  type EmployeeDoc,
  type EmployeeEntity,
  type EmployeePersonalData,
  type EmploymentDetails,
} from './employee.model';
