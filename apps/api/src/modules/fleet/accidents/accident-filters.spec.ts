// What the accident list and its totals actually ASK THE DATABASE.
//
// Every rule the screen promises is a property of one mongo filter, so these drive the real
// service — the real code→vehicle resolution, the real `accidentFilter` — and read the filter it
// produced. Nothing is asserted by reading source, and nothing is stubbed but the two boundaries:
// the vehicle registry the code search has to consult, and the collection call itself.
import { Types, type FilterQuery } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetAccidentRepository } from './accident.repository';
import { fleetAccidentService } from './accident.service';
import { type FleetAccidentDoc } from './accident.model';

const oid = (tail: string): string => `65000000000000000000${tail.padStart(4, '0')}`;

/** Every `$and` clause the service ended up sending, or `[]` when it filtered nothing. */
const clausesOf = (filter: FilterQuery<FleetAccidentDoc>): Record<string, unknown>[] => {
  const and = (filter as { $and?: Record<string, unknown>[] }).$and;
  return and ?? [];
};

let captured: FilterQuery<FleetAccidentDoc>;
let codeSearch: MockInstance<(term: string) => Promise<string[]>>;

beforeEach(() => {
  captured = {};
  vi.spyOn(fleetAccidentRepository, 'listAccidents').mockImplementation(async (params) => {
    captured = params.filter ?? {};
    return { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } };
  });
  vi.spyOn(fleetAccidentRepository, 'totals').mockImplementation(async (filter) => {
    captured = filter;
    return { count: 0, amountCollected: 0, companyCost: 0, paidAmount: 0, remaining: 0 };
  });
  codeSearch = vi.spyOn(fleetVehicleRepository, 'idsByCodeSearch');
});
afterEach(() => vi.restoreAllMocks());

/** Run the real list path with these filters and hand back the filter it built. */
const filterFor = async (
  query: Record<string, unknown>,
): Promise<FilterQuery<FleetAccidentDoc>> => {
  await fleetAccidentService.list({
    page: 1,
    pageSize: 25,
    sortDir: 'desc',
    ...query,
  } as Parameters<typeof fleetAccidentService.list>[0]);
  return captured;
};

describe('the code search', () => {
  it('resolves the typed code against the REGISTRY — an accident does not store one', () => {
    // The whole reason this filter is a two-step: the collection holds `vehicleId` and nothing
    // else, so "show me 213" is a question about vehicles before it is one about accidents.
    codeSearch.mockResolvedValue([oid('a1'), oid('a2')]);
    return filterFor({ code: '21' }).then((filter) => {
      expect(codeSearch).toHaveBeenCalledWith('21');
      expect(clausesOf(filter)).toEqual([
        { vehicleId: { $in: [new Types.ObjectId(oid('a1')), new Types.ObjectId(oid('a2'))] } },
      ]);
    });
  });

  it('narrows to NOTHING when no vehicle carries that code — it is never dropped', async () => {
    // The costly failure mode: a filter the bar shows as active and the server quietly ignores
    // answers an impossible search with the whole fleet.
    codeSearch.mockResolvedValue([]);
    const filter = await filterFor({ code: 'ZZZ' });
    expect(clausesOf(filter)).toEqual([{ vehicleId: { $in: [] } }]);
    expect(clausesOf(filter).length, 'the clause is present, not omitted').toBe(1);
  });

  it('does not consult the registry at all when nothing was typed', async () => {
    const filter = await filterFor({});
    expect(codeSearch).not.toHaveBeenCalled();
    expect(filter).toEqual({});
  });
});

describe('the vehicle dropdown', () => {
  it('narrows to that one vehicle, exactly as it always did', async () => {
    const filter = await filterFor({ vehicleId: oid('b1') });
    expect(clausesOf(filter)).toEqual([{ vehicleId: new Types.ObjectId(oid('b1')) }]);
  });
});

describe('code AND dropdown — two narrowings, both applied', () => {
  it('sends BOTH clauses, so the result is their intersection', async () => {
    codeSearch.mockResolvedValue([oid('a1'), oid('b1')]);
    const clauses = clausesOf(await filterFor({ code: '21', vehicleId: oid('b1') }));

    // Two clauses in one `$and` is what "both apply" means in mongo. One clause would mean one
    // of them silently won; an `$or` would mean either could satisfy the search.
    expect(clauses).toHaveLength(2);
    expect(clauses).toContainEqual({ vehicleId: new Types.ObjectId(oid('b1')) });
    expect(clauses).toContainEqual({
      vehicleId: { $in: [new Types.ObjectId(oid('a1')), new Types.ObjectId(oid('b1'))] },
    });
  });

  it('is an AND and NOT an $or — stated against the filter’s own shape', async () => {
    codeSearch.mockResolvedValue([oid('a1')]);
    const filter = await filterFor({ code: '21', vehicleId: oid('b1') });
    expect(Object.keys(filter)).toEqual(['$and']);
    expect(JSON.stringify(filter)).not.toContain('$or');
  });

  it('finds nothing when the pick is outside what the code matched', async () => {
    // `213` picked while `15` is typed: two clauses that cannot both hold, which is the honest
    // answer to a contradictory search.
    codeSearch.mockResolvedValue([oid('a1')]);
    const clauses = clausesOf(await filterFor({ code: '15', vehicleId: oid('b1') }));
    const pinned = clauses.find((c) => c['vehicleId'] instanceof Types.ObjectId);
    const swept = clauses.find((c) => !(c['vehicleId'] instanceof Types.ObjectId));
    expect(String(pinned?.['vehicleId'])).toBe(oid('b1'));
    expect((swept?.['vehicleId'] as { $in: Types.ObjectId[] }).$in.map(String)).not.toContain(
      oid('b1'),
    );
  });
});

describe('the culprit search', () => {
  it('matches part of the name, case-insensitively', async () => {
    const clauses = clausesOf(await filterFor({ culprit: 'اشرف' }));
    const rx = clauses[0]?.['culprit'] as RegExp;
    expect(rx).toBeInstanceOf(RegExp);
    expect(rx.flags).toContain('i');
    expect(rx.test('اشرف نصحى'), 'a substring match').toBe(true);
    expect(rx.test('احمد السيد')).toBe(false);
  });

  it('ESCAPES what the reader typed — a search box is not a regex console', async () => {
    // Unescaped, `.*` matches every name in the collection and the filter stops filtering.
    const clauses = clausesOf(await filterFor({ culprit: 'a.*b' }));
    const rx = clauses[0]?.['culprit'] as RegExp;
    expect(rx.test('a.*b'), 'the literal text still matches itself').toBe(true);
    expect(rx.test('axxxb'), 'but it is not a wildcard').toBe(false);
    expect(rx.source).toBe('a\\.\\*b');
  });

  it('escapes the other characters that would change the meaning', async () => {
    for (const [term, matches, misses] of [
      ['(a)', '(a)', 'a'],
      ['a+', 'a+', 'aa'],
      ['^a', '^a', 'a'],
      ['a|b', 'a|b', 'b'],
    ] as const) {
      const rx = clausesOf(await filterFor({ culprit: term }))[0]?.['culprit'] as RegExp;
      expect(rx.test(matches), `${term} matches itself`).toBe(true);
      expect(rx.test(misses), `${term} is not a pattern`).toBe(false);
    }
  });
});

describe('the remaining filters', () => {
  it('narrows by status', async () => {
    expect(clausesOf(await filterFor({ status: 'closed' }))).toEqual([{ status: 'closed' }]);
  });

  it('narrows by the date range, from both ends', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-06-30T00:00:00.000Z');
    expect(clausesOf(await filterFor({ from }))).toEqual([{ occurredAt: { $gte: from } }]);
    expect(clausesOf(await filterFor({ to }))).toEqual([{ occurredAt: { $lte: to } }]);
  });

  it('combines EVERY filter at once, each as its own clause', async () => {
    codeSearch.mockResolvedValue([oid('a1')]);
    const clauses = clausesOf(
      await filterFor({
        code: '21',
        vehicleId: oid('b1'),
        culprit: 'اشرف',
        status: 'open',
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-12-31T00:00:00.000Z'),
      }),
    );
    // Six filters, six clauses: none of them absorbed, replaced or dropped by another.
    expect(clauses).toHaveLength(6);
  });
});

describe('the totals answer the SAME filters as the page', () => {
  it('builds an identical filter from an identical search', async () => {
    codeSearch.mockResolvedValue([oid('a1')]);
    const listFilter = await filterFor({ code: '21', status: 'closed' });
    await fleetAccidentService.summary({ code: '21', status: 'closed' });
    expect(captured, 'the sums describe the rows the table is drawn from').toEqual(listFilter);
  });

  it('cannot be handed a page — the summary query has no room for one', async () => {
    // Belt and braces over the schema's own refusal: even the service signature takes filters.
    await fleetAccidentService.summary({ status: 'open' });
    expect(JSON.stringify(captured)).not.toContain('page');
  });
});
