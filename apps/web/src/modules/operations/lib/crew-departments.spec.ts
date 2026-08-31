// The department picker's rules. The interesting one is the third block: a configured id that no
// active department answers to must still be VISIBLE, because the bug this whole screen exists to
// fix was a configuration nobody could see.
import { describe, expect, it } from 'vitest';
import {
  departmentChoices,
  sameDepartments,
  toggleDepartment,
  type DepartmentOption,
} from './crew-departments';

const option = (id: string, code: string, ar: string, en: string): DepartmentOption => ({
  id,
  code,
  name: { ar, en },
});

const CASH = option('d1', 'DEP-01', 'نقل الأموال', 'Cash transfer');
const HR = option('d2', 'DEP-02', 'الموارد البشرية', 'Human resources');

describe('departmentChoices', () => {
  it('offers every active department, ticking the configured ones', () => {
    const rows = departmentChoices([CASH, HR], ['d1'], 'en');
    expect(rows.map((r) => [r.id, r.selected])).toEqual([
      ['d1', true],
      ['d2', false],
    ]);
    expect(rows.every((r) => r.known)).toBe(true);
  });

  it('labels in the reader’s locale', () => {
    expect(departmentChoices([CASH], [], 'ar')[0]?.label).toBe('نقل الأموال');
    expect(departmentChoices([CASH], [], 'en')[0]?.label).toBe('Cash transfer');
  });

  it('keeps the order the server sent, so the list does not reshuffle', () => {
    expect(departmentChoices([HR, CASH], [], 'en').map((r) => r.id)).toEqual(['d2', 'd1']);
  });

  it('shows a configured id no active department answers to, so it can be removed', () => {
    const rows = departmentChoices([CASH], ['d1', 'gone'], 'en');
    expect(rows).toHaveLength(2);
    const stale = rows[1];
    expect(stale?.id).toBe('gone');
    expect(stale?.known).toBe(false);
    expect(stale?.label).toBeNull();
    // Still ticked: it IS in the setting, and saying otherwise would misreport the configuration.
    expect(stale?.selected).toBe(true);
  });

  it('puts the unknown ones last', () => {
    expect(departmentChoices([CASH, HR], ['gone', 'd2'], 'en').map((r) => r.id)).toEqual([
      'd1',
      'd2',
      'gone',
    ]);
  });

  it('is empty when the options could not be read and nothing is configured', () => {
    expect(departmentChoices([], [], 'en')).toEqual([]);
  });
});

describe('toggleDepartment', () => {
  it('adds at the end and removes in place', () => {
    expect(toggleDepartment(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleDepartment(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('does not mutate its input', () => {
    const before = ['a'];
    toggleDepartment(before, 'b');
    expect(before).toEqual(['a']);
  });
});

describe('sameDepartments', () => {
  it('ignores order', () => {
    expect(sameDepartments(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('sees an addition, a removal and a swap', () => {
    expect(sameDepartments(['a'], ['a', 'b'])).toBe(false);
    expect(sameDepartments(['a', 'b'], ['a'])).toBe(false);
    expect(sameDepartments(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('two empties are the same', () => {
    expect(sameDepartments([], [])).toBe(true);
  });
});
