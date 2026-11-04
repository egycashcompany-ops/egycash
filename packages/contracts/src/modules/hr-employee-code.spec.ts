// The parts of an Employee Code (ADR-017): a 3-digit branch prefix, then the employee's number.
import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_CODE_PATTERN,
  employeeCodeBranchPrefix,
  employeeCodeSerial,
  maskEmployeeCodeBranch,
} from './hr-employee.js';

describe('employee code parts', () => {
  it('splits a code into its branch and its number', () => {
    expect(employeeCodeBranchPrefix('0702862')).toBe('070');
    expect(employeeCodeSerial('0702862')).toBe(2862);
    // The number is what the counter counts: the same whatever prefix it wears.
    expect(employeeCodeSerial('0102862')).toBe(employeeCodeSerial('0702862'));
    // It widens past four digits rather than wrapping.
    expect(employeeCodeSerial('01010000')).toBe(10000);
  });

  it('hides the branch when stating the last code: «xxx2862»', () => {
    expect(maskEmployeeCodeBranch('0702862')).toBe('xxx2862');
  });

  it('takes 3 digits of branch and 4 to 9 of number, digits only', () => {
    expect(EMPLOYEE_CODE_PATTERN.test('0702862')).toBe(true);
    expect(EMPLOYEE_CODE_PATTERN.test('070286')).toBe(false);
    expect(EMPLOYEE_CODE_PATTERN.test('07O2862')).toBe(false);
  });
});
