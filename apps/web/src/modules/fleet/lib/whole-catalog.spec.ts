// A catalog past a hundred entries used to be cut, and cut quietly.
//
// One cache entry feeds both the dropdowns and the id → name maps the list pages build, so an
// entry off the end was missing from the pickers AND rendered as a blank cell in the tables.
// Neither looks like a fault, which is why this is pinned by arithmetic rather than by eye.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { MAX_CATALOG_PAGES, catalogPageCount, fetchWholeCatalog } from './whole-catalog';

interface Item {
  id: string;
}

/** A server holding `total` catalog entries, answering one page at a time. */
const server = (total: number): ((page: number, pageSize: number) => Promise<Paginated<Item>>) => {
  const all: Item[] = Array.from({ length: total }, (_unused, i) => ({ id: `c${i + 1}` }));
  return async (page, pageSize) => ({
    items: all.slice((page - 1) * pageSize, page * pageSize),
    meta: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
};

describe('how many pages a catalog has', () => {
  it('takes the server′s own answer', () => {
    expect(catalogPageCount({ page: 1, pageSize: 100, totalItems: 250, totalPages: 3 })).toBe(3);
  });

  it('is none before any answer has arrived', () => {
    expect(catalogPageCount(undefined)).toBe(0);
  });

  it('is none when the server reports none, whatever it says about totals', () => {
    expect(catalogPageCount({ page: 1, pageSize: 100, totalItems: 7, totalPages: 0 })).toBe(0);
  });
});

describe('reading a catalog whole', () => {
  it('reads a small one in a single request', async () => {
    const fetchPage = vi.fn(server(12));
    const got = await fetchWholeCatalog(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(got.items).toHaveLength(12);
  });

  it('READS EVERY ENTRY PAST THE HUNDREDTH — the defect, in one test', async () => {
    // 250 spare parts. The old hook asked for `pageSize: 100` and stopped, so the last 150 were
    // absent from the picker and rendered blank wherever a row pointed at one.
    const fetchPage = vi.fn(server(250));
    const got = await fetchWholeCatalog(fetchPage);
    expect(got.items).toHaveLength(250);
    expect(got.items.at(-1)?.id).toBe('c250');
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('keeps the entries in the order the server sent them', async () => {
    const got = await fetchWholeCatalog(server(205));
    expect(got.items.map((item) => item.id).slice(0, 3)).toEqual(['c1', 'c2', 'c3']);
    expect(got.items.map((item) => item.id).slice(-2)).toEqual(['c204', 'c205']);
  });

  it('does not fetch an extra empty page on an exact multiple', async () => {
    // The screens mount three or four catalogs at once; a wasted request each is a wasted round
    // trip on every one of them.
    const fetchPage = vi.fn(server(MAX_PAGE_SIZE * 2));
    await fetchWholeCatalog(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('asks for full pages, never smaller ones', async () => {
    const fetchPage = vi.fn(server(250));
    await fetchWholeCatalog(fetchPage);
    for (const [, pageSize] of fetchPage.mock.calls) expect(pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('handles an empty catalog without asking twice', async () => {
    const fetchPage = vi.fn(server(0));
    const got = await fetchWholeCatalog(fetchPage);
    expect(got.items).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('refuses to loop forever on a server reporting nonsense', async () => {
    // Not a page cap — a bound on requests, so a bad `totalPages` cannot turn a dropdown into an
    // unbounded loop.
    const fetchPage = vi.fn(async (page: number, pageSize: number) => ({
      items: [{ id: `c${page}` }],
      meta: { page, pageSize, totalItems: 999_999, totalPages: 10_000 },
    }));
    await fetchWholeCatalog(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_CATALOG_PAGES);
  });
});

// ── the wiring, which the arithmetic above cannot see ────────────────────────
//
// `apps/web` runs without a DOM: the hook's arguments exist only inside a render that cannot
// happen here. What is checkable is that the ONE hook every catalog consumer goes through reaches
// for this loop instead of naming a page size — and a page size written there is exactly how the
// cut came back.
describe('the catalog hook reads through this loop', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../api/fleet-queries.ts');
  const source = readFileSync(SRC, 'utf8');
  const code = source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
  const hook = code.slice(
    code.indexOf('export const useFleetCatalog'),
    code.indexOf('export const useCatalogItems'),
  );

  it('exists to be read', () => {
    expect(hook.length).toBeGreaterThan(50);
  });

  it('gathers every page rather than asking for one', () => {
    expect(hook, 'useFleetCatalog must read the whole catalog').toContain('fetchWholeCatalog');
  });

  it('names no page size of its own — that is the loop′s to decide', () => {
    // `pageSize: 100` here was the defect: the server's cap written down as if it were a choice.
    expect(hook).not.toMatch(/pageSize:\s*\d+/);
  });
});
