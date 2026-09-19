// The fold and the cascade — the two things the placement filters do that a reader can get wrong.
//
// The fold is the one that produced this file's second version: «الأمن» is one record per branch,
// eight in this company, and the dropdown listed all eight identically. It is one department to the
// company, so it is one choice here, standing for every branch copy in scope.
import { describe, expect, it } from 'vitest';
import { type OrgUnitOptionDto } from '@ecms/contracts';
import {
  departmentGroupsIn,
  departmentIdsFor,
  groupKeyOf,
  hasPlacementFilter,
  prunePlacement,
  sectionGroupsIn,
  sectionIdsFor,
} from './placement-filters';

const unit = (
  id: string,
  parentId: string | null,
  name: string,
  catalogId: string | null = `cat-${name}`,
): OrgUnitOptionDto => ({
  id,
  code: id.toUpperCase(),
  name: { ar: name, en: name },
  parentId,
  catalogId,
});

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
// «الأمن» in two sites, «الحركة» in one: three records, two departments.
const DEPARTMENTS = [
  unit('sec-a', BRANCH_A, 'الأمن'),
  unit('sec-b', BRANCH_B, 'الأمن'),
  unit('mov-a', BRANCH_A, 'الحركة'),
];
// «التشغيل» under each of the three, «الصيانة» under one.
const SECTIONS = [
  unit('ops-sec-a', 'sec-a', 'التشغيل'),
  unit('ops-sec-b', 'sec-b', 'التشغيل'),
  unit('ops-mov-a', 'mov-a', 'التشغيل'),
  unit('mnt-mov-a', 'mov-a', 'الصيانة'),
];

const at = (over: Partial<Parameters<typeof prunePlacement>[0]> = {}) => ({
  branchId: '',
  departmentKey: '',
  sectionKey: '',
  jobTitleId: '',
  ...over,
});

const SECURITY = groupKeyOf(DEPARTMENTS[0] as OrgUnitOptionDto);
const MOVEMENT = groupKeyOf(DEPARTMENTS[2] as OrgUnitOptionDto);
const OPERATIONS = groupKeyOf(SECTIONS[0] as OrgUnitOptionDto);

describe('one department, not one per branch', () => {
  /** THE FOLD. Three records, two names, two choices. */
  it('offers «الأمن» once though it exists in two sites', () => {
    const groups = departmentGroupsIn(DEPARTMENTS, '');
    expect(groups.map((g) => g.name.ar)).toEqual(['الأمن', 'الحركة']);
  });

  it('makes that one choice stand for every branch copy', () => {
    expect(departmentIdsFor(DEPARTMENTS, at({ departmentKey: SECURITY }))).toEqual(['sec-a', 'sec-b']);
  });

  it('narrows the choice to the one copy in a chosen site', () => {
    expect(departmentIdsFor(DEPARTMENTS, at({ branchId: BRANCH_B, departmentKey: SECURITY }))).toEqual([
      'sec-b',
    ]);
  });

  it('offers only the departments the chosen site actually has', () => {
    expect(departmentGroupsIn(DEPARTMENTS, BRANCH_B).map((g) => g.name.ar)).toEqual(['الأمن']);
  });

  /** A unit never linked to the catalog is still recognisably «الأمن» — folded by its name. */
  it('folds an unlinked copy in with its namesakes by name', () => {
    const withUnlinked = [...DEPARTMENTS, unit('sec-c', 'branch-c', 'الأمن', null)];
    // Unlinked keys by name, linked by catalog — two groups, because they cannot be proven the same.
    const groups = departmentGroupsIn(withUnlinked, '');
    expect(groups.filter((g) => g.name.ar === 'الأمن')).toHaveLength(2);
    expect(groupKeyOf(unit('x', null, 'الأمن', null))).toBe('name:الأمن');
  });

  it('sends nothing when no department is chosen', () => {
    expect(departmentIdsFor(DEPARTMENTS, at())).toEqual([]);
  });
});

describe('sections, folded the same way', () => {
  it('offers «التشغيل» once across a company-wide department', () => {
    const groups = sectionGroupsIn(SECTIONS, DEPARTMENTS, at({ departmentKey: SECURITY }));
    expect(groups.map((g) => g.name.ar)).toEqual(['التشغيل']);
    expect(groups[0]?.ids).toEqual(['ops-sec-a', 'ops-sec-b']);
  });

  it('narrows to the chosen site’s copy when both site and department are chosen', () => {
    expect(
      sectionIdsFor(SECTIONS, DEPARTMENTS, at({ branchId: BRANCH_A, departmentKey: SECURITY, sectionKey: OPERATIONS })),
    ).toEqual(['ops-sec-a']);
  });

  /** A site narrows sections even with no department chosen — not every section in the company. */
  it('offers the sections of every department in a chosen site', () => {
    const groups = sectionGroupsIn(SECTIONS, DEPARTMENTS, at({ branchId: BRANCH_A }));
    expect(groups.map((g) => g.name.ar)).toEqual(['التشغيل', 'الصيانة']);
    expect(groups.find((g) => g.name.ar === 'التشغيل')?.ids).toEqual(['ops-sec-a', 'ops-mov-a']);
  });

  it('offers every section when nothing above it is chosen', () => {
    expect(sectionGroupsIn(SECTIONS, DEPARTMENTS, at())).toHaveLength(2);
  });
});

describe('what has to be dropped when the reader changes their mind', () => {
  /** THE ONE THAT MATTERS: a stale child would filter the list to nothing and say nothing. */
  it('drops a department the newly chosen site does not have, and a section only it had', () => {
    const maintenance = groupKeyOf(SECTIONS[3] as OrgUnitOptionDto);
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentKey: MOVEMENT, sectionKey: maintenance }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentKey).toBe('');
    expect(next.sectionKey).toBe('');
  });

  /**
   * A section that is still real in the new scope is KEPT, even though the department it was
   * chosen under is gone: «التشغيل» exists in site B under «الأمن», so "التشغيل in site B" is a
   * narrowing that returns people. Dropping it would throw away a choice that still means something.
   */
  it('keeps a section that still exists in the new scope under another department', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentKey: MOVEMENT, sectionKey: OPERATIONS }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentKey).toBe('');
    expect(next.sectionKey).toBe(OPERATIONS);
  });

  it('keeps a department the new site does have, and its section', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentKey: SECURITY, sectionKey: OPERATIONS }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentKey).toBe(SECURITY);
    expect(next.sectionKey).toBe(OPERATIONS);
  });

  it('drops only the section when the department changes to one without it', () => {
    const maintenance = groupKeyOf(SECTIONS[3] as OrgUnitOptionDto);
    const next = prunePlacement(
      at({ departmentKey: SECURITY, sectionKey: maintenance }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentKey).toBe(SECURITY);
    expect(next.sectionKey).toBe('');
  });

  /** The job title hangs under nothing, so nothing the reader picks above it can invalidate it. */
  it('never touches the job title', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentKey: MOVEMENT, jobTitleId: 'job-1' }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.jobTitleId).toBe('job-1');
  });
});

describe('whether the bar shows a reset', () => {
  it('says nothing is narrowed when nothing is chosen', () => {
    expect(hasPlacementFilter(at())).toBe(false);
  });

  it.each([['branchId'], ['departmentKey'], ['sectionKey'], ['jobTitleId']] as const)(
    'says something is narrowed when %s is chosen',
    (key) => {
      expect(hasPlacementFilter(at({ [key]: 'x' }))).toBe(true);
    },
  );
});
