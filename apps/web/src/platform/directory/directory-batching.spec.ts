// The anti-N+1 guarantee, measured.
//
// A page of events written by 8 people must cost ONE request — and it must cost one whether or not
// the page remembered to prefetch its ids, because the rows mount and ask for their authors before
// any page-level prefetch could land. The batching therefore lives in the loader, and these tests
// ask for people the way many rows would, then count the requests that actually went out.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { type DirectoryProfileDto } from '@ecms/contracts';

const calls: string[][] = [];
let failNext = false;

vi.mock('./directory-api', () => ({
  getDirectoryProfile: async () => {
    throw new Error('a row must never fetch its author on its own');
  },
  resolveDirectoryProfiles: async (userIds: string[]): Promise<DirectoryProfileDto[]> => {
    if (failNext) {
      failNext = false;
      throw new Error('directory unreachable');
    }
    calls.push([...userIds]);
    return userIds.map((userId) => ({
      userId,
      displayName: { ar: `اسم ${userId}`, en: `Name ${userId}` },
      avatarFileId: null,
      jobTitle: null,
      department: null,
      branch: null,
      active: true,
      workEmail: null,
    }));
  },
}));

const { directoryKey, primeFromSnapshot, resolveInto } = await import('./directory-queries');

const id = (n: number): string => `64b1f0aaaaaaaaaaaaaa000${n}`;

describe('directory request batching', () => {
  beforeEach(() => {
    calls.length = 0;
    failNext = false;
  });

  it('turns a page of rows into exactly one request', async () => {
    const qc = new QueryClient();
    const ids = Array.from({ length: 8 }, (_, i) => id(i));
    // Eight people asked for separately, the way eight rows would ask.
    await Promise.all(ids.map(async (one) => resolveInto(qc, [one])));

    expect(calls.length).toBe(1);
    expect(calls[0]?.length).toBe(8);
    for (const one of ids) expect(qc.getQueryData(directoryKey(one))).toBeDefined();
  });

  it('asks for a repeated person once, not once per row', async () => {
    const qc = new QueryClient();
    await Promise.all([resolveInto(qc, [id(1)]), resolveInto(qc, [id(1)]), resolveInto(qc, [id(1)])]);

    expect(calls).toEqual([[id(1)]]);
  });

  it('merges a page-level prefetch with the rows it is racing', async () => {
    const qc = new QueryClient();
    await Promise.all([resolveInto(qc, [id(1), id(2), id(3)]), resolveInto(qc, [id(2)]), resolveInto(qc, [id(4)])]);

    expect(calls.length).toBe(1);
    expect([...(calls[0] ?? [])].sort()).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it('never asks again for someone already in the cache', async () => {
    const qc = new QueryClient();
    primeFromSnapshot(qc, {
      userId: id(5),
      displayName: { ar: 'أحمد سالم', en: 'Ahmed Salem' },
      jobTitle: null,
      avatarFileId: null,
      deletedAt: null,
    });

    await resolveInto(qc, [id(5)]);
    expect(calls.length).toBe(0);
  });

  it('keeps the page alive when the directory is unreachable', async () => {
    const qc = new QueryClient();
    failNext = true;
    // Settles rather than throwing into the render tree: a row keeps whatever it already showed.
    await expect(resolveInto(qc, [id(6)])).resolves.toBeUndefined();
    expect(qc.getQueryData(directoryKey(id(6)))).toBeUndefined();
  });
});
