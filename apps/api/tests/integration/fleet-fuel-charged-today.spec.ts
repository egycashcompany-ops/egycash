// «شُحن اليوم» against a real mongo — the CAIRO day, from its midnight, never a rolling 24 hours;
// a charge the company's sheet cancelled («أُلغي بشيت الشركة») is not counted.
//
// The figure is asked at a chosen instant (the repository takes `now`), so the day's edges are
// pinned without moving the clock: Cairo is UTC+2 in winter and UTC+3 in summer.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { FleetFuelCardMovementModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { fleetFuelCardRepository } from '../../src/modules/fleet/fuel-cards/fuel-card.repository';
import { mkCard, useFuelReconcileWorld } from './helpers/fuel-reconcile-world';

useFuelReconcileWorld('charged-today');

const line = (
  cardId: Types.ObjectId,
  at: string,
  amount: number,
  over: Record<string, unknown> = {},
) =>
  FleetFuelCardMovementModel.create({
    cardId,
    kind: 'charge',
    amount,
    balanceAfter: amount,
    counterpartCardId: null,
    receiptId: null,
    at: new Date(at),
    ...over,
  });

const chargedAt = async (now: string): Promise<number> =>
  (await fleetFuelCardRepository.totals({}, new Date(now))).chargedTodayAmount;

describe('«شُحن اليوم» is the Cairo day', () => {
  it('winter: at 00:30 Cairo, 23:30 yesterday is not today and 00:10 is', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-KPI', 0);
    // 2026-11-01 is winter time: Cairo = UTC+2, so its midnight of the 2nd is 22:00Z on the 1st.
    await line(a._id, '2026-11-01T21:30:00Z', 100); // 23:30 Cairo, the 1st
    await line(a._id, '2026-11-01T22:10:00Z', 40); // 00:10 Cairo, the 2nd
    expect(await chargedAt('2026-11-01T22:30:00Z')).toBe(40); // 00:30 Cairo, the 2nd
    // Within the rolling 24 hours both would count — the Cairo day counts only its own.
    expect(await chargedAt('2026-11-01T21:59:00Z')).toBe(100); // 23:59 Cairo, the 1st
  });

  it('summer: Cairo = UTC+3 — its midnight is 21:00Z the evening before', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-KPI-S', 0);
    await line(a._id, '2026-07-14T20:50:00Z', 7); // 23:50 Cairo, the 14th
    await line(a._id, '2026-07-14T21:05:00Z', 9); // 00:05 Cairo, the 15th
    expect(await chargedAt('2026-07-15T08:00:00Z')).toBe(9);
  });

  it('a charge the sheet cancelled, a deleted one and an adjustment are not counted', async () => {
    const a = await mkCard('chillout', 'EGYCASHTCS-KPI', 0);
    await line(a._id, '2026-11-01T08:00:00Z', 1000, {
      cancelledBySheet: {
        reconciliationId: new Types.ObjectId(),
        movementId: new Types.ObjectId(),
        fileName: 'x.xlsx',
        at: new Date('2026-11-01T09:00:00Z'),
        by: null,
      },
    });
    await line(a._id, '2026-11-01T08:30:00Z', 300, { isDeleted: true });
    await line(a._id, '2026-11-01T08:45:00Z', 50, { kind: 'sheetAdjust' });
    await line(a._id, '2026-11-01T09:15:00Z', 25);
    expect(await chargedAt('2026-11-01T10:00:00Z')).toBe(25);
  });
});
