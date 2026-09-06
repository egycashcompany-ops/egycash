// The cascade, which is the only part of the placement filters with behaviour worth pinning:
// what a reader may pick from once they have picked higher up, and what has to be dropped when
// they change their mind.
import { describe, expect, it } from 'vitest';
import { type OrgUnitOptionDto } from '@ecms/contracts';
import { departmentsIn, hasPlacementFilter, prunePlacement, sectionsIn } from './placement-filters';

const unit = (id: string, parentId: string | null): OrgUnitOptionDto => ({
  id,
  code: id.toUpperCase(),
  name: { ar: id, en: id },
  parentId,
});

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const DEPARTMENTS = [unit('dep-a1', BRANCH_A), unit('dep-a2', BRANCH_A), unit('dep-b1', BRANCH_B)];
const SECTIONS = [unit('sec-a1', 'dep-a1'), unit('sec-a2', 'dep-a2'), unit('sec-b1', 'dep-b1')];

const at = (over: Partial<Parameters<typeof prunePlacement>[0]> = {}) => ({
  branchId: '',
  departmentId: '',
  sectionId: '',
  jobTitleId: '',
  ...over,
});

describe('what a reader may pick from', () => {
  it('offers every department while no site is chosen', () => {
    expect(departmentsIn(DEPARTMENTS, '').map((d) => d.id)).toEqual(['dep-a1', 'dep-a2', 'dep-b1']);
  });

  it('offers only the chosen site’s departments', () => {
    expect(departmentsIn(DEPARTMENTS, BRANCH_A).map((d) => d.id)).toEqual(['dep-a1', 'dep-a2']);
  });

  it('offers only the chosen department’s sections', () => {
    expect(sectionsIn(SECTIONS, DEPARTMENTS, BRANCH_A, 'dep-a1').map((s) => s.id)).toEqual(['sec-a1']);
  });

  /**
   * A site narrows sections even with no department chosen. Offering every section in the company
   * would put units from other sites in a list the reader has already narrowed to one place.
   */
  it('narrows sections to the chosen site when no department is chosen', () => {
    expect(sectionsIn(SECTIONS, DEPARTMENTS, BRANCH_A, '').map((s) => s.id)).toEqual([
      'sec-a1',
      'sec-a2',
    ]);
  });

  it('offers every section when nothing above it is chosen', () => {
    expect(sectionsIn(SECTIONS, DEPARTMENTS, '', '')).toHaveLength(3);
  });
});

describe('what has to be dropped when the reader changes their mind', () => {
  /** THE ONE THAT MATTERS: a stale child would filter the list to nothing and say nothing. */
  it('drops a department and section that do not belong to the newly chosen site', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentId: 'dep-a1', sectionId: 'sec-a1' }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentId).toBe('');
    expect(next.sectionId).toBe('');
  });

  it('keeps a department and section that still belong', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_A, departmentId: 'dep-a1', sectionId: 'sec-a1' }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentId).toBe('dep-a1');
    expect(next.sectionId).toBe('sec-a1');
  });

  it('drops only the section when the department changes within one site', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_A, departmentId: 'dep-a2', sectionId: 'sec-a1' }),
      DEPARTMENTS,
      SECTIONS,
    );
    expect(next.departmentId).toBe('dep-a2');
    expect(next.sectionId).toBe('');
  });

  /** The job title hangs under nothing, so nothing the reader picks above it can invalidate it. */
  it('never touches the job title', () => {
    const next = prunePlacement(
      at({ branchId: BRANCH_B, departmentId: 'dep-a1', jobTitleId: 'job-1' }),
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

  it.each([['branchId'], ['departmentId'], ['sectionId'], ['jobTitleId']] as const)(
    'says something is narrowed when %s is chosen',
    (key) => {
      expect(hasPlacementFilter(at({ [key]: 'x' }))).toBe(true);
    },
  );
});
