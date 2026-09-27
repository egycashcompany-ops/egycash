// The register half of the employee-directory seam: searched, paged, leavers on request.
//
// Two rules are worth pinning, and both are about what an EMPTY input means. An unregistered
// platform answers an empty page rather than throwing — a deployment without HR still serves IT's
// screens. And an empty department or id list means NOBODY: a caller that resolved no IT
// departments must never find itself asking for the whole company.
import { describe, expect, it, vi } from 'vitest';
import {
  registerEmployeeSearchLookup,
  searchDirectoryEmployees,
  type DirectoryEmployeeListing,
  type DirectoryEmployeeQuery,
} from './index';

const person = (code: string): DirectoryEmployeeListing => ({
  employeeId: `id-${code}`,
  code,
  fullNameAr: `موظف ${code}`,
  status: 'active',
  branchId: null,
  departmentId: null,
  phone: null,
  governorate: null,
  hiredAt: null,
  address: null,
  userId: null,
  jobTitleId: null,
  exitedAt: null,
});

const query = (extra: Partial<DirectoryEmployeeQuery> = {}): DirectoryEmployeeQuery => ({
  status: 'all',
  page: 1,
  pageSize: 25,
  ...extra,
});

describe('the directory register', () => {
  it('answers an empty page, not an error, when no HR source is registered', async () => {
    const page = await searchDirectoryEmployees(query());
    expect(page.items).toEqual([]);
    expect(page.meta.totalItems).toBe(0);
  });

  it('hands the whole question to the source it has', async () => {
    const lookup = vi.fn(async () => ({
      items: [person('0100026')],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }));
    registerEmployeeSearchLookup(lookup);

    const page = await searchDirectoryEmployees(query({ search: 'مصطفى', status: 'exited' }));

    expect(page.items.map((p) => p.code)).toEqual(['0100026']);
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'مصطفى', status: 'exited' }),
    );
  });

  it('reads an EMPTY department or id list as nobody — never as everybody', async () => {
    const lookup = vi.fn();
    registerEmployeeSearchLookup(lookup);

    expect((await searchDirectoryEmployees(query({ departmentIds: [] }))).items).toEqual([]);
    expect((await searchDirectoryEmployees(query({ employeeIds: [] }))).items).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});
