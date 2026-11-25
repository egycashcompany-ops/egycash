// The module's lifecycle helpers (design §5.16), on a table of their own — no document's — so
// each helper is pinned for what it does, not for one document's rows.
import { describe, expect, it } from 'vitest';
import {
  availableActions,
  findTransition,
  reachableFrom,
  statusesWhere,
  transitionsFrom,
  type TransitionTable,
} from './lifecycle';

type S = 'draft' | 'open' | 'done' | 'void' | 'orphan';
type A = 'create' | 'open' | 'finish' | 'void';

const TABLE: TransitionTable<S, A> = [
  { action: 'create', from: null, to: 'draft', permission: 'x.create' },
  { action: 'open', from: 'draft', to: 'open', permission: 'x.create' },
  { action: 'void', from: 'draft', to: 'void', permission: 'x.void' },
  { action: 'finish', from: 'open', to: 'done', permission: 'x.finish' },
  { action: 'void', from: 'open', to: 'void', permission: 'x.void', requiresReason: true },
];

describe('reading a table', () => {
  it('transitionsFrom: the rows leaving a status, in table order', () => {
    expect(transitionsFrom(TABLE, 'open').map((row) => `${row.action}→${row.to}`)).toEqual([
      'finish→done',
      'void→void',
    ]);
    expect(transitionsFrom(TABLE, 'done')).toEqual([]);
  });

  it('findTransition: the row of one move, the creation row included, or null', () => {
    expect(findTransition(TABLE, 'open', 'void')?.requiresReason).toBe(true);
    expect(findTransition(TABLE, null, 'draft')?.action).toBe('create');
    expect(findTransition(TABLE, 'done', 'open')).toBeNull();
  });

  it('reachableFrom: every status a walk from the start can reach, and no other', () => {
    expect([...reachableFrom(TABLE, 'draft')].sort()).toEqual(['done', 'draft', 'open', 'void']);
    expect([...reachableFrom(TABLE, 'done')]).toEqual(['done']);
  });

  it('statusesWhere: the members of a guard set, in its key order', () => {
    expect(
      statusesWhere({ draft: true, open: false, done: true, void: false, orphan: false }),
    ).toEqual(['draft', 'done']);
    expect(statusesWhere({ draft: false, open: false })).toEqual([]);
  });
});

describe('availableActions', () => {
  const acts = [
    { key: 'edit', from: ['draft'] as S[] },
    { key: 'void', from: ['draft', 'open'] as S[] },
    { key: 'finish', from: ['open'] as S[] },
  ];

  it('asks only about the acts that start at the status, in the acts’ order', () => {
    const asked: string[] = [];
    const listed = availableActions(acts, 'open', (key) => {
      asked.push(key);
      return { permission: `x.${key}`, enabled: true, reason: null };
    });
    expect(asked).toEqual(['void', 'finish']);
    expect(listed.map((act) => act.key)).toEqual(['void', 'finish']);
  });

  it('lists a disabled act with its reason, and leaves out one the judge does not list', () => {
    const listed = availableActions(acts, 'draft', (key) =>
      key === 'edit' ? { permission: 'x.edit', enabled: false, reason: 'notRequester' } : null,
    );
    expect(listed).toEqual([
      { key: 'edit', permission: 'x.edit', enabled: false, reason: 'notRequester' },
    ]);
  });
});
