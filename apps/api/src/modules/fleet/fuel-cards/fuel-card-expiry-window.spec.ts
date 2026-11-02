// Fuel cards on the fleet dashboard (T1.4, T4.7, T5.5): an expiry WINDOW, and one clock.
//
// «تنتهي خلال 30 يومًا» must not count the cards already expired — those are T1.4's red line — so the
// card filter gains `expiresFrom` (`$gte`) beside `expiresBefore` (`$lte`), the vehicles' naming.
// And «شُحن اليوم» is measured from the clock the caller passes: the dashboard runs its whole read on
// one instant, while `/summary` keeps the request's own, as it always had. Since batch 3 (D5) the
// figure is the CAIRO day of that clock — from its midnight to the next — not the 24 hours before
// it, so the window both tests read is that day's `[start, end)`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetFuelCardModel, FleetFuelCardMovementModel } from './fuel-card.model';
import { fleetFuelCardRepository } from './fuel-card.repository';
import { fleetFuelCardService } from './fuel-card.service';

const json = (value: unknown): string => JSON.stringify(value);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('cardFilter — the expiry window', () => {
  const from = new Date('2026-11-02T00:00:00.000Z');
  const before = new Date('2026-12-01T23:59:59.999Z');

  it('expiresFrom is a $gte of its own', () => {
    expect(fleetFuelCardRepository.cardFilter({ expiresFrom: from })).toEqual({
      $and: [{ expiresAt: { $gte: from } }],
    });
  });

  it('with both bounds, both clauses apply — the expired cards are out of the window', () => {
    const filter = fleetFuelCardRepository.cardFilter({ expiresFrom: from, expiresBefore: before });
    expect(filter).toEqual({
      $and: [{ expiresAt: { $lte: before } }, { expiresAt: { $gte: from } }],
    });
  });

  it('nothing asked is no filter at all — every card, as before', () => {
    expect(fleetFuelCardRepository.cardFilter({})).toEqual({});
  });
});

/** Drive the real `summary` against stubbed aggregations; hand back what each was asked. */
const drive = async (run: () => Promise<unknown>) => {
  let cards: { $match?: unknown }[] = [];
  let moves: { $match?: { at?: { $gte?: Date; $lt?: Date } } }[] = [];
  vi.spyOn(FleetFuelCardModel, 'aggregate').mockImplementation(((sent: never[]) => {
    cards = sent;
    return { exec: async () => [] };
  }) as unknown as typeof FleetFuelCardModel.aggregate);
  vi.spyOn(FleetFuelCardMovementModel, 'aggregate').mockImplementation(((sent: never[]) => {
    moves = sent;
    return { exec: async () => [{ amount: 150 }] };
  }) as unknown as typeof FleetFuelCardMovementModel.aggregate);
  const result = await run();
  return { cards, moves, result };
};

describe('summary(query, now) — «شُحن اليوم» is measured from the clock passed in', () => {
  it('uses the injected clock', async () => {
    // 01:30 on 1 November in Cairo (UTC+2): the injected clock's Cairo day, not the real one's.
    const now = new Date('2026-10-31T23:30:00.000Z');
    const { moves, result } = await drive(() => fleetFuelCardService.summary({}, now));
    expect(moves[0]?.$match?.at?.$gte?.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(moves[0]?.$match?.at?.$lt?.toISOString()).toBe('2026-11-01T22:00:00.000Z');
    expect((result as { chargedTodayAmount: number }).chargedTodayAmount).toBe(150);
  });

  it('without one, the request’s own instant — every existing caller unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'));
    const { moves } = await drive(() => fleetFuelCardService.summary({}));
    expect(moves[0]?.$match?.at?.$gte?.toISOString()).toBe('2026-11-04T22:00:00.000Z');
    expect(moves[0]?.$match?.at?.$lt?.toISOString()).toBe('2026-11-05T22:00:00.000Z');
  });

  it('carries expiresFrom from the query into the card filter', async () => {
    const { cards } = await drive(() =>
      fleetFuelCardService.summary(
        {
          expiresFrom: new Date('2026-11-02T00:00:00.000Z'),
          expiresBefore: new Date('2026-12-01T23:59:59.999Z'),
        },
        new Date('2026-11-01T08:00:00.000Z'),
      ),
    );
    const match = json(cards[0]?.$match);
    expect(match).toContain('"$gte":"2026-11-02T00:00:00.000Z"');
    expect(match).toContain('"$lte":"2026-12-01T23:59:59.999Z"');
    expect(match).toContain('"isDeleted":false');
  });
});
