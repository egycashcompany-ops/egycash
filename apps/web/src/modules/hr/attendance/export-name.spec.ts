// What an attendance export is called on disk — the owner's naming rule, as arithmetic over
// strings. It matters more than it looks: HR will have a folder of these, and a file whose name
// does not say which day and which branch it is about has to be opened to be identified.
import { describe, expect, it } from 'vitest';
import type { OrgUnitOptionDto } from '@ecms/contracts';
import { exportFileName, soleBranchName } from './export-name';

const branch = (id: string, ar: string, en: string): OrgUnitOptionDto => ({
  id,
  code: id.toUpperCase(),
  name: { ar, en },
  parentId: null,
  catalogId: null,
});

const BRANCHES = [
  branch('b-1', 'المهندسين', 'Mohandessin'),
  branch('b-2', 'مدينة نصر', 'Nasr City'),
];

describe('the file name', () => {
  it('names one day by its date', () => {
    expect(exportFileName('2026-11-18', '2026-11-18')).toBe('attendance-2026-11-18.csv');
  });

  it('names a range by both ends', () => {
    expect(exportFileName('2026-11-01', '2026-11-18')).toBe('attendance-2026-11-01_2026-11-18.csv');
  });

  it('appends the branch when one is filtered, in the reader‘s language', () => {
    expect(exportFileName('2026-11-18', '2026-11-18', 'المهندسين')).toBe(
      'attendance-2026-11-18-المهندسين.csv',
    );
    expect(exportFileName('2026-11-18', '2026-11-18', 'Mohandessin')).toBe(
      'attendance-2026-11-18-Mohandessin.csv',
    );
  });

  it('turns a multi-word name into one hyphenated token', () => {
    expect(exportFileName('2026-11-18', '2026-11-18', 'مدينة نصر')).toBe(
      'attendance-2026-11-18-مدينة-نصر.csv',
    );
  });

  it('strips what a file system would refuse, rather than producing a name that cannot be saved', () => {
    // A branch named with a slash would otherwise make the browser write into a directory that
    // does not exist, and the download would fail with nothing to explain it.
    expect(exportFileName('2026-11-18', '2026-11-18', 'أ/ب:ج')).toBe('attendance-2026-11-18-أ-ب-ج.csv');
  });

  it('appends nothing when there is nothing to append', () => {
    expect(exportFileName('2026-11-18', '2026-11-18', undefined)).toBe('attendance-2026-11-18.csv');
    expect(exportFileName('2026-11-18', '2026-11-18', '')).toBe('attendance-2026-11-18.csv');
  });
});

describe('the branch in the name', () => {
  it('is the one filtered, when exactly one is', () => {
    expect(soleBranchName(['b-1'], BRANCHES, 'ar')).toBe('المهندسين');
    expect(soleBranchName(['b-1'], BRANCHES, 'en')).toBe('Mohandessin');
  });

  it('is nothing when every branch is in the file, or several are', () => {
    // Naming a file after one of two branches would be a lie about what is inside it.
    expect(soleBranchName([], BRANCHES, 'ar')).toBeUndefined();
    expect(soleBranchName(['b-1', 'b-2'], BRANCHES, 'ar')).toBeUndefined();
  });

  it('is nothing when the options have not loaded, or name a branch that is gone', () => {
    expect(soleBranchName(['b-1'], undefined, 'ar')).toBeUndefined();
    expect(soleBranchName(['b-9'], BRANCHES, 'ar')).toBeUndefined();
  });
});
