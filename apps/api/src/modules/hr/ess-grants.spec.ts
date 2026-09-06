// What Employee Self-Service may do, asserted in one place because it is DECLARED in four.
//
// The ESS role is built by `ensureSystemRole` in two paths — at login provisioning, and in the
// leave migration — and widened by `addSystemRoleGrants` from the modules that own the later keys:
// attendance, and now loans. That split is deliberate (a module owns its own keys, and widening
// never reverts an administrator's edit), but it means the SAME set is written down four times.
//
// The failure it invites is silent and one-directional. `ensureSystemRole` returns an existing role
// UNTOUCHED, so a key added only to those two literals reaches fresh installs and no others; a key
// added only to a widen list reaches installed systems and never a fresh one. Either way nothing
// errors — some employees can do a thing and others cannot, depending on when their database was
// created. So the four declarations are read here and required to agree.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESS_LOAN_GRANTS } from './employee-loans';

const HR = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HR, file), 'utf8');

/** The permission keys inside the `ensureSystemRole('employee-self-service', …)` call in a file. */
const freshInstallKeys = (file: string): string[] => {
  const source = read(file);
  const at = source.indexOf("'employee-self-service'");
  expect(at, `${file} no longer declares the ESS role`).toBeGreaterThan(-1);
  const list = source.slice(at, source.indexOf(');', at));
  return [...list.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1] as string);
};

/**
 * WHAT AN EMPLOYEE MAY DO. Read this list to know; change it here and in the four declarations,
 * which is the point of the test failing when they disagree.
 *
 *   • their own leave — see it, ask for it
 *   • their own attendance — see it, ask for a correction
 *   • their own loan — ASK for one. Never approve, disburse or settle: an employee does not decide
 *     their own request, and asking-versus-granting is the whole control on that feature.
 *
 * Every one of them is `own`-scoped at assignment time (Leave L7), so none can reach anyone else.
 */
const ESS_GRANTS = [
  'leave.view',
  'leave.request',
  'attendance.view',
  'attendance.requestRegularization',
  'employeeLoan.create',
];

const FRESH_INSTALL_DECLARATIONS = [
  'employee-management/employees/employee.service.ts',
  'leave-management/leave.migration.ts',
];

describe('the Employee Self-Service grant set', () => {
  it.each(FRESH_INSTALL_DECLARATIONS)('is complete where a FRESH install builds it — %s', (file) => {
    expect([...freshInstallKeys(file)].sort()).toEqual([...ESS_GRANTS].sort());
  });

  it('is complete on an INSTALLED system too, through the module widens', () => {
    // `ensureSystemRole` will not touch a role that exists, so everything beyond the original four
    // has to arrive by widening. Attendance's keys are in the literals above as well (they were
    // added before this split existed); the loan key arrives only this way.
    const attendance = read('attendance/attendance.migration.ts');
    expect(attendance).toContain("'attendance.view'");
    expect(attendance).toContain("'attendance.requestRegularization'");
    expect(ESS_LOAN_GRANTS).toEqual(['employeeLoan.create']);
    for (const key of [...ESS_LOAN_GRANTS]) expect(ESS_GRANTS).toContain(key);
  });

  it('the loan widen actually RUNS — a grant nobody calls is not a grant', () => {
    // The seed is where the modules meet; `grantEssLoanAccess` is inert until it is called there.
    expect(read('hr.seed.ts')).toContain('grantEssLoanAccess()');
  });

  it('gives an employee no key that DECIDES anything', () => {
    // The line this role must never cross. Asking is self-service; approving, paying out and
    // settling all move money and belong to somebody else.
    for (const forbidden of [
      'employeeLoan.approve',
      'employeeLoan.disburse',
      'leave.approve',
      'attendance.decideRegularization',
      'employee.view',
    ]) {
      expect(ESS_GRANTS, `${forbidden} is not self-service`).not.toContain(forbidden);
      for (const file of FRESH_INSTALL_DECLARATIONS) {
        expect(freshInstallKeys(file)).not.toContain(forbidden);
      }
    }
  });
});
