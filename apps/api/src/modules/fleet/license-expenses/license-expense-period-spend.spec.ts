// «مصروفات التراخيص في الفترة» and «تفصيل مصروفات الفترة» — the fleet dashboard's R2 `licenceSpend`
// (`periodSpend`): the licence-expense memos whose memo day is in the range, by the register's own
// day rule (whole days at both ends), and nothing else — a memo has no branch, no car type, no
// operation.
//
// ONE aggregate: the register's count and cars, and the money split twice — by memo (تجديد
// تراخيص / مد مدة) and by payment (فيزا / نقدي) — so renewal + extension = visa + cash = total, to
// the piastre. Its count, cars, visa and cash ARE `/summary`'s over the same range. The count is
// MEMOS — a record holding a renewal and an extension is two (D05) — and every sum is line by line
// in whole piastres, the strip's too (D51). Under «النوع» / «التسوية» the strip reads the matched
// memos only (D05). Against a real store (an in-memory Mongo).
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
const JUNE = { from: day('2026-06-01'), to: day('2026-06-30') };
const JULY = { from: day('2026-07-01'), to: day('2026-07-31') };
const SETTLED = { operationId: new Types.ObjectId(), settledAt: day('2026-06-25') };
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
      // JUNE — «تسوية عهدة» half done (D05). Three records, five memos; one memo settled.
      // L1: both memos waiting.
      record('2026-06-05', {
        renewal: { vehicles: [car('201'), car('202')], items: [line(250, 'visa')] },
        extension: { vehicles: [car('201')], items: [line(30, 'cash')] },
      }),
      // L2: a renewal alone, waiting.
      record('2026-06-10', {
        renewal: { vehicles: [car('203')], items: [line(400, 'visa')] },
      }),
      // L3: its renewal SETTLED, its extension still waiting.
      record('2026-06-15', {
        renewal: { vehicles: [car('204')], items: [line(200, 'visa')] },
        renewalSettlement: SETTLED,
        extension: { vehicles: [car('204'), car('205')], items: [line(80, 'cash')] },
      }),
      // JULY — a three-decimal amount, only reachable through the API or an import (D51).
      record('2026-07-20', {
        renewal: { vehicles: [car('206')], items: [line(10.005, 'visa', 3)] },
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it('sums the range: whole days at both ends, the deleted memo never', async () => {
    expect(await fleetLicenseExpenseService.periodSpend(OCT)).toEqual({
      // Four memos in three records: the 15th holds a renewal AND an extension.
      count: 4,
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

  it('one day holds one record: the memo day decides, both memos of it inside — two memos', async () => {
    expect(
      await fleetLicenseExpenseService.periodSpend({
        from: day('2026-10-15'),
        to: day('2026-10-15'),
      }),
    ).toEqual({
      count: 2,
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

  it('counts MEMOS on the strip and on the dashboard alike — five in three records (D05)', async () => {
    expect(await fleetLicenseExpenseService.summary(JUNE)).toEqual({
      count: 5,
      cars: 7,
      visaTotal: 850,
      cashTotal: 110,
    });
    expect((await fleetLicenseExpenseService.periodSpend(JUNE)).count).toBe(5);
  });

  it('«لم تُسوَّ» sums the waiting memos only — 760 over 4, never the settled 200 (D05)', async () => {
    expect(await fleetLicenseExpenseService.summary({ ...JUNE, status: 'waiting' })).toEqual({
      count: 4,
      cars: 6,
      visaTotal: 650,
      cashTotal: 110,
    });
    expect(await fleetLicenseExpenseService.summary({ ...JUNE, status: 'settled' })).toEqual({
      count: 1,
      cars: 1,
      visaTotal: 200,
      cashTotal: 0,
    });
  });

  it('«النوع» sums that memo only; with «لم تُسوَّ», the memos that are both (D05)', async () => {
    // Renewals waiting: L1 250 + L2 400 = 650 over 2 — not 680 with L1’s extension.
    expect(
      await fleetLicenseExpenseService.summary({ ...JUNE, kind: 'renewal', status: 'waiting' }),
    ).toEqual({ count: 2, cars: 3, visaTotal: 650, cashTotal: 0 });
    // Extensions waiting: L1 30 + L3 80 = 110 over 2 — not 560 with both records’ renewals.
    expect(
      await fleetLicenseExpenseService.summary({ ...JUNE, kind: 'extension', status: 'waiting' }),
    ).toEqual({ count: 2, cars: 3, visaTotal: 0, cashTotal: 110 });
    // Every renewal, settled or not: 850 over 3.
    expect(await fleetLicenseExpenseService.summary({ ...JUNE, kind: 'renewal' })).toEqual({
      count: 3,
      cars: 4,
      visaTotal: 850,
      cashTotal: 0,
    });
  });

  it('the money arrow orders the matched memos’ figures, as the strip sums them (D05)', async () => {
    const ids = async (status?: 'waiting') =>
      (
        await fleetLicenseExpenseService.list({
          ...JUNE,
          ...(status === undefined ? {} : { status }),
          page: 1,
          pageSize: 25,
          sortBy: 'total',
          sortDir: 'asc',
        })
      ).items.map((row) => row.date);
    // Whole records: L1 280 = L3 280 < L2 400 (the tie broken by the id, L1 first).
    expect(await ids()).toEqual(['2026-06-05', '2026-06-15', '2026-06-10']);
    // Waiting memos only: L3 80 < L1 280 < L2 400.
    expect(await ids('waiting')).toEqual(['2026-06-15', '2026-06-05', '2026-06-10']);
  });

  it('sums each line to the piastre first — 10.005 × 3 is 30.03 on both (D51)', async () => {
    const strip = await fleetLicenseExpenseService.summary(JULY);
    const spend = await fleetLicenseExpenseService.periodSpend(JULY);
    expect(strip.visaTotal).toBe(30.03);
    expect(spend.visa).toBe(30.03);
    expect(spend.total).toBe(30.03);
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
