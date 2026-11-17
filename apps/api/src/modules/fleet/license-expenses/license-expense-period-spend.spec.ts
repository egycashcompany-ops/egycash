// «مصروفات التراخيص في الفترة» and «تفصيل مصروفات الفترة» — the fleet dashboard's R2 `licenceSpend`
// (`periodSpend`): the licence-expense memos whose memo day is in the range, by the register's own
// day rule (whole days at both ends), and nothing else — a memo has no branch, no car type, no
// operation.
//
// ONE aggregate: the register's count and cars, and the money split twice — by memo (تجديد
// تراخيص / مد مدة) and by payment (فيزا / نقدي) — so renewal + extension = visa + cash = total, to
// the piastre. Its count, cars, visa and cash ARE `/summary`'s over the same range. Against a real
// store (an in-memory Mongo).
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FleetLicenseExpenseModel } from './license-expense.model';
import { fleetLicenseExpenseRepository } from './license-expense.repository';
import { fleetLicenseExpenseService } from './license-expense.service';

const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const car = (plate: string, registered = true) => ({
  vehicleId: registered ? new Types.ObjectId() : null,
  plate,
});
const line = (amount: number | null, paidBy: 'visa' | 'cash', count = 1) => ({
  itemId: null,
  label: 'بند',
  amount,
  count,
  paidBy,
  receipt: false,
});
const record = (date: string, over: Record<string, unknown>) => ({
  _id: new Types.ObjectId(),
  date: day(date),
  renewal: null,
  extension: null,
  signatures: { agent: '', director: '', generalManager: '' },
  isDeleted: false,
  deletedAt: null,
  createdAt: day(date),
  updatedAt: day(date),
  __v: 0,
  ...over,
});

const OCT = { from: day('2026-10-01'), to: day('2026-10-31') };
const piastres = (n: number): number => Math.round(n * 100);

describe('periodSpend — the register over the range, split by memo and by payment', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri('ecms-licence-period-spend'));
    await FleetLicenseExpenseModel.collection.insertMany([
      // The first day of the range: a renewal of two cars, visa + cash, one line counted three times.
      record('2026-10-01', {
        renewal: {
          vehicles: [car('150'), car('151')],
          items: [line(120.5, 'visa', 3), line(0.1, 'cash'), line(0.2, 'cash')],
        },
      }),
      // A record holding BOTH memos — one record, its cars counted on each memo; the same car on both.
      record('2026-10-15', {
        renewal: { vehicles: [car('160')], items: [line(1000, 'visa')] },
        extension: {
          vehicles: [car('160'), car('ب ح 1234', false)],
          items: [line(250.25, 'cash'), line(null, 'visa'), line(19.99, 'visa', 2)],
        },
      }),
      // The last day of the range, an extension paid in cash only.
      record('2026-10-31', {
        extension: { vehicles: [car('170')], items: [line(75, 'cash')] },
      }),
      // Never counted: the day before, the day after, a deleted one.
      record('2026-09-30', { renewal: { vehicles: [car('1')], items: [line(5000, 'visa')] } }),
      record('2026-11-01', { extension: { vehicles: [car('2')], items: [line(6000, 'cash')] } }),
      record('2026-10-10', {
        isDeleted: true,
        deletedAt: day('2026-10-11'),
        renewal: { vehicles: [car('3')], items: [line(7000, 'visa')] },
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it('sums the range: whole days at both ends, the deleted memo never', async () => {
    expect(await fleetLicenseExpenseService.periodSpend(OCT)).toEqual({
      count: 3,
      cars: 6,
      // 120.5 × 3 + 1000 + 19.99 × 2 (the line with no amount is nothing)
      visa: 1401.48,
      // 0.1 + 0.2 + 250.25 + 75
      cash: 325.55,
      renewal: 1361.8,
      extension: 365.23,
      total: 1727.03,
    });
  });

  it('renewal + extension = visa + cash = total, to the piastre', async () => {
    const out = await fleetLicenseExpenseService.periodSpend(OCT);
    expect(piastres(out.renewal) + piastres(out.extension)).toBe(piastres(out.total));
    expect(piastres(out.visa) + piastres(out.cash)).toBe(piastres(out.total));
  });

  it('its count, cars, visa and cash ARE /summary’s over the same range', async () => {
    for (const range of [
      OCT,
      { from: day('2026-10-15'), to: day('2026-10-15') },
      { from: day('2026-09-01'), to: day('2026-11-30') },
    ]) {
      const out = await fleetLicenseExpenseService.periodSpend(range);
      const strip = await fleetLicenseExpenseService.summary(range);
      expect({ count: out.count, cars: out.cars, visa: out.visa, cash: out.cash }).toEqual({
        count: strip.count,
        cars: strip.cars,
        visa: strip.visaTotal,
        cash: strip.cashTotal,
      });
    }
  });

  it('one day holds one record: the memo day decides, both memos of it inside', async () => {
    expect(
      await fleetLicenseExpenseService.periodSpend({
        from: day('2026-10-15'),
        to: day('2026-10-15'),
      }),
    ).toEqual({
      count: 1,
      cars: 3,
      visa: 1039.98,
      cash: 250.25,
      renewal: 1000,
      extension: 290.23,
      total: 1290.23,
    });
  });

  it('an empty range is zeros, never null', async () => {
    expect(
      await fleetLicenseExpenseService.periodSpend({
        from: day('2027-01-01'),
        to: day('2027-01-31'),
      }),
    ).toEqual({ count: 0, cars: 0, visa: 0, cash: 0, renewal: 0, extension: 0, total: 0 });
  });

  it('is ONE aggregate whose filter is the register’s own day rule', async () => {
    const spy = vi.spyOn(fleetLicenseExpenseRepository, 'spendDigest');
    await fleetLicenseExpenseService.periodSpend(OCT);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual({
      date: { $gte: day('2026-10-01'), $lt: day('2026-11-01') },
    });
    spy.mockRestore();
  });
});
