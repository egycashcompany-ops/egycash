// The rules of a copy alongside, without a database: what a holder gains (only beside a key it
// already holds, never a key twice, never one taken away), which roles take part (not the two the
// catalog sync owns, not the HR-only derivatives the reconciliation owns), what an unregistered key
// does to the run, and what the trail records — the role editor's row and the delegation write's.
// The writes themselves are proved against a real mongo in
// `tests/integration/it-go-live-screen-grants.spec.ts`.
import { describe, expect, it } from 'vitest';
import {
  ROLES_NEVER_COPIED_INTO,
  alongsideFromKeys,
  delegationCopyAuditChanges,
  keysAdded,
  keysGainedAlongside,
  roleCopyAuditChanges,
  roleTakesGrantsAlongside,
  unregisteredAlongsideKeys,
  type DelegatedGrantsCopied,
  type GrantAlongsidePair,
} from './grant-alongside';

const PAIRS: readonly GrantAlongsidePair[] = [
  { from: 'a.view', add: ['b.view', 'c.view'] },
  { from: 'a.edit', add: ['b.edit', 'c.edit'] },
  { from: 'a.secret', add: ['c.secret'] },
];

describe('what a holder gains', () => {
  it('gains the keys of every pair whose `from` it holds, sorted, and names those `from` keys', () => {
    expect(keysGainedAlongside(['a.view', 'a.edit', 'z.other'], PAIRS)).toEqual({
      add: ['b.edit', 'b.view', 'c.edit', 'c.view'],
      because: ['a.edit', 'a.view'],
    });
  });

  it('gains nothing without a `from` key', () => {
    expect(keysGainedAlongside(['z.other', 'b.view'], PAIRS)).toEqual({ add: [], because: [] });
    expect(keysGainedAlongside([], PAIRS)).toEqual({ add: [], because: [] });
  });

  it('is not given a key it already holds — and a pair it fully holds is not named as a reason', () => {
    expect(keysGainedAlongside(['a.view', 'b.view', 'a.secret', 'c.secret'], PAIRS)).toEqual({
      add: ['c.view'],
      because: ['a.view'],
    });
    expect(keysGainedAlongside(['a.view', 'b.view', 'c.view'], PAIRS)).toEqual({
      add: [],
      because: [],
    });
  });

  it('never yields a key twice when two pairs add the same one', () => {
    const overlapping: GrantAlongsidePair[] = [
      { from: 'a.view', add: ['b.view'] },
      { from: 'a.edit', add: ['b.view', 'b.edit'] },
    ];
    expect(keysGainedAlongside(['a.view', 'a.edit'], overlapping)).toEqual({
      add: ['b.edit', 'b.view'],
      because: ['a.edit', 'a.view'],
    });
  });

  it('names each `from` key once, for the candidates read', () => {
    expect(alongsideFromKeys([...PAIRS, { from: 'a.view', add: ['d.view'] }])).toEqual([
      'a.view',
      'a.edit',
      'a.secret',
    ]);
  });
});

describe('which roles take part', () => {
  it('leaves super-admin and platform-admin to the catalog sync', () => {
    expect(ROLES_NEVER_COPIED_INTO).toEqual(['super-admin', 'platform-admin']);
    expect(roleTakesGrantsAlongside({ key: 'super-admin' })).toBe(false);
    expect(roleTakesGrantsAlongside({ key: 'platform-admin' })).toBe(false);
  });

  it('leaves the HR-only derivatives to the reconciliation that owns them (ADR-026 §4)', () => {
    expect(roleTakesGrantsAlongside({ key: 'hr-only:650000000000000000000001' })).toBe(false);
  });

  it('takes an administrator’s role, and any other keyed role', () => {
    expect(roleTakesGrantsAlongside({ key: null })).toBe(true);
    expect(roleTakesGrantsAlongside({ key: 'employee-self-service' })).toBe(true);
  });
});

describe('an unregistered key refuses the run', () => {
  it('names every `add` key the registry does not know, once, sorted', () => {
    const registered = new Set(['b.view', 'b.edit']);
    expect(
      unregisteredAlongsideKeys([...PAIRS, { from: 'a.view', add: ['c.view'] }], (key) =>
        registered.has(key),
      ),
    ).toEqual(['c.edit', 'c.secret', 'c.view']);
  });

  it('does not ask after the `from` keys — a retired key may still sit in a role', () => {
    expect(unregisteredAlongsideKeys(PAIRS, (key) => !key.startsWith('a.'))).toEqual([]);
  });
});

describe('what the trail records', () => {
  it('a role: its `permissionKeys` before and after, as `updateRole` records an edit', () => {
    expect(
      roleCopyAuditChanges({
        roleId: 'r1',
        name: { ar: 'دعم', en: 'Support' },
        before: ['a.view', 'z.other'],
        after: ['a.view', 'z.other', 'b.view', 'c.view'],
      }),
    ).toEqual([
      {
        field: 'permissionKeys',
        old: ['a.view', 'z.other'],
        new: ['a.view', 'z.other', 'b.view', 'c.view'],
      },
    ]);
  });

  const grant = (over: Partial<DelegatedGrantsCopied> = {}): DelegatedGrantsCopied => ({
    grantId: 'g1',
    userId: 'u1',
    branchId: 'b1',
    departmentId: null,
    departmentCatalogId: null,
    before: ['a.view', 'z.other'],
    after: ['a.view', 'z.other', 'c.view', 'b.view'],
    ...over,
  });

  it('a delegated grant: the keys sorted and joined, and its unit — as the delegation write does', () => {
    expect(delegationCopyAuditChanges(grant())).toEqual([
      { field: 'delegation', old: 'a.view, z.other', new: 'a.view, b.view, c.view, z.other' },
      { field: 'branch', old: null, new: 'b1' },
      { field: 'department', old: null, new: 'whole-branch' },
    ]);
    expect(delegationCopyAuditChanges(grant({ departmentId: 'd1' }))[2]).toEqual({
      field: 'department',
      old: null,
      new: 'd1',
    });
  });

  it('a grant over one department in every branch names that department', () => {
    expect(
      delegationCopyAuditChanges(grant({ branchId: null, departmentCatalogId: 'cat1' })).slice(1),
    ).toEqual([
      { field: 'branch', old: null, new: null },
      { field: 'department', old: null, new: 'every-branch:cat1' },
    ]);
  });

  it('what was added, for the caller’s record', () => {
    expect(keysAdded(['a.view', 'z.other'], ['a.view', 'z.other', 'c.view', 'b.view'])).toEqual([
      'b.view',
      'c.view',
    ]);
    expect(keysAdded(['a.view'], ['a.view'])).toEqual([]);
  });
});
