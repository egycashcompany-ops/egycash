// The loop that revokes a role from everyone must always stop.
//
// The failure this pins is a browser HANG, not a wrong answer: revoked rows leave the list, so the
// natural implementation re-reads the same page and lets the next batch shift up into it — and a
// page whose every row is REFUSED (the last Super Admin, the administrator's own grant) then
// re-reads itself forever. The first version of this code advanced the cursor only when NOTHING had
// been revoked at all, which meant one successful revocation anywhere disarmed the escape.
import { describe, expect, it, vi } from 'vitest';
import { revokeAllAssignments, type RevokeAllPage } from './revoke-all';

/** A server-side list that shrinks as rows are revoked, paginated the way the API paginates. */
const fakeServer = (ids: string[], pageSize: number, unrevokable: string[] = []) => {
  let rows = [...ids];
  const listPage = (page: number): Promise<RevokeAllPage> =>
    Promise.resolve({
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((id) => ({ id })),
      meta: { totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
    });
  const revokeOne = (id: string): Promise<void> => {
    if (unrevokable.includes(id)) return Promise.reject(new Error('refused'));
    rows = rows.filter((row) => row !== id);
    return Promise.resolve();
  };
  return { listPage, revokeOne, remaining: () => rows };
};

describe('revokeAllAssignments', () => {
  it('removes every grant when none is refused', async () => {
    const server = fakeServer(['a', 'b', 'c', 'd', 'e'], 2);
    const result = await revokeAllAssignments(server.listPage, server.revokeOne);
    expect(result).toEqual({ removed: 5, refused: 0 });
    expect(server.remaining()).toEqual([]);
  });

  it('terminates when a whole page is refused, and reports the refusals', async () => {
    // Two refusals in the first page — the shape that used to loop forever.
    const server = fakeServer(['a', 'b', 'c', 'd'], 2, ['a', 'b']);
    const result = await revokeAllAssignments(server.listPage, server.revokeOne);
    expect(result).toEqual({ removed: 2, refused: 2 });
    expect(server.remaining()).toEqual(['a', 'b']);
  });

  it('terminates when EVERY grant is refused', async () => {
    const server = fakeServer(['a', 'b', 'c'], 2, ['a', 'b', 'c']);
    const result = await revokeAllAssignments(server.listPage, server.revokeOne);
    expect(result).toEqual({ removed: 0, refused: 3 });
  });

  it('mixes refusals across pages without re-reading a page it already cleared', async () => {
    const server = fakeServer(['a', 'b', 'c', 'd', 'e', 'f'], 2, ['c']);
    const listPage = vi.fn(server.listPage);
    const result = await revokeAllAssignments(listPage, server.revokeOne);
    expect(result).toEqual({ removed: 5, refused: 1 });
    expect(server.remaining()).toEqual(['c']);
    // A bounded number of reads: one per batch plus the one that finds nothing left.
    expect(listPage.mock.calls.length).toBeLessThan(10);
  });

  it('does nothing, quietly, when nobody holds the role', async () => {
    const server = fakeServer([], 25);
    expect(await revokeAllAssignments(server.listPage, server.revokeOne)).toEqual({
      removed: 0,
      refused: 0,
    });
  });
});
