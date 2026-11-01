// «عايز الـ Sort بتاع كود الموظف يعتمد آخر ٤ أرقام بس .. يعني Ignore 010 وهكذا فى الـ Sort فقط».
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeNumberExpression, codeNumberKey, employeeCodeSort } from './employee-code-sort';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = resolve(HERE, '../..');

const repositories = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return repositories(full);
    return entry.name.endsWith('.repository.ts') ? [full] : [];
  });

describe('ordering by Employee Code orders by the number after the branch prefix', () => {
  it('leaves every other column to its plain query', () => {
    expect(employeeCodeSort('code', 'hiredAt', 'asc')).toEqual({});
    expect(employeeCodeSort('code', undefined, 'desc')).toEqual({});
  });

  /** The number first; the full code only to settle two equal numbers under different prefixes. */
  it('sorts by the number, then by the code, in the direction asked for', () => {
    expect(employeeCodeSort('employeeCode', 'employeeCode', 'desc').sorts).toEqual([
      { by: 'employeeCodeNumber', dir: 'desc' },
      { by: 'employeeCode', dir: 'desc' },
    ]);
  });

  /**
   * Everything AFTER the 3-digit prefix, not «the last four»: the two agree today, and the number
   * widens past 9999. A code that is not digits converts to null, which sorts last.
   */
  it('computes the number from what follows the prefix, null when it is not digits', () => {
    expect(codeNumberExpression('code')).toEqual({
      $convert: { input: { $substrCP: ['$code', 3, 32] }, to: 'long', onError: null, onNull: null },
    });
    expect(employeeCodeSort('code', 'code', 'asc').sortDerived).toEqual([
      { key: 'codeNumber', expression: codeNumberExpression('code') },
    ]);
  });

  /**
   * EVERY LIST THAT SORTS BY AN EMPLOYEE CODE. A new screen with an `employeeCode` column that
   * forgot this would sort the old way, by branch first, and nothing else would notice.
   */
  it('is wired into every repository list that offers an employee-code sort', () => {
    const offenders: string[] = [];
    for (const file of repositories(MODULES)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/sortableFields: \[([^\]]*)\]/g)) {
        const fields = match[1] ?? '';
        const field = /'employeeCode'/.test(fields)
          ? 'employeeCode'
          : file.endsWith('employees/employee.repository.ts') && /'code'/.test(fields)
            ? 'code'
            : null;
        if (field === null) continue;
        const call = text.slice(match.index ?? 0, (match.index ?? 0) + 400);
        if (!call.includes(`employeeCodeSort('${field}'`) || !fields.includes(`codeNumberKey('${field}')`)) {
          offenders.push(relative(MODULES, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names the computed key after its field', () => {
    expect(codeNumberKey('code')).toBe('codeNumber');
    expect(codeNumberKey('employeeCode')).toBe('employeeCodeNumber');
  });
});
