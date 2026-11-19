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
  archivedAreaNames,
  directionAddQueue,
  directionAreaMutation,
  type DirectionAddEvents,
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
    const on: DirectionAddEvents = {
      pending: (rowKey, name) => log.push(`pending ${rowKey} ${name ?? '—'}`),
      added: (rowKey, area) => log.push(`added ${rowKey} ${area}`),
      refused: (rowKey, refusal: DirectionAddRefused) =>
        log.push(`refused ${rowKey} ${refusal.name} ${refusal.reason}`),
    };
    return { log, on };
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
});

describe('the two pages’ wiring — «لوحة التشغيلة» and «الطاقم الثابت» offer it alike', () => {
  const source = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../pages/${name}`, import.meta.url)), 'utf8');

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
      expect(page).toContain('add={addFor(row.key)}');
      // The area goes on the row as any direction change — one operation «تراجع» takes back.
      expect(page).toContain(
        'if (rows.some((row) => row.key === key)) patch(key, { direction: area });',
      );
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
