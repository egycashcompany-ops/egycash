// The paging, which is the whole reason this file exists.
//
// The bug it replaces: one read of `pageSize: 500` against a repository that clamps to 100 returned
// a hundred units and dropped the rest — silently, with a `meta` that said there were more. The
// job-title picker was serving 100 of this deployment's 142 titles, and the employees placement
// filters would have inherited the same hole.
import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { collectOptions, type OptionPage } from './all-options';

interface Row {
  _id: string;
  code: string;
  name: { ar: string; en: string };
  parent: string | null;
}

const catalog = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    _id: `unit-${i}`,
    code: `U-${String(i).padStart(4, '0')}`,
    name: { ar: `وحدة ${i}`, en: `Unit ${i}` },
    parent: i % 2 === 0 ? 'parent-a' : 'parent-b',
  }));

/** Pages exactly the way `BaseRepository.list` does — clamp included — and records every request. */
const reader = (all: Row[]) => {
  const requested: { page: number; pageSize: number }[] = [];
  return {
    requested,
    read: (page: number, pageSize: number): Promise<OptionPage<Row>> => {
      requested.push({ page, pageSize });
      const size = Math.min(pageSize, MAX_PAGE_SIZE);
      const start = (page - 1) * size;
      return Promise.resolve({
        items: all.slice(start, start + size),
        meta: { totalPages: Math.max(1, Math.ceil(all.length / size)) },
      });
    },
  };
};

describe('every unit in the catalog reaches the dropdown', () => {
  it('returns all 142 when a page holds 100', async () => {
    const { read } = reader(catalog(142));
    const options = await collectOptions(read, () => null);
    expect(options).toHaveLength(142);
    expect(options[141]?.id).toBe('unit-141');
  });

  it('never asks for a page larger than the repository would honour', async () => {
    const src = reader(catalog(142));
    await collectOptions(src.read, () => null);
    expect(src.requested.every((r) => r.pageSize <= MAX_PAGE_SIZE)).toBe(true);
  });

  it('walks each page once, in order, and stops at the last', async () => {
    const src = reader(catalog(250));
    await collectOptions(src.read, () => null);
    expect(src.requested.map((r) => r.page)).toEqual([1, 2, 3]);
  });

  it('reads once when everything fits on one page', async () => {
    const src = reader(catalog(7));
    expect(await collectOptions(src.read, () => null)).toHaveLength(7);
    expect(src.requested).toHaveLength(1);
  });

  it('returns nothing, without looping, when the catalog is empty', async () => {
    const src = reader([]);
    expect(await collectOptions(src.read, () => null)).toEqual([]);
    expect(src.requested).toHaveLength(1);
  });

  /** Exactly a page's worth is the off-by-one: 100 units must not provoke a second, empty read. */
  it('does not read a second page when the catalog is exactly one page long', async () => {
    const src = reader(catalog(MAX_PAGE_SIZE));
    expect(await collectOptions(src.read, () => null)).toHaveLength(MAX_PAGE_SIZE);
    expect(src.requested).toHaveLength(1);
  });
});

describe('the parent each option hangs under', () => {
  it('carries it when the unit type declares one', async () => {
    const { read } = reader(catalog(3));
    const options = await collectOptions(read, (d) => d.parent);
    expect(options.map((o) => o.parentId)).toEqual(['parent-a', 'parent-b', 'parent-a']);
  });

  /** Branches and job titles hang under nothing, and say so rather than inventing a parent. */
  it('is null for a unit type that declares none', async () => {
    const { read } = reader(catalog(2));
    expect((await collectOptions(read, () => null)).map((o) => o.parentId)).toEqual([null, null]);
  });

  it('carries the code and both names through unchanged', async () => {
    const { read } = reader(catalog(1));
    expect(await collectOptions(read, () => null)).toEqual([
      { id: 'unit-0', code: 'U-0000', name: { ar: 'وحدة 0', en: 'Unit 0' }, parentId: null },
    ]);
  });
});
