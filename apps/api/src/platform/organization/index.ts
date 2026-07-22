// Public surface of the organization service + composition wiring between the
// unit sub-features (delete guards walk down the fixed hierarchy, Review R12).
import { branchService } from './branches';
import { departmentService, departmentRepository } from './departments';
import { sectionRepository } from './sections';

branchService.setHooks({
  hasChildren: (branchId) => departmentRepository.existsUnderBranch(branchId),
});
departmentService.setHooks({
  hasChildren: (departmentId) => sectionRepository.existsUnderDepartment(departmentId),
});

export { organizationService } from './organization.service';
export { buildOrganizationRouter } from './organization.routes';
export {
  branchService,
  toBranchDto,
  buildBranchesRouter,
  branchRepository,
  type BranchDoc,
} from './branches';
export {
  departmentService,
  toDepartmentDto,
  buildDepartmentsRouter,
  departmentRepository,
  type DepartmentDoc,
} from './departments';
export {
  sectionService,
  toSectionDto,
  buildSectionsRouter,
  sectionRepository,
  type SectionDoc,
} from './sections';
export { jobTitleService, buildJobTitlesRouter, type JobTitleDoc } from './job-titles';
export {
  jobPositionService,
  buildJobPositionsRouter,
  jobPositionRepository,
  type JobPositionDoc,
} from './job-positions';
export { effectiveManagerId } from './shared/org-unit';
