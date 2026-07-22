// Reference lookups shared across the org-structure screens: active Branches/Departments used to
// populate parent pickers and list filters, plus user search/lookup for the manager field. Each is
// gated by its own `*.view` permission on the server; on denial the query degrades to empty rather
// than erroring the whole screen.
import { useQuery } from '@tanstack/react-query';
import {
  type BranchDto,
  type DepartmentDto,
  type Paginated,
  type SectionDto,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage } from '../../../shared/lib/api-client';
import { ORG_MODULE } from './org-unit-resource';

const listBranches = (): Promise<Paginated<BranchDto>> =>
  getPage<BranchDto>(`/platform/branches${buildQuery({ status: 'active', pageSize: 200 })}`);

const listDepartments = (branchId?: string): Promise<Paginated<DepartmentDto>> =>
  getPage<DepartmentDto>(
    `/platform/departments${buildQuery({ status: 'active', pageSize: 200, branchId })}`,
  );

const listSections = (departmentId?: string): Promise<Paginated<SectionDto>> =>
  getPage<SectionDto>(
    `/platform/sections${buildQuery({ status: 'active', pageSize: 200, departmentId })}`,
  );

const searchUsers = (term: string): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);

const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

export const useBranchOptions = (enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'branches', 'options'],
    queryFn: listBranches,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

/** Departments of a branch (or all active departments when no branch is given). */
export const useDepartmentOptions = (branchId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'departments', 'options', branchId ?? 'all'],
    queryFn: () => listDepartments(branchId),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

/** Sections of a department (or all active sections when no department is given). */
export const useSectionOptions = (departmentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [ORG_MODULE, 'sections', 'options', departmentId ?? 'all'],
    queryFn: () => listSections(departmentId),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
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
