// Reference lookups shared across the org-structure screens: active Branches/Departments used to
// populate parent pickers and list filters, plus user search/lookup for the manager field. Each is
// gated by its own `*.view` permission on the server; on denial the query degrades to empty rather
// than erroring the whole screen.
import { useQuery } from '@tanstack/react-query';
import { type OrgUnitOptionDto, type Paginated, type UserDto } from '@ecms/contracts';
import { buildQuery, get, getPage } from '../../../shared/lib/api-client';
import { ORG_MODULE } from './org-unit-resource';

// Branch options come from the reference-options endpoint, which any authenticated user may read —
// so the Branch dropdown on the Department/Section forms is populated even without `branch.view`.
const listBranchOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/branches/options');

// Department options, like the branch ones above: any authenticated user, decoupled from
// `department.view`. A module that only needs to NAME a department — Operations picking the one
// its crew works in — has no business demanding the permission to browse HR's org structure.
const listDepartmentOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/departments/options');

// Sections and Job Titles, on the same terms as the two above. Each option carries `parentId`
// (a Section's Department; null for a Job Title, which is a flat catalog), so a screen that
// cascades one picker off another filters these lists in the browser instead of issuing a
// permission-gated request per selection.
const listSectionOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/sections/options');

const listJobTitleOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/job-titles/options');

const searchUsers = (term: string): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);

const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

export const useBranchOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'branches', 'options'],
    queryFn: listBranchOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

/** Every active department, org-wide, as {id, code, name} — for pickers, not for browsing. */
export const useDepartmentReferenceOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'departments', 'reference-options'],
    queryFn: listDepartmentOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * Departments of a branch (or all active departments when no branch is given).
 *
 * Fed by the OPTIONS endpoint, not the paginated list, for two reasons. The list caps a page at
 * `MAX_PAGE_SIZE` — 100 — and these hooks asked for exactly one page, so on a company with more
 * org units than that the rest were dropped SILENTLY: a picker that is simply missing entries, and
 * a name lookup that falls through to printing a raw ObjectId. `/options` pages to exhaustion
 * server-side for precisely this reason. And it is the endpoint whose contract promises `parentId`
 * so a caller can cascade from ONE fetch instead of a `department.view`-gated request per branch.
 *
 * The query key is the reference-options key, deliberately: every caller — whatever branch it asks
 * for — shares a single fetch and narrows it in `select`, which runs per observer.
 */
export const useDepartmentOptions = (branchId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'departments', 'reference-options'],
    queryFn: listDepartmentOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (all) =>
      branchId === undefined ? all : all.filter((unit) => unit.parentId === branchId),
  });

/** Sections of a department (or all active sections when none is given). See above for why. */
export const useSectionOptions = (departmentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'sections', 'reference-options'],
    queryFn: listSectionOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (all) =>
      departmentId === undefined ? all : all.filter((unit) => unit.parentId === departmentId),
  });

/** Every active section, org-wide, as {id, code, name, parentId} — `parentId` is its department. */
export const useSectionReferenceOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'sections', 'reference-options'],
    queryFn: listSectionOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

/** Every active job title, org-wide. `parentId` is always null — the catalog is flat (ADR-015). */
export const useJobTitleReferenceOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'job-titles', 'reference-options'],
    queryFn: listJobTitleOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useUserSearch = (term: string, enabled: boolean) =>
  useQuery({
    queryKey: [ORG_MODULE, 'users', 'search', term],
    queryFn: () => searchUsers(term),
    enabled: enabled && term.trim().length >= 2,
    staleTime: 30_000,
    retry: false,
    select: (page) => page.items,
  });

/** Resolve a single user (e.g. the current manager) for display; degrades to undefined on denial. */
export const useUser = (id: string | null) =>
  useQuery({
    queryKey: [ORG_MODULE, 'users', 'detail', id ?? ''],
    queryFn: () => getUser(id ?? ''),
    enabled: id !== null && id !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });
