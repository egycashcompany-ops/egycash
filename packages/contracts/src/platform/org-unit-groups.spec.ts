// The department-grouping rule both the crew card and the crew roster read.
//
// The names are the owner's own, from the screenshot that asked for this: «نقل الاموال» seven
// times over, «العمليات» six, «عمليات نقل الأموال» once. If the card and the server ever disagreed
// on what "the same department" means, a department would show as chosen while the roster left a
// branch of it out — so the rule is pinned here, once, for both.
import { describe, expect, it } from 'vitest';
import {
  expandOrgUnitSelection,
  foldOrgUnitName,
  orgUnitGroupKeys,
  type OrgUnitGroupSource,
} from './org-unit-groups.js';

const unit = (id: string, ar: string, catalogId: string | null = null, en = ''): OrgUnitGroupSource => ({
  id,
  name: { ar, en },
  catalogId,
});

describe('foldOrgUnitName', () => {
  it('meets the spellings the company actually typed', () => {
    expect(foldOrgUnitName('نقل الاموال')).toBe(foldOrgUnitName('نقل الأموال'));
    expect(foldOrgUnitName('الإدارة')).toBe(foldOrgUnitName('الاداره'));
    expect(foldOrgUnitName('الرقابة و المستهلكات')).toBe(foldOrgUnitName('الرقابة والمستهلكات'));
    expect(foldOrgUnitName('التشغيل ( ادارى )')).toBe(foldOrgUnitName('التشغيل (إداري)'));
    expect(foldOrgUnitName('  الحركة  ')).toBe(foldOrgUnitName('الحركة'));
  });

  it('drops the marks a reader does not see', () => {
    expect(foldOrgUnitName('العَمَلِيّات')).toBe(foldOrgUnitName('العمليات'));
    expect(foldOrgUnitName('العمـــليات')).toBe(foldOrgUnitName('العمليات'));
    expect(foldOrgUnitName('‏العمليات‎')).toBe(foldOrgUnitName('العمليات'));
  });

  it('keeps two departments that only share words apart', () => {
    // «نقل الأموال» and «عمليات نقل الأموال» are two lines of the owner's screenshot, not one.
    expect(foldOrgUnitName('نقل الأموال')).not.toBe(foldOrgUnitName('عمليات نقل الأموال'));
    expect(foldOrgUnitName('العمليات')).not.toBe(foldOrgUnitName('الحركة'));
  });
});

describe('orgUnitGroupKeys', () => {
  it('groups branch copies of one catalog entry, whatever each copy is called', () => {
    const keys = orgUnitGroupKeys([
      unit('a', 'نقل الأموال', 'cat-cash'),
      unit('b', 'نقل اموال طنطا', 'cat-cash'),
      unit('c', 'العمليات', 'cat-ops'),
    ]);
    expect(keys.get('a')).toBe('catalog:cat-cash');
    expect(keys.get('b')).toBe('catalog:cat-cash');
    expect(keys.get('c')).toBe('catalog:cat-ops');
  });

  it('groups never-linked units by their folded name', () => {
    const keys = orgUnitGroupKeys([
      unit('a', 'نقل الاموال'),
      unit('b', 'نقل الأموال'),
      unit('c', 'عمليات نقل الأموال'),
    ]);
    expect(keys.get('a')).toBe(keys.get('b'));
    expect(keys.get('a')?.startsWith('name:')).toBe(true);
    expect(keys.get('c')).not.toBe(keys.get('a'));
  });

  it('puts an unlinked unit into the one catalog entry that carries its name', () => {
    const keys = orgUnitGroupKeys([
      unit('linked', 'العمليات', 'cat-ops'),
      unit('new-branch', 'العمليات'),
    ]);
    expect(keys.get('new-branch')).toBe('catalog:cat-ops');
  });

  it('does not guess between two catalog entries of the same name', () => {
    const keys = orgUnitGroupKeys([
      unit('x', 'العمليات', 'cat-1'),
      unit('y', 'العمليات', 'cat-2'),
      unit('z', 'العمليات'),
    ]);
    expect(keys.get('z')).toBe(`name:${foldOrgUnitName('العمليات')}`);
  });

  it('falls back to the English name, and to the unit itself when there is no name at all', () => {
    const keys = orgUnitGroupKeys([
      unit('a', '', null, 'Treasury'),
      unit('b', ' ', null, 'treasury'),
      unit('c', '', null, ''),
      unit('d', '', null, ''),
    ]);
    expect(keys.get('a')).toBe(keys.get('b'));
    expect(keys.get('c')).toBe('unit:c');
    expect(keys.get('d')).toBe('unit:d');
  });
});

describe('expandOrgUnitSelection', () => {
  const population = [
    unit('cash-mohandessin', 'نقل الاموال', 'cat-cash'),
    unit('cash-tanta', 'نقل الاموال', 'cat-cash'),
    unit('cash-alex', 'نقل الأموال'), // a newer branch, never linked — joins by name
    unit('cash-closed', 'نقل الاموال', 'cat-cash'), // inactive
    unit('ops-mohandessin', 'العمليات', 'cat-ops'),
    unit('hr-mohandessin', 'الموارد البشرية', 'cat-hr'),
  ];
  const active = population.filter((u) => u.id !== 'cash-closed');

  it('widens one saved branch copy to the department in every active branch', () => {
    expect(expandOrgUnitSelection(['cash-mohandessin'], population, active)).toEqual([
      'cash-mohandessin',
      'cash-tanta',
      'cash-alex',
    ]);
  });

  it('leaves unchosen departments out', () => {
    const ids = expandOrgUnitSelection(['ops-mohandessin'], population, active);
    expect(ids).toEqual(['ops-mohandessin']);
  });

  it('keeps every saved id, an inactive one included, so it is never narrower than the list', () => {
    expect(expandOrgUnitSelection(['cash-closed'], population, active)).toEqual([
      'cash-closed',
      'cash-mohandessin',
      'cash-tanta',
      'cash-alex',
    ]);
  });

  it('carries an id nothing answers to without widening it', () => {
    expect(expandOrgUnitSelection(['gone', 'ops-mohandessin'], population, active)).toEqual([
      'gone',
      'ops-mohandessin',
    ]);
  });

  it('includes a branch that opened after the list was saved', () => {
    const opened = unit('cash-new', 'نقل الاموال', 'cat-cash');
    expect(
      expandOrgUnitSelection(['cash-tanta'], [...population, opened], [...active, opened]),
    ).toContain('cash-new');
  });

  it('answers each id once, in lower case, and nothing for nothing', () => {
    expect(
      expandOrgUnitSelection(['CASH-TANTA', 'cash-tanta'], population, active).filter(
        (id) => id === 'cash-tanta',
      ),
    ).toHaveLength(1);
    expect(expandOrgUnitSelection([], population, active)).toEqual([]);
  });
});
