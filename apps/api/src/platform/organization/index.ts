// Public surface of the organization service + composition wiring between the
// unit sub-features (delete guards walk down the fixed hierarchy, Review R12).
import { branchService } from './branches';
import { departmentService, departmentRepository } from './departments';
import { sectionRepository } from './sections';
import { departmentCatalogService } from './department-catalog';
import { sectionCatalogService } from './section-catalog';

branchService.setHooks({
  hasChildren: (branchId) => departmentRepository.existsUnderBranch(branchId),
});
departmentService.setHooks({
  hasChildren: (departmentId) => sectionRepository.existsUnderDepartment(departmentId),
});

// The catalogs reach DOWN to the units that declare them — a delete guard and a rename fan-out —
// exactly as the hierarchy's own guards do, and wired here for the same reason: neither feature may
// import the other without closing a cycle between them (P-ORG-2).
departmentCatalogService.setHooks({
  hasDependents: (catalogId) => departmentRepository.existsWithCatalog(catalogId),
  renameLinked: (catalogId, name, by) => departmentRepository.renameByCatalog(catalogId, name, by),
});
sectionCatalogService.setHooks({
  hasDependents: (catalogId) => sectionRepository.existsWithCatalog(catalogId),
  renameLinked: (catalogId, name, by) => sectionRepository.renameByCatalog(catalogId, name, by),
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
  DepartmentModel,
  type DepartmentDoc,
} from './departments';
export {
  sectionService,
  toSectionDto,
  buildSectionsRouter,
  sectionRepository,
  SectionModel,
  type SectionDoc,
} from './sections';
export {
  jobTitleService,
  jobTitleRepository,
  buildJobTitlesRouter,
  type JobTitleDoc,
} from './job-titles';
export {
  costCenterService,
  buildCostCentersRouter,
  costCenterRepository,
  type CostCenterDoc,
} from './cost-centers';
export {
  departmentCatalogService,
  toDepartmentCatalogDto,
  buildDepartmentCatalogRouter,
  departmentCatalogRepository,
  DepartmentCatalogModel,
  type DepartmentCatalogDoc,
} from './department-catalog';
export {
  sectionCatalogService,
  toSectionCatalogDto,
  buildSectionCatalogRouter,
  sectionCatalogRepository,
  SectionCatalogModel,
  type SectionCatalogDoc,
} from './section-catalog';
export { effectiveManagerId } from './shared/org-unit';
