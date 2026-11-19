// Round 28c — «الاتجاه»'s «إضافة «…» إلى القائمة» («يعرض عليا اضيفه او لا»): what the add puts on the
// wire and moves in the query cache, the adds of one screen row by row, and the two pages' wiring.
// Against a real QueryClient, no DOM (the web suite's rule).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MutationCache, MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCodes,
  ListOperationsReferenceQuerySchema,
  MAX_PAGE_SIZE,
  type OperationsAreaDto,
  type Paginated,
} from '@ecms/contracts';
import { ApiError, buildQuery, type QueryParams } from '../../../shared/lib/api-client';
import { listKey } from '../../../shared/lib/query-keys';
import { type DirectionAddRefused } from '../lib/direction-pick';
import {
  addLandsOn,
  archivedAreaNames,
  directionAddQueue,
  directionAddScreenEvents,
  directionAddSlot,
  directionAreaMutation,
  refusalStillHolds,
  type DirectionAddEvents,
  type DirectionAddScreen,
  type HeldRefusal,
} from './direction-area';
import { type OperationsListParams } from './operations-api';

const areaDto = (name: string, isActive = true): OperationsAreaDto => ({
  id: `a-${name}`,
  name,
  nameEn: null,
  governorate: null,
  isActive,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const page = (
  items: OperationsAreaDto[],
  at: number,
  pages: number,
): Paginated<OperationsAreaDto> => ({
  items,
  meta: { page: at, pageSize: MAX_PAGE_SIZE, totalItems: items.length * pages, totalPages: pages },
});

describe('the archived areas’ names — what the box checks a name against before it offers the add', () => {
  it('asks for the archived areas, every page, in a query the server takes', async () => {
    const asked: OperationsListParams[] = [];
    const names = await archivedAreaNames(async (params) => {
      asked.push(params);
      return params.page === 1
        ? page([areaDto('الدقي', false), areaDto('طريق المطار', false)], 1, 2)
        : page([areaDto('الزمالك', false), areaDto('حلوان')], 2, 2);
    });
    // An active row the server should not have sent is left out all the same.
    expect(names).toEqual(['الدقي', 'طريق المطار', 'الزمالك']);
    expect(asked.map((params) => params.page)).toEqual([1, 2]);
    for (const params of asked) {
      expect(params).toMatchObject({ pageSize: MAX_PAGE_SIZE, sortBy: 'name', isActive: false });
      const query = Object.fromEntries(
        new URLSearchParams(buildQuery(params as QueryParams).replace(/^\?/, '')),
      );
      expect(ListOperationsReferenceQuerySchema.safeParse(query).success).toBe(true);
    }
  });
});

describe('the add’s mutation — the catalog’s own create, on a real QueryClient', () => {
  const AREAS_KEY = listKey('operations', 'areas', { whole: true, isActive: true });
  const ARCHIVED_KEY = listKey('operations', 'areas', { whole: true, isActive: false });
  const BRANCHES_KEY = listKey('operations', 'bankBranches', { page: 1 });
  const stale = (qc: QueryClient, key: readonly unknown[]): boolean =>
    qc.getQueryCache().find({ queryKey: key })?.state.isInvalidated ?? false;
  const setup = (create: (body: unknown) => Promise<OperationsAreaDto>) => {
    const notified: unknown[] = [];
    // The global notifier's own rule (shared/lib/query-client.ts): it speaks only for a mutation
    // that declares no `onError`.
    const qc = new QueryClient({
      mutationCache: new MutationCache({
        onError: (error, _v, _c, mutation) => {
          if (mutation.options.onError === undefined) notified.push(error);
        },
      }),
    });
    for (const key of [AREAS_KEY, ARCHIVED_KEY, BRANCHES_KEY]) qc.setQueryData(key, []);
    const observer = new MutationObserver(qc, directionAreaMutation(qc, create));
    return { qc, notified, observer };
  };

  it('sends the name with no English name, and reads the areas again BEFORE the row is told', async () => {
    const create = vi.fn(async (body: unknown) => areaDto((body as { name: string }).name));
    const { qc, observer } = setup(create);
    const area = await observer.mutate('طريق السويس');
    expect(create).toHaveBeenCalledWith({ name: 'طريق السويس', nameEn: null, governorate: null });
    expect(area.name).toBe('طريق السويس');
    // Already stale when the promise settles: the box lists the new area, the row's direction is
    // no hand-typed text, the board's filters read it — and the branch form's suggestions too.
    expect(stale(qc, AREAS_KEY)).toBe(true);
    expect(stale(qc, ARCHIVED_KEY)).toBe(true);
    expect(stale(qc, BRANCHES_KEY)).toBe(true);
  });

  it('a refusal reads the areas again too (one added meanwhile is then offered), and the global notifier stays quiet', async () => {
    const refusal = new ApiError(
      ErrorCodes.DUPLICATE,
      'the area «المعادي» already has this name',
      409,
    );
    const { qc, notified, observer } = setup(async () => Promise.reject(refusal));
    await expect(observer.mutate('المعادى')).rejects.toBe(refusal);
    expect(stale(qc, AREAS_KEY)).toBe(true);
    // The box says the refusal in place; one message, not two.
    expect(notified).toEqual([]);
  });
});

describe('the adds of one screen, row by row (`directionAddQueue`)', () => {
  const events = () => {
    const log: string[] = [];
    const refusals: DirectionAddRefused[] = [];
    const on: DirectionAddEvents = {
      pending: (rowKey, name) => log.push(`pending ${rowKey} ${name ?? '—'}`),
      added: (rowKey, area, from) =>
        log.push(`added ${rowKey} ${area}${from ? ` from ${from}` : ''}`),
      refused: (rowKey, refusal: DirectionAddRefused, from) => {
        refusals.push(refusal);
        log.push(
          `refused ${rowKey} ${refusal.name} ${refusal.reason}${from ? ` from ${from}` : ''}`,
        );
      },
    };
    return { log, on, refusals };
  };
  const later = <T>() => {
    let settle!: { resolve: (value: T) => void; reject: (error: unknown) => void };
    const promise = new Promise<T>((resolve, reject) => {
      settle = { resolve, reject };
    });
    return { promise, ...settle };
  };
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('a row with an add in flight adds nothing more — a second Enter is not a second area', async () => {
    const answer = later<OperationsAreaDto>();
    const create = vi.fn(() => answer.promise);
    const { log, on } = events();
    const queue = directionAddQueue(create, () => on);
    expect(queue.add('van:v-1', 'طريق السويس')).toBe(true);
    expect(queue.add('van:v-1', 'طريق السويس')).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    answer.resolve(areaDto('طريق السويس'));
    await flush();
    expect(log).toEqual([
      'pending van:v-1 طريق السويس',
      'pending van:v-1 —',
      'added van:v-1 طريق السويس',
    ]);
    // Settled, the row may add again.
    expect(queue.add('van:v-1', 'طريق الواحات')).toBe(true);
  });

  it('puts the area on the row in the catalog’s OWN spelling, from its answer', async () => {
    const { log, on } = events();
    const queue = directionAddQueue(
      async () => areaDto('طريق الإسماعيلية'),
      () => on,
    );
    queue.add('row-1', 'طريق الاسماعيلية');
    await flush();
    expect(log).toContain('added row-1 طريق الإسماعيلية');
  });

  it('two rows adding the same name at once (folded) share ONE request, and both take its answer', async () => {
    const answer = later<OperationsAreaDto>();
    const create = vi.fn(() => answer.promise);
    const { log, on } = events();
    const queue = directionAddQueue(create, () => on);
    queue.add('van:v-1', 'وادي النطرون');
    queue.add('van:v-2', 'وادى النطرون');
    queue.add('van:v-3', 'وادي النطرون');
    expect(create).toHaveBeenCalledTimes(1);
    answer.resolve(areaDto('وادي النطرون'));
    await flush();
    expect(log.filter((line) => line.startsWith('added'))).toEqual([
      'added van:v-1 وادي النطرون',
      'added van:v-2 وادي النطرون',
      'added van:v-3 وادي النطرون',
    ]);
  });

  it('a refusal is told with its reason and the name kept; the row is no longer pending and may try again', async () => {
    const { log, on } = events();
    const create = vi
      .fn<(name: string) => Promise<OperationsAreaDto>>()
      .mockRejectedValueOnce(new ApiError(ErrorCodes.FORBIDDEN, 'Forbidden', 403))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const queue = directionAddQueue(create, () => on);
    queue.add('van:v-1', 'طريق الفيوم');
    await flush();
    expect(log).toEqual([
      'pending van:v-1 طريق الفيوم',
      'pending van:v-1 —',
      'refused van:v-1 طريق الفيوم forbidden',
    ]);
    expect(queue.add('van:v-1', 'طريق الفيوم')).toBe(true);
    await flush();
    expect(log.at(-1)).toBe('refused van:v-1 طريق الفيوم failed');
  });

  // Round 28c critic — the answer is handed back with the row's direction as the add was sent, for
  // the page to put the area only on a row that still holds it; a 409 names the area holding it.
  it('hands back the row’s direction at the send, and a 409’s area, with the answer', async () => {
    const { log, on, refusals } = events();
    const create = vi
      .fn<(name: string) => Promise<OperationsAreaDto>>()
      .mockResolvedValueOnce(areaDto('طريق الواحات'))
      .mockRejectedValueOnce(
        new ApiError(ErrorCodes.DUPLICATE, 'held', 409, [
          { field: 'name', code: 'AREA_ARCHIVED', message: 'الدقي' },
        ]),
      );
    const queue = directionAddQueue(create, () => on);
    queue.add('van:v-1', 'طريق الواحات', 'حلوان');
    queue.add('van:v-2', 'الدقى', null);
    await flush();
    expect(log).toContain('added van:v-1 طريق الواحات from حلوان');
    expect(log).toContain('refused van:v-2 الدقى duplicate');
    expect(refusals[0]).toEqual({
      name: 'الدقى',
      reason: 'duplicate',
      held: { area: 'الدقي', archived: true },
    });
  });
});

// Round 28c critic — the add was applied by row key alone: a day stepped during the request patched
// the same van on the other day; a row gone (a «حفظ» read-back renames `new:N`) dropped it while the
// toast said it landed; a refusal outlived its row, shown red on the box after «تراجع», a load or
// another day. The screen's events, against a fake screen.
describe('one screen’s adds — their day, their row as it was (`directionAddScreenEvents`)', () => {
  const screen = (over: Partial<DirectionAddScreen> = {}) => {
    const said: string[] = [];
    const held = new Map<string, HeldRefusal>();
    const placed: string[] = [];
    let day = '2026-11-20';
    const io: DirectionAddScreen = {
      scope: () => day,
      onAdded: (rowKey, area) => {
        placed.push(`${rowKey} ${area}`);
        return true;
      },
      t: (key, params) =>
        `${key.replace('operations.crewPlan.direction.', '')}${params?.area ? `:${params.area}` : ''}`,
      focusedRow: () => null,
      pend: () => undefined,
      hold: (slot, refusal) => held.set(slot, refusal),
      forget: (slot) => held.delete(slot),
      toast: {
        success: (title, body) => said.push(`ok ${title} | ${body ?? ''}`),
        error: (title) => said.push(`no ${title}`),
      },
      ...over,
    };
    return {
      on: directionAddScreenEvents(io),
      said,
      held,
      placed,
      step: (to: string) => (day = to),
    };
  };
  const slot = (rowKey: string, day = '2026-11-20') => directionAddSlot(day, rowKey);
  const refusal = { name: 'طريق الفيوم', reason: 'failed' as const };

  it('lands on its row on its own day — the toast says the row took it', () => {
    const { on, said, placed } = screen();
    on.added(slot('van:259'), 'طريق الواحات', 'حلوان');
    expect(placed).toEqual(['van:259 طريق الواحات']);
    expect(said).toEqual(['ok added:طريق الواحات | addedBody:طريق الواحات']);
  });

  it('a day stepped meanwhile: the same van on the other day is NOT changed — the toast says so', () => {
    const { on, said, placed, step } = screen();
    step('2026-11-21');
    on.added(slot('van:259'), 'طريق الواحات', 'حلوان');
    expect(placed).toEqual([]);
    expect(said).toEqual(['ok added:طريق الواحات | addedNotPlaced:طريق الواحات']);
  });

  it('the row gone or changed meanwhile (the page answers false): added to the list, the row not changed — said', () => {
    const { on, said } = screen({ onAdded: () => false });
    on.added(slot('new:3'), 'طريق الواحات', null);
    expect(said).toEqual(['ok added:طريق الواحات | addedNotPlaced:طريق الواحات']);
  });

  it('a refusal is held for its row with the direction it was sent on, and toasted — unless its box has the focus', () => {
    const away = screen();
    away.on.refused(slot('van:259'), refusal, 'حلوان');
    expect(away.held.get(slot('van:259'))).toEqual({ refusal, from: 'حلوان' });
    expect(away.said).toEqual(['no addRefused.failed']);
    // The box still focused says it in place, once: no toast.
    const here = screen({ focusedRow: () => 'van:259' });
    here.on.refused(slot('van:259'), refusal, 'حلوان');
    expect(here.held.size).toBe(1);
    expect(here.said).toEqual([]);
    // Another row's box focused: the toast speaks for this one.
    const other = screen({ focusedRow: () => 'van:300' });
    other.on.refused(slot('van:259'), refusal, 'حلوان');
    expect(other.said).toEqual(['no addRefused.failed']);
  });

  it('a refusal for a day left is not held there — only toasted', () => {
    const { on, said, held, step } = screen({ focusedRow: () => 'van:259' });
    step('2026-11-21');
    on.refused(slot('van:259'), refusal, 'حلوان');
    expect(held.size).toBe(0);
    expect(said).toEqual(['no addRefused.failed']);
  });

  it('a new add for the row forgets its last refusal', () => {
    const { on, held } = screen();
    on.refused(slot('van:259'), refusal, 'حلوان');
    on.pending(slot('van:259'), 'طريق الفيوم');
    expect(held.size).toBe(0);
  });

  it('one row on one board: the same van on two days, two rows on one day — four slots', () => {
    const slots = new Set([
      directionAddSlot('2026-11-20', 'van:259'),
      directionAddSlot('2026-11-21', 'van:259'),
      directionAddSlot('2026-11-20', 'van:300'),
      directionAddSlot('standing', 'van:259'),
    ]);
    expect(slots.size).toBe(4);
  });

  it('the area lands only on a row still on the board, still holding its direction at the send', () => {
    const rows = [
      { key: 'van:259', direction: 'حلوان' },
      { key: 'new:3', direction: null },
    ];
    expect(addLandsOn(rows, 'van:259', 'حلوان')).toBe(true);
    expect(addLandsOn(rows, 'new:3', null)).toBe(true);
    // «تحميل الطاقم الثابت» or another box wrote the row meanwhile: never written over.
    expect(addLandsOn(rows, 'van:259', 'المعادي')).toBe(false);
    // A «حفظ» read-back renamed `new:3` to `loose:<id>`, or the row was taken off.
    expect(addLandsOn(rows, 'new:4', null)).toBe(false);
  });

  it('a refusal is said while its row holds the direction it was sent on — «تراجع», a load, a pick end it', () => {
    const held: HeldRefusal = { refusal, from: 'حلوان' };
    expect(refusalStillHolds(held, 'حلوان')).toBe(refusal);
    expect(refusalStillHolds(held, 'المعادي')).toBeNull();
    expect(refusalStillHolds(held, null)).toBeNull();
    expect(refusalStillHolds(undefined, 'حلوان')).toBeNull();
  });
});

describe('the two pages’ wiring — «لوحة التشغيلة» and «الطاقم الثابت» offer it alike', () => {
  const source = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../pages/${name}`, import.meta.url)), 'utf8');

  // The add belongs to its board's day: the crew board's `day`, the standing crew's one board.
  it('each page names its add’s scope: the board’s day, the standing crew’s one board', () => {
    expect(source('CrewBoardPage.tsx')).toContain('useDirectionAreaAdd(day, (key, area, from) =>');
    expect(source('StandingCrewPage.tsx')).toContain(
      "useDirectionAreaAdd('standing', (key, area, from) =>",
    );
  });

  for (const name of ['CrewBoardPage.tsx', 'StandingCrewPage.tsx']) {
    it(`${name}: only a planner who holds the catalog’s own grant is offered the add — no new permission`, () => {
      const page = source(name);
      expect(page).toContain("const canAddArea = canPlan && can('operationsCatalog.manage');");
      // The archived names are read only for him; nothing is offered until both lists are read.
      expect(page).toContain('const archivedAreas = useArchivedOperationsAreaNames(canAddArea);');
      expect(page).toContain(
        'areaNames.isSuccess && archivedAreas.isSuccess ? archivedAreas.data : null',
      );
      // Without the grant the box is given no `add` at all.
      expect(page).toMatch(/canAddArea\s*\?\s*areaAdd\.forRow\([\s\S]*?\)\s*:\s*undefined;/);
      // Round 28c critic — REWRITTEN (was `addFor(row.key)` and «the row still exists»): the box is
      // given the row's direction too, and the area goes on the row only if it still holds it —
      // as any direction change, one operation «تراجع» takes back.
      expect(page).toContain('add={addFor(row)}');
      expect(page).toMatch(/areaAdd\.forRow\(\s*row\.key,\s*row\.direction,/);
      expect(page).toContain('if (!addLandsOn(rows, key, from)) return false;');
      expect(page).toContain('patch(key, { direction: area });');
    });
  }

  it('the add asks no permission of its own: the catalog’s create, under its grant', () => {
    const hook = readFileSync(
      fileURLToPath(new URL('./direction-area.ts', import.meta.url)),
      'utf8',
    );
    expect(hook).toContain('api.createOperationsArea');
    expect(hook).not.toMatch(/operations[A-Z]\w+\.\w+'/);
  });
});
