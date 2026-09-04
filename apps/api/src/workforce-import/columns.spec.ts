// The duplicate-header trap, and the layout assertion that keeps the whole import honest.
import { describe, expect, it } from 'vitest';
import { at, bindColumns, fingerprint, normalizeHeader } from './columns';

// The Master sheet's qualification block, in its real order. Two headers appear twice, and which
// occurrence you get decides whether the import keeps the primary qualification or the extra one.
const QUALIFICATION_HEADERS = [
  'المؤهل الدراسي',
  'القسم \\ الشعبة',
  'جهة الحصول',
  'تاريخ المؤهل',
  'مؤهلات اخرى',
  'جهة الحصول',
  'تاريخ المؤهل',
];

describe('bindColumns addresses a column by header AND occurrence', () => {
  /**
   * The defect this module exists for. A header→index map keeps the LAST of each duplicate pair,
   * so the primary qualification's institution (1,256 filled cells) and year (1,651) are replaced
   * by the additional qualification's, which is filled for 1.3% of employees. Nothing errors.
   */
  it('binds the FIRST occurrence to the primary qualification', () => {
    const bound = bindColumns(QUALIFICATION_HEADERS, {
      institution: at('جهة الحصول', 0),
      graduationYear: at('تاريخ المؤهل', 0),
    });
    expect('columns' in bound).toBe(true);
    if (!('columns' in bound)) return;
    expect(bound.columns.institution).toBe(2);
    expect(bound.columns.graduationYear).toBe(3);
  });

  it('binds the SECOND occurrence to the additional qualification', () => {
    const bound = bindColumns(QUALIFICATION_HEADERS, {
      extraInstitution: at('جهة الحصول', 1),
      extraYear: at('تاريخ المؤهل', 1),
    });
    expect('columns' in bound).toBe(true);
    if (!('columns' in bound)) return;
    expect(bound.columns.extraInstitution).toBe(5);
    expect(bound.columns.extraYear).toBe(6);
  });

  it('binds both pairs in one spec without either shadowing the other', () => {
    const bound = bindColumns(QUALIFICATION_HEADERS, {
      institution: at('جهة الحصول', 0),
      extraInstitution: at('جهة الحصول', 1),
    });
    if (!('columns' in bound)) throw new Error('expected a binding');
    expect(bound.columns.institution).not.toBe(bound.columns.extraInstitution);
  });

  it('reports a column it cannot find rather than returning a map with a hole', () => {
    // A hole reads downstream as "this employee had no national ID", which is a false statement
    // about a person rather than a failure to read a file.
    const bound = bindColumns(['الاسم', 'code'], {
      name: at('الاسم'),
      nationalId: at('الرقم القومى'),
    });
    expect('missing' in bound).toBe(true);
    if (!('missing' in bound)) return;
    expect(bound.missing).toEqual(['nationalId ("الرقم القومى")']);
  });

  it('reports a missing SECOND occurrence distinguishably from a missing first', () => {
    const bound = bindColumns(['جهة الحصول'], { extra: at('جهة الحصول', 1) });
    if (!('missing' in bound)) throw new Error('expected a miss');
    expect(bound.missing[0]).toContain('#2');
  });

  it('ignores blank spacer columns when counting occurrences', () => {
    const bound = bindColumns(['a', null, '', 'b'], { b: at('b') });
    if (!('columns' in bound)) throw new Error('expected a binding');
    expect(bound.columns.b).toBe(3);
  });
});

describe('normalizeHeader is loose about how a header was typed', () => {
  it('unifies Arabic letter forms and spacing, so one column is not two', () => {
    expect(normalizeHeader('الرقم التاميني')).toBe(normalizeHeader('الرقم التأمينى'));
    expect(normalizeHeader('c 6')).toBe(normalizeHeader('c6'));
    expect(normalizeHeader(' الاسم ')).toBe(normalizeHeader('الأسم'));
  });

  it('is loose about headers only — it never touches a cell value', () => {
    // Guard against someone reaching for this helper on data. Values keep cell.ts's stricter rules.
    expect(normalizeHeader('محمد أحمد')).toBe('محمداحمد');
  });
});

describe('fingerprint refuses a workbook whose layout moved', () => {
  const HEADERS = ['#', 'code', 'الاسم', 'الرقم القومى'];

  it('is stable across the ways the same header gets typed', () => {
    expect(fingerprint(HEADERS)).toBe(fingerprint(['#', 'code', ' الأسم', 'الرقم  القومى']));
  });

  /**
   * The failure mode this catches, and why it is worth a whole-layout check rather than per-column
   * validation: ONE inserted column shifts every field after it by one, so national IDs land in the
   * address column for all 2,699 rows. Each individual value still looks like a plausible string.
   */
  it('changes when a column is inserted', () => {
    expect(fingerprint(['#', 'code', 'NEW', 'الاسم', 'الرقم القومى'])).not.toBe(fingerprint(HEADERS));
  });

  it('changes when two columns are swapped', () => {
    expect(fingerprint(['#', 'code', 'الرقم القومى', 'الاسم'])).not.toBe(fingerprint(HEADERS));
  });

  it('changes when a column is dropped', () => {
    expect(fingerprint(['#', 'code', 'الاسم'])).not.toBe(fingerprint(HEADERS));
  });
});
