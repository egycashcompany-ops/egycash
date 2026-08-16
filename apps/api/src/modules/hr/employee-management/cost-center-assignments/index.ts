// Public surface of employee cost-centre membership (ADR-003 barrel).
export { costCenterAssignmentService } from './cost-center-assignment.service';
export { costCenterAssignmentRepository } from './cost-center-assignment.repository';
export { buildEmployeeCostCentersRouter } from './cost-center-assignment.routes';
export { costCentreOn, type DatedMembership } from './cost-center-resolution';
export {
  CostCenterAssignmentModel,
  type CostCenterAssignmentDoc,
} from './cost-center-assignment.model';
