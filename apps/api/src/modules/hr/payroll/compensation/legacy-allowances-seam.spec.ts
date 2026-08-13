// `employment.allowances[]` does not pay anybody, and this is what keeps it that way (PY-10).
//
// THE DECISIONS, frozen in docs/12-planning/payroll-legacy-allowances-migration.md:
//   1. the migration is not a payment and creates no new entitlement;
//   2. no automatic retroactivity — Pay Items begin at an explicit transition date;
//   3. the legacy array is never a payroll source, during the transition or after it;
//   4. Pay Items are the operational single source of truth for payroll;
//   5. the array is NOT deleted — it stays as historical/audit data.
//
// Decision 3 is the one that can be broken by accident, and it is one property access wide.
// `employee.employment.allowances.length > 0` is a fact about the record; summing `.amount` over
// the same array is money nobody decided to pay. The array sits on the very document the salary
// does, so the tempting line is short — which is why this is enforced twice: an eslint
// `no-restricted-syntax` seam over the whole payroll tree, and the assertions below over what the
// one exempted file is allowed to do with it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeCompensation, type CompensationInput } from './compensation-rules';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — these files explain the rule in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const payrollFiles = sources(PAYROLL);
const rel = (file: string): string => file.slice(PAYROLL.length + 1);

describe('who in payroll may even mention the legacy list', () => {
  it('exactly one file, and it is the one that raises the warning', () => {
    const readers = payrollFiles.filter((file) => /employment\.allowances/.test(code(file)));
    expect(readers.map(rel)).toEqual(['compensation/compensation.service.ts']);
  });

  /**
   * And what that one file may do with it: ask whether the list is EMPTY. Nothing else.
   *
   * The assertion is on the shape of the expression rather than on its absence, because the read
   * is legitimate — decision 3 does not say payroll must be blind to the list, it says the list is
   * not a source of money. Telling the user "you can see allowances on the employment tab and they
   * are not in this figure" is the honest half of that.
   */
  it('and all it does is ask whether the list is empty', () => {
    const service = code(resolve(PAYROLL, 'compensation/compensation.service.ts'));
    const mentions = [...service.matchAll(/employment\.allowances[^\n]*/g)].map((m) => m[0]);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain('.length > 0');
    expect(mentions[0]).not.toContain('.amount');
    expect(mentions[0]).not.toContain('map(');
    expect(mentions[0]).not.toContain('reduce(');
  });

  it('and hands the engine a boolean, never the rows', () => {
    const rules = code(resolve(PAYROLL, 'compensation/compensation-rules.ts'));
    expect(rules).toContain('hasLegacyAllowances: boolean;');
    // The pure engine cannot misuse what it never receives.
    expect(rules).not.toContain('allowances[');
    expect(rules).not.toContain('.allowances');
  });

  // The other two things that turn a compensation figure into a paid one.
  it('the payslip and the run never mention it at all', () => {
    for (const file of ['payslips', 'runs']) {
      const dirFiles = payrollFiles.filter((f) => rel(f).startsWith(`${file}/`));
      expect(dirFiles.length, file).toBeGreaterThan(0);
      for (const f of dirFiles) expect(code(f), rel(f)).not.toContain('allowances');
    }
  });
});

/**
 * The source scan says nobody reads the amounts. This says it would not matter if they did —
 * carrying the list changes the WARNING and nothing else about the arithmetic.
 *
 * Stated as an identity between two runs rather than as expected numbers on purpose: it stays
 * true when the rules change, which is exactly when a regression would otherwise slip through.
 */
describe('carrying legacy allowances costs nothing', () => {
  const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  const input = (hasLegacyAllowances: boolean): CompensationInput => ({
    employeeId: 'e1',
    period: '2026-03',
    basicSalary: { amount: 10_000, currency: 'EGP' },
    employmentSpans: [{ from: d('2020-01-01'), to: null }],
    assignments: [
      {
        id: 'a1',
        payItemId: 'p1',
        amount: 3_000,
        currency: 'EGP',
        effectiveFrom: d('2020-01-01'),
        effectiveTo: null,
        item: {
          code: 'HOUSING',
          name: { ar: 'بدل سكن', en: 'Housing' },
          kind: 'earning',
          calcBasis: 'fixed',
          quantitySource: null,
          sortOrder: 10,
        },
      },
    ],
    hasLegacyAllowances,
    adjustments: [],
    attendance: null,
    leave: null,
  });

  const withList = computeCompensation(input(true));
  const without = computeCompensation(input(false));

  it('produces identical lines and identical totals', () => {
    // Named explicitly rather than compared as whole objects: a mistyped key would make an
    // object comparison pass on two `undefined`s and prove nothing.
    expect(withList.earnings).toEqual(without.earnings);
    expect(withList.deductions).toEqual(without.deductions);
    expect(withList.deferred).toEqual(without.deferred);
    expect(withList.totalEarningsMinor).toBe(without.totalEarningsMinor);
    expect(withList.totalDeductionsMinor).toBe(without.totalDeductionsMinor);
    expect(withList.netMinor).toBe(without.netMinor);
  });

  // Decision 4 — the pay-item assignment is what pays, and it is the ONLY line here. The basic
  // salary is a field of its own, not an earning line, so a legacy allowance would have had to
  // appear as a second line to be paid; there is none.
  it('the only line is the assigned pay item', () => {
    expect(withList.earnings.map((line) => line.code)).toEqual(['HOUSING']);
    expect(withList.deductions).toEqual([]);
    expect(withList.totalEarningsMinor).toBe(300_000); // 3,000.00 — the pay item, and nothing else
    expect(withList.basicSalary).toBe(10_000);
  });

  it('and the difference is a warning, which is the whole point of reading the list', () => {
    expect(withList.warnings).toContain('legacyAllowancesIgnored');
    expect(without.warnings).not.toContain('legacyAllowancesIgnored');
    expect(withList.warnings.filter((w) => w !== 'legacyAllowancesIgnored')).toEqual(
      without.warnings,
    );
  });
});
