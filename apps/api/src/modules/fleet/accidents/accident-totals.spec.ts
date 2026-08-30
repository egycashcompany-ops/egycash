// The figures under the list: what they are computed FROM, and what they can never be narrowed by.
//
// The claim the screen makes is that the totals describe every accident the filters match. That is
// only true if the pipeline has no paging in it — so this drives the real repository and reads the
// pipeline it sent, rather than trusting that no `$skip` will ever be added.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fleetAccidentRemaining } from '@ecms/contracts';
import { FleetAccidentModel } from './accident.model';
import { fleetAccidentRepository } from './accident.repository';
import { FleetVehicleModel } from '../vehicles/vehicle.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';

interface Stage {
  $match?: Record<string, unknown>;
  $group?: Record<string, unknown>;
}

/** Drive the real `totals` against a stubbed collection and hand back the pipeline it sent. */
const pipelineFor = async (
  filter: Record<string, unknown>,
  sums: Record<string, number> | null = null,
): Promise<{ stages: Stage[]; result: Awaited<ReturnType<typeof fleetAccidentRepository.totals>> }> => {
  let stages: Stage[] = [];
  vi.spyOn(FleetAccidentModel, 'aggregate').mockImplementation(((sent: Stage[]) => {
    stages = sent;
    return { exec: async () => (sums === null ? [] : [sums]) };
  }) as unknown as typeof FleetAccidentModel.aggregate);
  const result = await fleetAccidentRepository.totals(filter);
  return { stages, result };
};

afterEach(() => vi.restoreAllMocks());

describe('the totals pipeline', () => {
  it('has NO $skip and NO $limit — the sums are a property of the filters alone', async () => {
    // This is the guarantee, stated where it can actually be broken. A page cannot change a
    // number the query never learned about.
    const { stages } = await pipelineFor({ status: 'open' });
    const names = stages.flatMap((stage) => Object.keys(stage));
    expect(names).toEqual(['$match', '$group']);
    expect(names).not.toContain('$skip');
    expect(names).not.toContain('$limit');
    expect(JSON.stringify(stages)).not.toContain('pageSize');
  });

  it('matches on the SAME rows the list reads — soft-deleted files are not summed', async () => {
    const { stages } = await pipelineFor({ status: 'open' });
    // `baseFilter` is what the list passes through too; a total that counted deleted files would
    // not add up to the table above it.
    expect(JSON.stringify(stages[0]?.$match)).toContain('isDeleted');
    expect(JSON.stringify(stages[0]?.$match)).toContain('"status":"open"');
  });

  it('sums the three stored facts and counts the rows', async () => {
    const { stages } = await pipelineFor({});
    expect(stages[1]?.$group).toEqual({
      _id: null,
      count: { $sum: 1 },
      amountCollected: { $sum: '$amountCollected' },
      companyCost: { $sum: '$companyCost' },
      paidAmount: { $sum: '$paidAmount' },
    });
  });

  it('derives `remaining` with the CONTRACT’s formula, not a second copy of it', async () => {
    const { result } = await pipelineFor(
      {},
      { count: 180, amountCollected: 87_835, companyCost: 174_710, paidAmount: 240_540 },
    );
    expect(result).toEqual({
      count: 180,
      amountCollected: 87_835,
      companyCost: 174_710,
      paidAmount: 240_540,
      remaining: 22_005,
    });
    expect(result.remaining).toBe(
      fleetAccidentRemaining({ amountCollected: 87_835, companyCost: 174_710, paidAmount: 240_540 }),
    );
  });

  it('answers zeros when nothing matched — an empty search is not a missing answer', async () => {
    const { result } = await pipelineFor({ status: 'closed' }, null);
    expect(result).toEqual({
      count: 0,
      amountCollected: 0,
      companyCost: 0,
      paidAmount: 0,
      remaining: 0,
    });
    expect(Object.is(result.remaining, -0)).toBe(false);
  });
});

describe('resolving a typed code against the registry', () => {
  const findFor = async (term: string): Promise<{ filter: Record<string, unknown>; ids: string[] }> => {
    let filter: Record<string, unknown> = {};
    const id = new Types.ObjectId();
    vi.spyOn(FleetVehicleModel, 'find').mockImplementation(((sent: Record<string, unknown>) => {
      filter = sent;
      return { select: () => ({ lean: () => ({ exec: async () => [{ _id: id }] }) }) };
    }) as unknown as typeof FleetVehicleModel.find);
    const ids = await fleetVehicleRepository.idsByCodeSearch(term);
    return { filter, ids };
  };

  it('matches part of a code, case-insensitively, and returns ids', async () => {
    const { filter, ids } = await findFor('21');
    const rx = filter['code'] as RegExp;
    expect(rx).toBeInstanceOf(RegExp);
    expect(rx.flags).toContain('i');
    expect(rx.test('213'), 'a substring of the code').toBe(true);
    expect(rx.test('150')).toBe(false);
    expect(ids).toHaveLength(1);
  });

  it('ESCAPES the term — regex characters are text the reader typed, not a pattern', async () => {
    // Unescaped, `.*` matches every code in the registry, and a code search that matches
    // everything is a code search that has stopped filtering.
    const { filter } = await findFor('.*');
    const rx = filter['code'] as RegExp;
    expect(rx.source).toBe('\\.\\*');
    expect(rx.test('213'), 'it must NOT sweep the whole registry').toBe(false);
    expect(rx.test('.*'), 'the literal text still matches itself').toBe(true);
  });

  it('escapes each of the characters that would otherwise be a pattern', async () => {
    for (const [term, misses] of [
      ['2+', '22'],
      ['(2)', '2'],
      ['2|1', '1'],
      ['2.3', '243'],
    ] as const) {
      const rx = (await findFor(term)).filter['code'] as RegExp;
      expect(rx.test(term), `${term} matches itself`).toBe(true);
      expect(rx.test(misses), `${term} is not a pattern`).toBe(false);
    }
  });

  it('does not page the answer — a filter is not a page, and truncating it would hide rows', async () => {
    const { filter } = await findFor('2');
    expect(Object.keys(filter)).toEqual(['code']);
  });
});
