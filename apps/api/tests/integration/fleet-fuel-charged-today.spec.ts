// «شُحن اليوم» against a real mongo — the CAIRO day, from its midnight, never a rolling 24 hours;
// a charge the company's sheet cancelled («أُلغي بشيت الشركة») is not counted.
//
// The figure is asked at a chosen instant (the repository takes `now`), so the day's edges are
// pinned without moving the clock: Cairo is UTC+2 in winter and UTC+3 in summer.
//
// And it follows the same cards as every figure beside it (build-vf, §0b): under ANY filter — the
// charging screen's company or cars, the dashboard's branch — only the charges of the matched LIVE
// cards count; with none, every charge of the day, as it always was.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
} from '../../src/modules/fleet/fuel-cards/fuel-card.model';
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

describe('«شُحن اليوم» follows the cards the figure is asked of', () => {
  const NOW = '2026-11-01T10:00:00Z'; // 12:00 Cairo, the 1st
  const atNoon = async (filter: Record<string, unknown>): Promise<number> =>
    (await fleetFuelCardRepository.totals(filter, new Date(NOW))).chargedTodayAmount;

  it('a filter narrows it to the matched live cards; no filter keeps every charge of the day', async () => {
    const carA = new Types.ObjectId();
    const carB = new Types.ObjectId();
    const a = await mkCard('wataniya', 'EGYCASH-A', 0, { vehicleId: carA, label: null });
    const b = await mkCard('chillout', 'EGYCASHTCS-B', 0, { vehicleId: carB, label: null });
    const travel = await mkCard('wataniya', 'سفر 1', 0);
    const gone = await mkCard('chillout', 'EGYCASHTCS-GONE', 0, { vehicleId: carA, label: null });
    await FleetFuelCardModel.updateOne({ _id: gone._id }, { isDeleted: true }).exec();
    await line(a._id, '2026-11-01T07:00:00Z', 100);
    await line(b._id, '2026-11-01T07:30:00Z', 250);
    await line(travel._id, '2026-11-01T08:00:00Z', 40);
    await line(gone._id, '2026-11-01T08:30:00Z', 5);

    // The company view: every charge of the day — the deleted card's too, as it always was.
    expect(await atNoon({})).toBe(395);
    // The charging screen's own filters.
    expect(await atNoon({ company: 'wataniya' })).toBe(140);
    expect(await atNoon({ company: 'chillout' })).toBe(250);
    // The dashboard's branch arrives as the cars of the branch (`vehicleId $in`): the card on no car
    // and the deleted card are never among the matched cards.
    expect(await atNoon(fleetFuelCardRepository.cardFilter({ vehicleIds: [String(carA)] }))).toBe(
      100,
    );
    expect(
      await atNoon(
        fleetFuelCardRepository.cardFilter({ vehicleIds: [String(carA), String(carB)] }),
      ),
    ).toBe(350);
    // A set that matches no card: nothing, and no charge read at all.
    expect(await atNoon(fleetFuelCardRepository.cardFilter({ vehicleIds: [] }))).toBe(0);
  });

  it('`charged: false` answers the counts only', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-C', 0);
    await line(a._id, '2026-11-01T07:00:00Z', 60);
    const out = await fleetFuelCardRepository.totals({}, new Date(NOW), { charged: false });
    expect(out.chargedTodayAmount).toBe(0);
    expect(out.cardCount).toBe(1);
    expect(out).toMatchObject({ noCarCards: 1, wataniyaCards: 1, chilloutCards: 0 });
  });
});
