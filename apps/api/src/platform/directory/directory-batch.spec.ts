// The batch half of the employee-directory seam (IT-6).
//
// It exists because a LIST screen resolving names through the single lookup would issue an N+1 the
// moment somebody paged it. What has to hold is the unregistered case: a platform that never had
// an employee source must answer EMPTY rather than throw, so a deployment without HR still serves
// its custody register — with ids where names would be.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDirectoryEmployees,
  registerEmployeeBatchLookup,
  type DirectoryEmployee,
} from './index';

const employee = (id: string, code: string): DirectoryEmployee => ({
  employeeId: id,
  code,
  fullNameAr: `موظف ${code}`,
  status: 'active',
  branchId: null,
  departmentId: null,
});

describe('the batch employee lookup', () => {
  beforeEach(() => {
    registerEmployeeBatchLookup(async (ids) =>
      new Map(ids.filter((id) => id !== 'missing').map((id) => [id, employee(id, id.toUpperCase())])),
    );
  });

  it('answers a map keyed by id', async () => {
    const found = await getDirectoryEmployees(['a', 'b']);
    expect([...found.keys()].sort()).toEqual(['a', 'b']);
    expect(found.get('a')?.code).toBe('A');
  });

  /** An id the source cannot resolve is absent, never a placeholder row. */
  it('omits an id it cannot resolve rather than inventing one', async () => {
    const found = await getDirectoryEmployees(['a', 'missing']);
    expect(found.has('missing')).toBe(false);
    expect(found.size).toBe(1);
  });

  it('asks for nothing when given nothing', async () => {
    expect((await getDirectoryEmployees([])).size).toBe(0);
  });
});
