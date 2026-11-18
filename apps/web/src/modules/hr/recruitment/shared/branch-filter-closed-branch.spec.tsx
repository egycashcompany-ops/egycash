// The shared branch filter names a closed branch the address already picked (fleet audit D14).
//
// A dashboard «فتح» or a remembered filter can carry a branch that has been closed since: its cars
// keep it, so the list they open is right. The filter OFFERS the active branches only, and so drew
// that pick as its raw id. It now names it from the every-branch list, and says «—» for an id no
// list holds any more — the same rule the vehicles and drivers screens use to name a branch.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { optionLabel, selectionSummary } from '../../../../shared/ui/MultiSelect';
import { branchFilterOptions } from './BranchFilterSelect';

const OPEN = { id: 'b-open', name: { ar: 'فرع القاهرة', en: 'Cairo' } };
const CLOSED = { id: 'b-closed', name: { ar: 'فرع المنيا', en: 'Minya' } };

describe('the branch filter names a closed branch picked from the address (D14)', () => {
  it('names the closed pick from the every-branch list, never its id', () => {
    const options = branchFilterOptions([OPEN], [OPEN, CLOSED], [CLOSED.id], 'ar');
    expect(optionLabel(options, CLOSED.id)).toBe('فرع المنيا');
    expect(selectionSummary(options, [CLOSED.id], 2)).toBe('فرع المنيا');
    expect(branchFilterOptions([OPEN], [OPEN, CLOSED], [CLOSED.id], 'en').at(-1)?.label).toBe(
      'Minya',
    );
  });

  it('writes «—» for an id no list holds any more (a deleted branch)', () => {
    const options = branchFilterOptions([OPEN], [OPEN, CLOSED], ['b-gone'], 'ar');
    expect(optionLabel(options, 'b-gone')).toBe('—');
  });

  it('still OFFERS the active branches only: a closed branch nobody picked is not on the list', () => {
    expect(branchFilterOptions([OPEN], [OPEN, CLOSED], [], 'ar')).toEqual([
      { value: OPEN.id, label: 'فرع القاهرة' },
    ]);
    // An active pick is named from the active list, once.
    expect(branchFilterOptions([OPEN], [OPEN, CLOSED], [OPEN.id], 'ar')).toEqual([
      { value: OPEN.id, label: 'فرع القاهرة' },
    ]);
  });

  it('reads the every-branch list only while a pick is off the LOADED active one', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'BranchFilterSelect.tsx'),
      'utf8',
    );
    expect(src).toContain('useBranchNames(closedPicked)');
    // While the active list is on its way every pick would look closed: no every-branch read, and
    // no «—» drawn for an active branch for a moment — the options are the active list alone.
    expect(src).toContain(
      'const closedPicked = active.isSuccess && value.some((id) => !branches.some((b) => b.id === id));',
    );
    expect(src).toContain(
      'branchFilterOptions(branches, names, active.isSuccess ? value : [], locale)',
    );
  });

  it('before the active list lands, an active pick is never drawn as «—»', () => {
    // What the control builds while loading: no active branches yet, no pick looked up.
    expect(branchFilterOptions([], [], [], 'ar')).toEqual([]);
    expect(optionLabel(branchFilterOptions([], [], [], 'ar'), OPEN.id)).not.toBe('—');
  });
});
