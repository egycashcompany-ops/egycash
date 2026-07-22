// Per-unit configuration for the generic Branch/Department/Section admin screens. Each entry wires
// the shared CRUD/query factory to a resource path and declares its parent chain, permission prefix
// and whether it carries a postal address (branches only). The generic List/Detail/Form components
// read this config — the same "thin over one implementation" shape the backend uses for org units.
import { type BranchDto, type DepartmentDto, type SectionDto } from '@ecms/contracts';
import {
  makeUnitApi,
  makeUnitQueries,
  type AnyUnitDto,
  type UnitQueries,
} from './org-unit-resource';

export type ParentKind = 'branch' | 'department';

export interface UnitConfig<TDto extends AnyUnitDto> {
  /** REST resource segment under `/platform`. */
  resource: 'branches' | 'departments' | 'sections';
  /** Permission prefix + i18n key segment (singular). */
  entity: 'branch' | 'department' | 'section';
  /** Query-key feature segment. */
  feature: string;
  /** Parent selectors, outermost first — also drive the list filters. */
  parents: ParentKind[];
  hasAddress: boolean;
  /** Carries an optional bilingual description (Departments/Sections; not Branches). */
  hasDescription: boolean;
  routeBase: string;
  queries: UnitQueries<TDto>;
}

const branchApi = makeUnitApi<BranchDto>('branches');
const departmentApi = makeUnitApi<DepartmentDto>('departments');
const sectionApi = makeUnitApi<SectionDto>('sections');

export const branchConfig: UnitConfig<BranchDto> = {
  resource: 'branches',
  entity: 'branch',
  feature: 'branches',
  parents: [],
  hasAddress: true,
  hasDescription: false,
  routeBase: '/organization/branches',
  queries: makeUnitQueries<BranchDto>('branches', branchApi),
};

export const departmentConfig: UnitConfig<DepartmentDto> = {
  resource: 'departments',
  entity: 'department',
  feature: 'departments',
  parents: ['branch'],
  hasAddress: false,
  hasDescription: true,
  routeBase: '/organization/departments',
  queries: makeUnitQueries<DepartmentDto>('departments', departmentApi),
};

export const sectionConfig: UnitConfig<SectionDto> = {
  resource: 'sections',
  entity: 'section',
  feature: 'sections',
  parents: ['branch', 'department'],
  hasAddress: false,
  hasDescription: false,
  routeBase: '/organization/sections',
  queries: makeUnitQueries<SectionDto>('sections', sectionApi),
};
