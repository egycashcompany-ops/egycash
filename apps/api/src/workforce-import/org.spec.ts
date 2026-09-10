// The two pure decisions in the org resolver, both of which reach the database and neither of which
// had a unit test until one of them shipped a bug that only an integration run caught.
import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { deriveBranchCodes, matchBranch, nextFreeCode, readAllForTest } from './org';

/**
 * THE BUG THIS PINS, and it is the second one in this file found only by a real run.
 *
 * The resolver looked a branch up by CODE alone, while `branchService.create` rejects a duplicate
 * NAME. Every database used before the import already holds the sites under codes of its own, so
 * the lookup missed and the create threw `A branch with this name already exists`. The branch was
 * then never cached, so the same failure repeated for EVERY person at that site — one stale branch
 * took its whole workforce down with it.
 *
 * A dry run cannot see any of this: it never calls `create`. That is why this is a pure function
 * with tests rather than a line in the I/O path.
 */
describe('matchBranch finds a branch by code OR by name', () => {
  const ENGINEERS = { _id: 'b1', code: 'BR-001', name: { ar: 'المهندسين' } };
  const NASR = { _id: 'b2', code: '020', name: { ar: 'مدينة نصر' } };

  it('matches on the code when the code is there', () => {
    expect(matchBranch([ENGINEERS, NASR], '020', 'مدينة نصر')).toEqual({ id: 'b2', mismatch: null });
  });

  /** The failing case: the name exists, the sheet's code does not. */
  it('falls back to the name, and reports the code it disagrees with', () => {
    const match = matchBranch([ENGINEERS, NASR], '010', 'المهندسين');
    expect(match?.id).toBe('b1');
    expect(match?.mismatch).toEqual({ name: 'المهندسين', existingCode: 'BR-001' });
  });

  /**
   * The existing branch's code is REPORTED, never returned as something to write: the Branch Code
   * is a super-admin's to change, not an import's, and employee codes come from the sheet anyway.
   */
  it('never proposes rewriting the existing code', () => {
    const match = matchBranch([ENGINEERS], '010', 'المهندسين');
    expect(match).not.toHaveProperty('code');
    expect(Object.keys(match ?? {}).sort()).toEqual(['id', 'mismatch']);
  });

  it('prefers the code match even when another branch shares the folded name', () => {
    const renamed = { _id: 'b3', code: '010', name: { ar: 'فرع آخر' } };
    expect(matchBranch([ENGINEERS, renamed], '010', 'المهندسين')?.id).toBe('b3');
  });

  it('returns null when the branch is genuinely new, so the caller creates it', () => {
    expect(matchBranch([ENGINEERS], '030', 'طنطا')).toBeNull();
  });

  it('matches nothing against an empty catalogue', () => {
    expect(matchBranch([], '010', 'المهندسين')).toBeNull();
  });
});

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

/**
 * The catalogue read, which is where an upload quietly broke.
 *
 * `BaseRepository.list` clamps `pageSize` to `MAX_PAGE_SIZE` (100). The resolver used to ask for
 * 500 or 1000 in one go and take what came back, so a department, section or job title past the
 * hundredth read as ABSENT — and the resolver's answer to absent is to CREATE it, minting a code
 * from the hundred it could see, which lands on a code that already exists and fails the unique
 * index. The person being placed then fails outright.
 *
 * It bit on a LATER upload rather than the first: within one run every unit the resolver touches is
 * cached, so the go-live import built the catalogues from empty and never noticed. The first
 * re-upload afterwards failed for everybody whose section was past the hundredth row.
 */
describe('reading a catalogue that is longer than one page', () => {
  const unit = (i: number) => ({ _id: `id-${i}`, code: `SEC-${String(i).padStart(4, '0')}` });

  /** Pages exactly the way `BaseRepository.list` does — clamp included. */
  const catalogue = (total: number) => {
    const asked: number[] = [];
    return {
      asked,
      read: (page: number, pageSize: number) => {
        asked.push(pageSize);
        const size = Math.min(pageSize, MAX_PAGE_SIZE);
        const start = (page - 1) * size;
        return Promise.resolve({
          items: Array.from({ length: total }, (_, i) => unit(i + 1)).slice(start, start + size),
          meta: { totalPages: Math.max(1, Math.ceil(total / size)) },
        });
      },
    };
  };

  it('returns all 142 when a page holds 100', async () => {
    const src = catalogue(142);
    const items = await readAllForTest(src.read);
    expect(items).toHaveLength(142);
    expect(items[141]?.code).toBe('SEC-0142');
  });

  it('never asks for a page bigger than the repository would honour', async () => {
    const src = catalogue(142);
    await readAllForTest(src.read);
    expect(src.asked.every((size) => size <= MAX_PAGE_SIZE)).toBe(true);
  });

  it('stops at the last page instead of reading forever', async () => {
    const src = catalogue(142);
    await readAllForTest(src.read);
    expect(src.asked).toHaveLength(2);
  });

  it('does not read a second page when the catalogue is exactly one page long', async () => {
    const src = catalogue(MAX_PAGE_SIZE);
    expect(await readAllForTest(src.read)).toHaveLength(MAX_PAGE_SIZE);
    expect(src.asked).toHaveLength(1);
  });

  it('reads one page, and returns nothing, for an empty catalogue', async () => {
    const src = catalogue(0);
    expect(await readAllForTest(src.read)).toEqual([]);
    expect(src.asked).toHaveLength(1);
  });

  /**
   * THE ONE THE OUTAGE TURNED ON. The next free code has to be computed from the WHOLE catalogue:
   * from the first hundred alone it lands on a code the 101st already holds, and the create fails
   * the unique index.
   */
  it('mints a code past the whole catalogue, not past the first page of it', async () => {
    const src = catalogue(142);
    const items = await readAllForTest(src.read);
    expect(nextFreeCode('SEC', items.map((u) => u.code))).toBe('SEC-0143');
    // What the clamped read would have produced, and why it collided.
    const firstPage = items.slice(0, MAX_PAGE_SIZE).map((u) => u.code);
    expect(nextFreeCode('SEC', firstPage)).toBe('SEC-0101');
  });
});
