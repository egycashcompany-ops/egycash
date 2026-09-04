// The two pure decisions in the org resolver, both of which reach the database and neither of which
// had a unit test until one of them shipped a bug that only an integration run caught.
import { describe, expect, it } from 'vitest';
import { deriveBranchCodes, nextFreeCode } from './org';

describe('nextFreeCode counts from what already exists', () => {
  /**
   * THE BUG THIS PINS. The allocator used to count only what the CURRENT run had created, so a
   * second run — the re-run after fixing rejected rows, say — started again at `DEP-0001` and
   * collided with the department the first run had made. Unit codes are globally unique, so the
   * create threw, and the failure surfaced as a person who could not be imported with a duplicate
   * key error buried in their rejection reason.
   */
  it('continues past codes a previous run already issued', () => {
    expect(nextFreeCode('DEP', ['DEP-0001', 'DEP-0002'])).toBe('DEP-0003');
  });

  it('starts at 0001 against an empty catalog', () => {
    expect(nextFreeCode('DEP', [])).toBe('DEP-0001');
  });

  it('takes the HIGHEST, not the count — a deleted code in the middle must not be reissued', () => {
    // `DEP-0002` is gone. Counting would hand out `DEP-0002` again; something may still reference it.
    expect(nextFreeCode('DEP', ['DEP-0001', 'DEP-0003'])).toBe('DEP-0004');
  });

  it('ignores codes belonging to another catalog, and hand-written ones', () => {
    expect(nextFreeCode('DEP', ['SEC-0009', 'JOB-0042', 'DEMO', 'BR-CAI-1', 'DEP-0002'])).toBe(
      'DEP-0003',
    );
  });

  it('is not fooled by a prefix that merely starts the same way', () => {
    expect(nextFreeCode('DEP', ['DEPT-9999'])).toBe('DEP-0001');
  });

  it('keeps the four-digit shape past 9999 without truncating', () => {
    expect(nextFreeCode('DEP', ['DEP-9999'])).toBe('DEP-10000');
  });
});

describe('deriveBranchCodes reads the mapping out of the workbook itself', () => {
  const row = (code: string | null, branchName: string | null) => ({ code, branchName });

  /**
   * Site → code is already in the file: every employee code opens with the 3-digit code of the
   * branch that hired them. Deriving it means the importer cannot disagree with the workbook, and
   * a hard-coded table cannot go stale against a file somebody edits.
   */
  it('maps each site to the prefix its own employees carry', () => {
    const { codes } = deriveBranchCodes([
      row('0100004', 'المهندسين'),
      row('0100005', 'المهندسين'),
      row('0200612', 'طنطا'),
    ]);
    expect(codes.get('المهندسين')).toBe('010');
    expect(codes.get('طنطا')).toBe('020');
  });

  /**
   * The case that makes this a majority rather than a first-seen rule: 148 of the 2,699 employees
   * carry a prefix from a branch they no longer work at, so a site's rows are a mix and the site's
   * OWN prefix is simply the common one.
   */
  it('takes the majority prefix, ignoring people transferred in from elsewhere', () => {
    const { codes, ambiguous } = deriveBranchCodes([
      row('0400001', 'اكتوبر'),
      row('0400002', 'اكتوبر'),
      row('0400003', 'اكتوبر'),
      row('0100099', 'اكتوبر'), // hired in Mohandseen, transferred to October, kept their code
    ]);
    expect(codes.get('اكتوبر')).toBe('040');
    expect(ambiguous).toEqual([]);
  });

  /** A site with no clear majority does not have one code, and averaging over that would invent one. */
  it('reports a tie rather than picking a side', () => {
    const { codes, ambiguous } = deriveBranchCodes([
      row('0100001', 'موقع ملتبس'),
      row('0200002', 'موقع ملتبس'),
    ]);
    expect(codes.has('موقع ملتبس')).toBe(false);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.counts).toEqual({ '010': 1, '020': 1 });
  });

  it('folds the spelling variants of one site together', () => {
    const { codes } = deriveBranchCodes([row('0300001', 'اسيوط'), row('0300002', 'اسيوط ')]);
    expect(codes.size).toBe(1);
  });

  it('skips rows with no code or no site rather than inventing a mapping', () => {
    const { codes } = deriveBranchCodes([row(null, 'المهندسين'), row('0100004', null)]);
    expect(codes.size).toBe(0);
  });
});
