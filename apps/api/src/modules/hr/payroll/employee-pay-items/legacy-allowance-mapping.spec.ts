// Whether a legacy allowance can become a pay item (PY-10). No database.
//
// The gate this feeds is "prove every record is convertible before deleting any of them", so the
// cases that matter are the ones where the answer is NO — and each of those must say why, in a
// word a human can act on.
import { describe, expect, it } from 'vitest';
import {
  classifyAllowance,
  readinessOf,
  type CatalogEntry,
  type LegacyAllowance,
} from './legacy-allowance-mapping';

const item = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'i1',
  code: 'HOUSING',
  name: { ar: 'بدل سكن', en: 'Housing allowance' },
  kind: 'earning',
  calcBasis: 'fixed',
  status: 'active',
  ...over,
});

const allowance = (name: string, amount = 500): LegacyAllowance => ({
  name,
  amount,
  currency: 'EGP',
});

const CATALOG = [item()];

describe('matching a legacy name to the catalog', () => {
  it('matches a catalog code', () => {
    const m = classifyAllowance(allowance('HOUSING'), CATALOG);
    expect(m.outcome).toBe('byCode');
    expect(m.payItemId).toBe('i1');
  });

  it('matches the Arabic name', () => {
    expect(classifyAllowance(allowance('بدل سكن'), CATALOG).outcome).toBe('byName');
  });

  it('matches the English name', () => {
    expect(classifyAllowance(allowance('Housing allowance'), CATALOG).outcome).toBe('byName');
  });

  it('ignores case and stray whitespace, because those are typing, not meaning', () => {
    expect(classifyAllowance(allowance('  housing  '), CATALOG).outcome).toBe('byCode');
    expect(classifyAllowance(allowance('بدل   سكن'), CATALOG).outcome).toBe('byName');
  });

  // The refusal that keeps this honest. Two strings that a person would call the same allowance
  // are still two strings, and deciding otherwise is a payroll judgement nobody delegated here.
  // `Housing` is deliberately NOT in this list: it is the code `HOUSING` in another case, and
  // case is typing rather than meaning. What is refused is a different STRING.
  it('does NOT match a name that is merely similar', () => {
    for (const name of ['بدل السكن', 'housing allowances', 'سكن', 'housing-allowance']) {
      expect(classifyAllowance(allowance(name), CATALOG).outcome, name).toBe('unmapped');
    }
  });

  it('prefers a code match over a name match', () => {
    const catalog = [item(), item({ id: 'i2', code: 'OTHER', name: { ar: 'HOUSING', en: 'X' } })];
    expect(classifyAllowance(allowance('HOUSING'), catalog).payItemId).toBe('i1');
  });

  it('refuses to choose when several items carry the name', () => {
    const catalog = [item(), item({ id: 'i2', code: 'HOUSING_2' })];
    const m = classifyAllowance(allowance('بدل سكن'), catalog);
    expect(m.outcome).toBe('ambiguous');
    expect(m.payItemId).toBeNull();
    expect(m.candidateIds).toEqual(['i1', 'i2']);
  });

  it('matches an ARCHIVED item too — reporting what a row means is not assigning it', () => {
    const m = classifyAllowance(allowance('HOUSING'), [item({ status: 'archived' })]);
    expect(m.outcome).toBe('byCode');
  });

  it('calls a zero or negative row unpayable rather than unmapped', () => {
    expect(classifyAllowance(allowance('HOUSING', 0), CATALOG).outcome).toBe('notPayable');
    expect(classifyAllowance(allowance('HOUSING', -100), CATALOG).outcome).toBe('notPayable');
  });

  it('treats a blank name as unmapped, never as a match on a blank code', () => {
    expect(classifyAllowance(allowance('   '), CATALOG).outcome).toBe('unmapped');
  });

  it('reports unmapped against an empty catalog rather than failing', () => {
    expect(classifyAllowance(allowance('HOUSING'), []).outcome).toBe('unmapped');
  });
});

describe('the readiness report', () => {
  it('is convertible only when nothing is unmapped or ambiguous', () => {
    const ready = readinessOf([
      classifyAllowance(allowance('HOUSING'), CATALOG),
      classifyAllowance(allowance('بدل سكن'), CATALOG),
      classifyAllowance(allowance('HOUSING', 0), CATALOG),
    ]);
    expect(ready.convertible).toBe(true);
    expect(ready.total).toBe(3);
    expect(ready.byOutcome.byCode).toBe(1);
    expect(ready.byOutcome.byName).toBe(1);
    expect(ready.byOutcome.notPayable).toBe(1);
  });

  it('is NOT convertible while one row is unmapped', () => {
    const ready = readinessOf([
      classifyAllowance(allowance('HOUSING'), CATALOG),
      classifyAllowance(allowance('بدل انتقال'), CATALOG),
    ]);
    expect(ready.convertible).toBe(false);
    expect(ready.unmappedNames).toEqual(['بدل انتقال']);
  });

  it('is NOT convertible while one row is ambiguous — guessing is the refused move', () => {
    const catalog = [item(), item({ id: 'i2', code: 'HOUSING_2' })];
    const ready = readinessOf([classifyAllowance(allowance('بدل سكن'), catalog)]);
    expect(ready.convertible).toBe(false);
    expect(ready.unmappedNames).toEqual(['بدل سكن']);
  });

  it('lists each distinct name once, so the work list is the work', () => {
    const ready = readinessOf([
      classifyAllowance(allowance('بدل انتقال'), CATALOG),
      classifyAllowance(allowance('بدل انتقال'), CATALOG),
      classifyAllowance(allowance('بدل وجبة'), CATALOG),
    ]);
    expect(ready.unmappedNames).toHaveLength(2);
  });

  it('is convertible over an empty set — nothing to convert is not a blocker', () => {
    expect(readinessOf([]).convertible).toBe(true);
  });
});
