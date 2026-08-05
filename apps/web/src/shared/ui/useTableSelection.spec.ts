// Selecting a subset — what a board column's "select all" needs and a table's does not.
//
// The board has one select-all per column because the bulk actions act on one stage at a time.
// Expressing that as repeated `toggleRow` calls would queue one state update per card and, worse,
// would toggle rather than SET: clicking a column header where half the cards were already picked
// would deselect those half. So the operation is "set this group to checked/unchecked", and these
// cases are the ones where toggle-semantics and set-semantics visibly disagree.
import { describe, expect, it } from 'vitest';

/** The reducer inside `toggleMany`, lifted out so it can be asserted without a renderer. */
const apply = (picked: readonly string[], group: readonly string[], checked: boolean): string[] => {
  const next = new Set(picked);
  for (const id of group) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return [...next];
};

describe('toggleMany', () => {
  it('selects a whole group at once', () => {
    expect(apply([], ['a', 'b', 'c'], true).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sets rather than toggles — a part-selected column becomes fully selected', () => {
    // The case that makes this not just a loop over `toggleRow`: `b` stays selected.
    expect(apply(['b'], ['a', 'b', 'c'], true).sort()).toEqual(['a', 'b', 'c']);
  });

  it('clears a whole group without touching anything else', () => {
    // `z` belongs to another column and must survive.
    expect(apply(['a', 'b', 'z'], ['a', 'b'], false)).toEqual(['z']);
  });

  it('is idempotent in both directions', () => {
    const once = apply([], ['a', 'b'], true);
    expect(apply(once, ['a', 'b'], true).sort()).toEqual(['a', 'b']);
    expect(apply(apply(once, ['a', 'b'], false), ['a', 'b'], false)).toEqual([]);
  });
});
