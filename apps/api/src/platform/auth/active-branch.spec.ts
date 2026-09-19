// The switcher's ceiling for an account whose grants reach several branches.
//
// The rule is the one the organization-wide case already obeys — the header can only NARROW — with
// the reach standing in for "the whole company". A branch outside it resolves to null, the view the
// caller would have had anyway, before any branch list is consulted: the check is on the reach
// alone, which is why it needs no database to prove.
import { describe, expect, it } from 'vitest';
import { resolveActiveBranch } from './active-branch';

const A = '650000000000000000000010';
const B = '650000000000000000000011';

describe('narrowing within a multi-branch reach', () => {
  it('refuses a branch outside the reach before looking anything up', async () => {
    expect(await resolveActiveBranch(A, [B])).toBeNull();
  });

  it('still treats "all" and nothing as the unnarrowed view', async () => {
    expect(await resolveActiveBranch('all', [A, B])).toBeNull();
    expect(await resolveActiveBranch(undefined, [A, B])).toBeNull();
    expect(await resolveActiveBranch('', [A, B])).toBeNull();
  });

  it('refuses a value that is not an id at all, reach or no reach', async () => {
    expect(await resolveActiveBranch('not-an-id', [A])).toBeNull();
    expect(await resolveActiveBranch('not-an-id')).toBeNull();
  });
});
