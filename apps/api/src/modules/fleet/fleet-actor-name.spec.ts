// «بواسطة»: one way to name the person behind a fleet record — first and last name in Arabic, and
// nothing (never an id, never a blank) when there is no such person or no such name.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const users = vi.hoisted(() => new Map<string, unknown>());
const findByIdSystem = vi.hoisted(() =>
  vi.fn(async (id: string) => (users.get(id) ?? null) as unknown),
);
vi.mock('../../platform/users', () => ({ userService: { findByIdSystem } }));

import { actorNameOf, actorNamesOf } from './fleet-actor-name';

const user = (first: string, last: string) => ({
  profile: { firstName: { ar: first, en: 'x' }, lastName: { ar: last, en: 'y' } },
});
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const D = 'd'.repeat(24);

beforeEach(() => {
  users.clear();
  findByIdSystem.mockClear();
  users.set(A, user('  أحمد ', 'سامي '));
  users.set(B, user('منى', ''));
  users.set(C, user(' ', ' '));
});

describe('actorNameOf', () => {
  it('names the user by Arabic first and last name, trimmed', async () => {
    await expect(actorNameOf(A)).resolves.toBe('أحمد سامي');
    await expect(actorNameOf(B)).resolves.toBe('منى');
  });

  it('is null for a blank name, an unknown user, and no id at all', async () => {
    await expect(actorNameOf(C)).resolves.toBeNull();
    await expect(actorNameOf(D)).resolves.toBeNull();
    await expect(actorNameOf(null)).resolves.toBeNull();
    await expect(actorNameOf(undefined)).resolves.toBeNull();
    await expect(actorNameOf('  ')).resolves.toBeNull();
    // Nothing to look up is never looked up.
    expect(findByIdSystem).toHaveBeenCalledTimes(2);
  });
});

describe('actorNamesOf', () => {
  it('looks each distinct id up once and maps only those with a name', async () => {
    const names = await actorNamesOf([A, B, A, C, D, null, undefined, '', B]);
    expect([...names.entries()]).toEqual([
      [A, 'أحمد سامي'],
      [B, 'منى'],
    ]);
    expect(findByIdSystem).toHaveBeenCalledTimes(4);
    expect(findByIdSystem.mock.calls.map(([id]) => id)).toEqual([A, B, C, D]);
  });

  it('asks nothing for no ids', async () => {
    await expect(actorNamesOf([])).resolves.toEqual(new Map());
    expect(findByIdSystem).not.toHaveBeenCalled();
  });
});
