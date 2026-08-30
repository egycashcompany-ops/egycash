// «إجمالي المتبقي» and the shape of the queries that produce it.
//
// The formula lives in the contract because two places compute it — the row in the table and the
// sum beneath it — and this file is what stops them being two formulas. It also pins the two
// query schemas, because one of the guarantees the screen makes is STRUCTURAL: the totals cannot
// be narrowed to a page, since the request that asks for them has nowhere to put a page number.
import { describe, expect, it } from 'vitest';
import {
  FleetAccidentSummaryQuerySchema,
  ListFleetAccidentsQuerySchema,
  fleetAccidentRemaining,
} from './fleet';

const remaining = (amountCollected: number, companyCost: number, paidAmount: number): number =>
  fleetAccidentRemaining({ amountCollected, companyCost, paidAmount });

describe('fleetAccidentRemaining — collected + company − paid', () => {
  it('is the sum of the two owed minus what was paid', () => {
    expect(remaining(1500, 0, 0)).toBe(1500);
    expect(remaining(0, 350, 350)).toBe(0);
    expect(remaining(400, 500, 900)).toBe(0);
    expect(remaining(1000, 250, 400)).toBe(850);
  });

  it('adds the COMPANY side in — dropping it is the easy mistake and it changes the answer', () => {
    // Stated as its own case because `collected − paid` is the formula somebody will reach for.
    expect(remaining(0, 350, 0)).toBe(350);
    expect(remaining(0, 350, 0)).not.toBe(remaining(0, 0, 0));
  });

  it('goes NEGATIVE when more was paid than owed — an overpayment is a real answer', () => {
    expect(remaining(100, 0, 250)).toBe(-150);
  });

  it('reproduces the legacy screen’s own totals row', () => {
    // The four figures printed under the legacy list, which the new strip must agree with.
    expect(remaining(87_835, 174_710, 240_540)).toBe(22_005);
  });

  it('rounds to the piastre, so a figure shown to two places is the figure that was computed', () => {
    expect(remaining(12.344, 0, 0)).toBe(12.34);
    expect(remaining(12.346, 0, 0)).toBe(12.35);
    expect(remaining(1234.567, 0, 0.001)).toBe(1234.57);
    // Two decimals is the whole of the precision: sub-piastre residue is settled, not carried.
    expect(remaining(1.115, 2.225, 3.335), 'residue below half a piastre settles to zero').toBe(0);
  });

  it('never returns NEGATIVE ZERO — not for exact zero, and not for float residue', () => {
    // `Intl.NumberFormat` prints -0 as "-0", so a debt of nothing would be shown with a minus
    // sign. Both routes to it are covered: an exact wash, and binary residue that rounds to zero.
    expect(Object.is(remaining(0, 0, 0), -0), 'an exact wash').toBe(false);
    expect(Object.is(remaining(0.1, 0.2, 0.3), -0), 'float residue below a piastre').toBe(false);
    expect(Object.is(remaining(0, 0, 0.004), -0), 'a rounding-down residue').toBe(false);
    expect(remaining(0, 0, 0.004)).toBe(0);
    // And the rendering itself, since that is where the reader would have seen it.
    expect(new Intl.NumberFormat('en').format(remaining(0.1, 0.2, 0.3))).toBe('0');
  });
});

describe('the list query', () => {
  const parse = (input: Record<string, unknown>) => ListFleetAccidentsQuerySchema.safeParse(input);

  it('accepts a code search and a vehicle pick TOGETHER — they are not alternatives', () => {
    const parsed = parse({ code: '21', vehicleId: '6500000000000000000000a1' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe('21');
      expect(parsed.data.vehicleId).toBe('6500000000000000000000a1');
    }
  });

  it('accepts a culprit search', () => {
    const parsed = parse({ culprit: 'اشرف' });
    expect(parsed.success && parsed.data.culprit).toBe('اشرف');
  });

  it('trims a search term and refuses one that is only spaces', () => {
    expect(parse({ code: '  213  ' }).success && parse({ code: '  213  ' })).toBeTruthy();
    const trimmed = parse({ code: '  213  ' });
    expect(trimmed.success && trimmed.data.code).toBe('213');
    expect(parse({ code: '   ' }).success, 'a blank search is not a filter').toBe(false);
  });

  it('still pages, and still refuses a field it does not know', () => {
    const parsed = parse({ page: '2', pageSize: '10' });
    expect(parsed.success && parsed.data.page).toBe(2);
    expect(parse({ nonsense: '1' }).success).toBe(false);
  });
});

describe('the summary query — the totals cannot be narrowed to a page', () => {
  const parse = (input: Record<string, unknown>) =>
    FleetAccidentSummaryQuerySchema.safeParse(input);

  it('takes the SAME filters as the list', () => {
    const parsed = parse({
      code: '21',
      vehicleId: '6500000000000000000000a1',
      culprit: 'اشرف',
      status: 'closed',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(parsed.success).toBe(true);
  });

  it('REFUSES page and pageSize — this is the guarantee, not an oversight', () => {
    // Not "ignores": refuses. A caller cannot ask for the sum of one page even by accident,
    // because the request carrying that ask does not parse.
    expect(parse({ page: 2 }).success).toBe(false);
    expect(parse({ pageSize: 10 }).success).toBe(false);
    expect(parse({ sortBy: 'occurredAt' }).success).toBe(false);
  });

  it('has no page key at all in its parsed output', () => {
    const parsed = parse({ status: 'open' });
    expect(parsed.success && Object.keys(parsed.data)).toEqual(['status']);
  });
});
