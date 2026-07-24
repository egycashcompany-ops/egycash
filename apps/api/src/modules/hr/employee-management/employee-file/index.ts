// Public surface of the Electronic Employee File feature (Stage 7). The HR manifest, the seed,
// and tests import from here; internal files are not reached across the feature boundary.
export { buildEmployeeFilesRouter } from './employee-file.routes';
export { employeeFileService } from './employee-file.service';
export { type EmployeeFileDoc } from './employee-file.model';
