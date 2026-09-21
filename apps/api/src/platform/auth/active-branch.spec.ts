// The switcher's ceiling for an account whose grants reach several branches.
//
// The rule is the one the organization-wide case already obeys — the header can only NARROW — with
// the reach standing in for "the whole company". A branch outside it is dropped, leaving the view
// the caller would have had anyway, before any branch list is consulted: the check is on the reach
// alone, which is why it needs no database to prove.
//
// The header carries a LIST because the screens do not change from one site to the next, only the
// rows do — so somebody who looks after three branches is comparing them, and one-at-a-time makes
// him do the comparing in his head. One id is a list of one, which is what every older client
// sends, so nothing about that case changed.
import { describe, expect, it } from 'vitest';
import { resolveActiveBranches, selectableBranches, singleActiveBranch } from './active-branch';

const A = '650000000000000000000010';
const B = '650000000000000000000011';
const C = '650000000000000000000012';

describe('narrowing within a multi-branch reach', () => {
  it('drops a branch outside the reach before looking anything up', async () => {
    expect(await resolveActiveBranches(A, [B])).toEqual([]);
  });

  it('keeps the branches inside the reach and drops only the ones outside it', () => {
    // Dropping rather than refusing the whole header: a stale id left in a browser after a grant
    // was narrowed must not take the branches beside it down with it. Asserted on the pure half,
    // which is where the ceiling is decided — what follows it only asks whether a branch exists.
    expect(selectableBranches(`${A},${C}`, [A, B])).toEqual([A]);
  });

  it('still treats "all" and nothing as the unnarrowed view', async () => {
    expect(await resolveActiveBranches('all', [A, B])).toEqual([]);
    expect(await resolveActiveBranches(undefined, [A, B])).toEqual([]);
    expect(await resolveActiveBranches('', [A, B])).toEqual([]);
  });

  it('drops a value that is not an id at all, reach or no reach', async () => {
    expect(await resolveActiveBranches('not-an-id', [A])).toEqual([]);
    expect(await resolveActiveBranches('not-an-id')).toEqual([]);
  });

  it('ignores whitespace and repeats, which a hand-built header carries', () => {
    expect(selectableBranches(` ${A} , ${A} ,, ${B} `, [A, B])).toEqual([A, B]);
  });

  it('caps how many one header may name — past that it is probing, not comparing', () => {
    const many = Array.from({ length: 80 }, (_, i) => `6500000000000000000000${String(i).padStart(2, '0')}`);
    expect(selectableBranches(many.join(','), many)).toHaveLength(50);
  });
});

describe('the single branch a new document is filed into', () => {
  it('is the one chosen, when exactly one is', () => {
    expect(singleActiveBranch([A])).toBe(A);
  });

  // The question «which branch does this new document belong to» has one answer or none. A caller
  // comparing three sites has not answered it, so he falls through to his placement exactly as a
  // caller who chose nothing does — rather than having one of the three picked for him.
  it('is nothing at all when several are, and when none is', () => {
    expect(singleActiveBranch([A, B])).toBeNull();
    expect(singleActiveBranch([])).toBeNull();
  });
});
