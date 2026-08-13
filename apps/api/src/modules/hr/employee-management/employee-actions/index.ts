// Public surface of the Personnel Actions feature (frozen design §3). The HR manifest and
// sibling features import from here; internal files are not reached across the boundary.
export { buildEmployeeActionsRouter } from './employee-action.routes';
export { employeeActionService } from './employee-action.service';
export { employeeActionRepository } from './employee-action.repository';
export { toEmployeeActionDto } from './employee-action.mapper';
export { type EmployeeActionDoc } from './employee-action.model';
// HR3-C — the attachment category's boot seed and HR's ADR-023 answer for the files it holds.
export { ensureEmployeeActionAttachmentsCategory } from './employee-action.files';
export { hrFileEntityAuthorizers } from './employee-action-file-access';
