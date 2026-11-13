// The open board read whole (GET /atm/replenishments/board, /atm/maintenances/board) — what made
// the board cheap, pinned where it is decided:
//
//   · ONE `find`, lean, in the paged list's order (area descending, `_id` closing it), cut one row
//     past the cap — and NO count unless the cap is hit, when exactly one counts the rest;
//   · the paged list's filters and scope, unchanged: open, live rows, a bank or area resolved to
//     its stored spellings first, the caller's branch scope kept;
//   · the names those spellings — and the dropdowns — come from are ONE projected read of the open
//     rows in the board order, never a `distinct`: a `distinct` names no key of `ix_open_board`,
//     so for an organization-wide caller it scanned the whole log;
//   · `ix_open_board` — the partial index an organization-wide caller (no branch to lead
//     `ix_branch_open_area` with) reads the board through — declared on both logs in the board
//     order, and in the boot index step's plan, which is what builds it in production (autoIndex is
//     off there, and the pre-deploy sync only reports).
//   · `ix_branch_open_board` — the same rows and order led by the branch, for the branch readers
//     (most ATM staff): a branch is one range of it already sorted, `_id` included.
//
// Every name and id below is synthetic.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATM_OPEN_BOARD_MAX_ROWS } from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { atmIndexBuildPlan, atmIndexedModels } from '../atm-indexes';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import { atmReplenishmentRepository } from '../replenishments/replenishment.repository';
import { AtmMaintenanceModel } from '../maintenances/maintenance.model';
import { atmMaintenanceRepository } from '../maintenances/maintenance.repository';
import {
  BRANCH_OPEN_BOARD_INDEX_NAME,
  OPEN_BOARD_INDEX_NAME,
  OPEN_BOARD_ORDER,
} from './open-board-index';
import { distinctOf, type OpenNames } from './operation-log.repository';

const BRANCH = '650000000000000000000104';
const USER = '650000000000000000000201';

const rows = (n: number) =>
  Array.from({ length: n }, (_unused, i) => ({
    _id: new Types.ObjectId(),
    area: `SYN ${String(i)}`,
  }));

type Model = typeof AtmReplenishmentModel | typeof AtmMaintenanceModel;

interface Read {
  filter?: unknown;
  select?: unknown;
  sort?: unknown;
  limit?: number;
  lean: boolean;
}

/**
 * The model's `find(filter)[.select(p)].sort(s)[.limit(n)].lean().exec()`, recorded call by call.
 * A projected read (the names) answers `names`; the board read answers `board`, cut by its limit
 * as the server would.
 */
const serves = (model: Model, board: unknown[], names: OpenNames[] = []) => {
  const calls: Read[] = [];
  const find = vi.spyOn(model, 'find').mockImplementation(((filter: unknown) => {
    const seen: Read = { filter, lean: false };
    calls.push(seen);
    const chain = {
      select: (select: unknown) => {
        seen.select = select;
        return chain;
      },
      sort: (sort: unknown) => {
        seen.sort = sort;
        return chain;
      },
      limit: (limit: number) => {
        seen.limit = limit;
        return chain;
      },
      lean: () => {
        seen.lean = true;
        return chain;
      },
      exec: async () =>
        seen.select === undefined ? board.slice(0, seen.limit ?? board.length) : names,
    };
    return chain;
  }) as never);
  const count = vi
    .spyOn(model, 'countDocuments')
    .mockImplementation((() => ({ exec: async () => board.length })) as never);
  const distinct = vi.spyOn(model, 'distinct');
  return { calls, find, count, distinct };
};

afterEach(() => {
  vi.restoreAllMocks();
});

const placed = { userId: USER, branchId: BRANCH, departmentId: null, sectionId: null };
const organization: ScopeSelector = { scope: 'organization', ...placed };
const branch: ScopeSelector = { scope: 'branch', ...placed };

/** The open rows' names, two spellings of one bank and one area among them. */
const NAMES: OpenNames[] = [
  { bankName: 'SYN QNB', area: 'SYN Agami' },
  { bankName: 'SYN QNB ', area: 'SYN Agami ' },
  { bankName: 'SYN NBE', area: 'SYN Smouha' },
  { bankName: 'SYN NBE', area: 'SYN Miami' },
  { bankName: 'SYN CIB', area: 'SYN Miami' },
];

describe.each([
  ['replenishment', AtmReplenishmentModel, atmReplenishmentRepository],
  ['maintenance', AtmMaintenanceModel, atmMaintenanceRepository],
] as const)('the %s board read', (_kind, model, repository) => {
  it('is one find in the board order, lean, cut one past the cap — and counts nothing', async () => {
    const { calls, find, count } = serves(model, rows(130));
    const board = await repository.listOpenBoard({ scope: organization });
    expect(find).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    const [read] = calls;
    expect(read?.sort).toEqual({ area: -1, _id: -1 });
    expect(read?.sort).toEqual(OPEN_BOARD_ORDER);
    expect(read?.limit).toBe(ATM_OPEN_BOARD_MAX_ROWS + 1);
    expect(read?.lean).toBe(true);
    expect(board.items).toHaveLength(130);
    expect(board).toMatchObject({ truncated: false, totalItems: 130 });
  });

  it('reads the open, live rows — exactly the predicate the partial index holds', async () => {
    const { calls } = serves(model, []);
    await repository.listOpenBoard({ scope: organization });
    // Organization-wide: no branch narrowing, so the whole open set of the company.
    expect(calls[0]?.filter).toEqual({ $and: [{ isDeleted: false }, { closedAt: null }] });
  });

  it('keeps the caller’s branch scope', async () => {
    const { calls } = serves(model, []);
    await repository.listOpenBoard({ scope: branch });
    expect(JSON.stringify(calls[0]?.filter)).toContain(BRANCH);
    expect(JSON.stringify(calls[0]?.filter)).toContain('"closedAt":null');
  });

  it('resolves a bank and an area to their stored spellings from ONE names read', async () => {
    const { calls, distinct } = serves(model, [], NAMES);
    await repository.listOpenBoard({
      scope: organization,
      banks: ['SYN QNB'],
      areas: ['SYN Agami'],
    });
    expect(distinct).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    const [names, board] = calls;
    // The names: the open rows in scope, projected, in the board order — what `ix_open_board` holds.
    expect(names?.filter).toEqual({ $and: [{ isDeleted: false }, { closedAt: null }] });
    expect(names?.select).toEqual({ bankName: 1, area: 1 });
    expect(names?.sort).toEqual(OPEN_BOARD_ORDER);
    expect(board?.filter).toEqual({
      $and: [
        { isDeleted: false },
        {
          closedAt: null,
          bankName: { $in: ['SYN QNB', 'SYN QNB '] },
          area: { $in: ['SYN Agami', 'SYN Agami '] },
        },
      ],
    });
  });

  it('an unfiltered board reads no names at all', async () => {
    const { calls } = serves(model, rows(3), NAMES);
    await repository.listOpenBoard({ scope: organization, banks: [], areas: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.select).toBeUndefined();
  });

  it('a board past the cap is cut there, says so, and is counted once', async () => {
    const { find, count } = serves(model, rows(12));
    const board = await repository.listOpenBoard({ scope: organization }, 10);
    expect(find).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    expect(board.items).toHaveLength(10);
    expect(board).toMatchObject({ truncated: true, totalItems: 12 });
  });

  it('a board exactly at the cap is whole, and not counted', async () => {
    const { count } = serves(model, rows(10));
    const board = await repository.listOpenBoard({ scope: organization }, 10);
    expect(count).not.toHaveBeenCalled();
    expect(board).toMatchObject({ truncated: false, totalItems: 10 });
  });

  it('the dropdowns come from the same one read — every bank, and the chosen banks’ areas', async () => {
    const { calls, distinct } = serves(model, [], NAMES);
    expect(await repository.facets(organization, [])).toEqual({
      banks: ['SYN CIB', 'SYN NBE', 'SYN QNB'],
      areas: ['SYN Agami', 'SYN Miami', 'SYN Smouha'],
    });
    // A chosen bank narrows the areas through every stored spelling of it; the banks stay whole.
    expect(await repository.facets(organization, ['SYN QNB'])).toEqual({
      banks: ['SYN CIB', 'SYN NBE', 'SYN QNB'],
      areas: ['SYN Agami'],
    });
    expect(await repository.facets(organization, ['SYN NBE', 'SYN CIB'])).toEqual({
      banks: ['SYN CIB', 'SYN NBE', 'SYN QNB'],
      areas: ['SYN Miami', 'SYN Smouha'],
    });
    // A chosen bank nothing open carries offers no area.
    expect((await repository.facets(organization, ['SYN GONE'])).areas).toEqual([]);
    expect(distinct).not.toHaveBeenCalled();
    expect(calls).toHaveLength(4);
    expect(
      calls.every((read) => JSON.stringify(read.sort) === JSON.stringify(OPEN_BOARD_ORDER)),
    ).toBe(true);
  });
});

describe('distinctOf', () => {
  it('lists each stored value once, spellings kept apart, in first-seen order', () => {
    expect(distinctOf(NAMES, 'bankName')).toEqual(['SYN QNB', 'SYN QNB ', 'SYN NBE', 'SYN CIB']);
    expect(distinctOf(NAMES, 'area')).toEqual([
      'SYN Agami',
      'SYN Agami ',
      'SYN Smouha',
      'SYN Miami',
    ]);
  });

  it('skips a row that carries no such field, as `distinct` did', () => {
    const odd = [{ bankName: 'SYN NBE' } as OpenNames, ...NAMES.slice(0, 1)];
    expect(distinctOf(odd, 'area')).toEqual(['SYN Agami']);
  });
});

describe('ix_open_board — the index the board is read through', () => {
  it.each([
    ['replenishment', AtmReplenishmentModel],
    ['maintenance', AtmMaintenanceModel],
  ] as const)('%s: declared in the board order, partial on the open live rows', (_kind, model) => {
    const plan = atmIndexBuildPlan(model.schema.indexes());
    const entry = plan.find((item) => item.options['name'] === OPEN_BOARD_INDEX_NAME);
    expect(OPEN_BOARD_INDEX_NAME).toBe('ix_open_board');
    expect(entry?.keys).toEqual({ area: -1, _id: -1 });
    expect(entry?.keys).toEqual(OPEN_BOARD_ORDER);
    expect(entry?.unique).toBe(false);
    expect(entry?.options['partialFilterExpression']).toEqual({
      closedAt: null,
      isDeleted: false,
    });
  });

  it('is built in production by the boot index step — both logs are on its list', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry]));
    for (const collection of ['atm_replenishments', 'atm_maintenances']) {
      const entry = listed.get(collection);
      expect(entry, collection).toBeDefined();
      const plan = atmIndexBuildPlan(entry?.model.schema.indexes() ?? []);
      expect(
        plan.map((item) => item.options['name']),
        collection,
      ).toContain(OPEN_BOARD_INDEX_NAME);
      // Never one of the names the step drops.
      expect(entry?.retired ?? [], collection).not.toContain(OPEN_BOARD_INDEX_NAME);
    }
  });

  it.each([
    ['replenishment', AtmReplenishmentModel],
    ['maintenance', AtmMaintenanceModel],
  ] as const)(
    '%s: a branch reader has its own — the branch, then the board order, same rows',
    (_kind, model) => {
      const plan = atmIndexBuildPlan(model.schema.indexes());
      const entry = plan.find((item) => item.options['name'] === BRANCH_OPEN_BOARD_INDEX_NAME);
      expect(BRANCH_OPEN_BOARD_INDEX_NAME).toBe('ix_branch_open_board');
      // Every key the sort names, `_id` included — no in-memory sort of the branch's open rows.
      expect(entry?.keys).toEqual({ branchId: 1, area: -1, _id: -1 });
      expect(Object.keys(entry?.keys ?? {})).toEqual([
        'branchId',
        ...Object.keys(OPEN_BOARD_ORDER),
      ]);
      expect(entry?.unique).toBe(false);
      expect(entry?.options['partialFilterExpression']).toEqual({
        closedAt: null,
        isDeleted: false,
      });
    },
  );

  it('builds the branch one at boot too, and never drops it', () => {
    for (const entry of atmIndexedModels()) {
      if (!['atm_replenishments', 'atm_maintenances'].includes(entry.collection)) continue;
      const names = atmIndexBuildPlan(entry.model.schema.indexes()).map(
        (item) => item.options['name'],
      );
      expect(names, entry.collection).toContain(BRANCH_OPEN_BOARD_INDEX_NAME);
      expect(entry.retired ?? [], entry.collection).not.toContain(BRANCH_OPEN_BOARD_INDEX_NAME);
    }
  });

  it('keeps the branch board index the branch callers already use', () => {
    for (const model of [AtmReplenishmentModel, AtmMaintenanceModel]) {
      const plan = atmIndexBuildPlan(model.schema.indexes());
      const branchIndex = plan.find((item) => item.options['name'] === 'ix_branch_open_area');
      expect(branchIndex?.keys).toEqual({ branchId: 1, closedAt: 1, area: -1 });
    }
  });
});
