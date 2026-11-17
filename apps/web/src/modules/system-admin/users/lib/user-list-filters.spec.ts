// One «الأمن» in the filter, however many branches have it — and choosing it means all of them.
import { describe, expect, it } from 'vitest';
import { type OrgUnitOptionDto } from '@ecms/contracts';
import { departmentChoices, departmentIdsFor } from './user-list-filters';

const unit = (
  id: string,
  ar: string,
  parentId: string,
  catalogId: string | null = null,
): OrgUnitOptionDto => ({ id, code: id, name: { ar, en: ar }, parentId, catalogId });

const DEPARTMENTS = [
  unit('sec-cairo', 'الأمن', 'cairo', 'cat-security'),
  unit('sec-alex', 'الأمن', 'alex', 'cat-security'),
  unit('ops-cairo', 'العمليات', 'cairo', 'cat-ops'),
  // Never linked to the catalog, but recognisably the same department by its name.
  unit('ops-tanta', 'العمليات', 'tanta'),
];

describe('departmentChoices', () => {
  it('lists each company department once, standing for every branch copy', () => {
    const choices = departmentChoices(DEPARTMENTS, null);
    expect(choices.map((c) => c.name.ar)).toEqual(['الأمن', 'العمليات']);
    expect(choices.find((c) => c.name.ar === 'الأمن')?.ids.sort()).toEqual([
      'sec-alex',
      'sec-cairo',
    ]);
    expect(choices.find((c) => c.name.ar === 'العمليات')?.ids.sort()).toEqual([
      'ops-cairo',
      'ops-tanta',
    ]);
  });

  it('offers only the chosen branch’s copies', () => {
    const choices = departmentChoices(DEPARTMENTS, 'alex');
    expect(choices).toHaveLength(1);
    expect(choices[0]?.ids).toEqual(['sec-alex']);
  });
});

describe('departmentIdsFor', () => {
  it('expands a chosen department to its copies, and nothing chosen to no filter', () => {
    const key = departmentChoices(DEPARTMENTS, null).find((c) => c.name.ar === 'الأمن')?.key ?? '';
    expect(departmentIdsFor(DEPARTMENTS, null, [key]).sort()).toEqual(['sec-alex', 'sec-cairo']);
    expect(departmentIdsFor(DEPARTMENTS, 'cairo', [key])).toEqual(['sec-cairo']);
    expect(departmentIdsFor(DEPARTMENTS, null, [])).toEqual([]);
  });

  it('ignores a key no longer on offer rather than filtering to nothing', () => {
    expect(departmentIdsFor(DEPARTMENTS, null, ['catalog:gone'])).toEqual([]);
  });
});
