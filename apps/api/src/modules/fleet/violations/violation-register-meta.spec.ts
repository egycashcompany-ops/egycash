// The violations register's own figures, against a REAL database (an in-memory Mongo) — what only
// the store can answer.
//
// D03 · `GET /fleet/violations`' `meta.outstandingAmount`: the OWED amount (`collected` not true, a
//   missing flag included) over EVERY row the list's filter finds — all pages, never the hundred in
//   hand — under the very filter the list was asked: its `kind` half, its year or days, its tick.
//   The drivers' footer «إجمالي السائقين» prints it, so it names the dashboard's «قائمة على
//   السائقين» figure that opens the list. A deleted row is in neither.
//
// D42 · «مجهول» on the register's «مجهول» filter (`unknownDriver=true`) is `isUnknownFleetDriver`'s
//   rule: «مجهول» or no name, whatever Unicode spacing surrounds it — a no-break space included,
//   which the database's ASCII `\s` used to miss.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ListFleetViolationsQuerySchema, isUnknownFleetDriver } from '@ecms/contracts';
import { FleetViolationModel } from './violation.model';

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async () => undefined),
}));

const { fleetViolationService } = await import('./violation.service');

let server: MongoMemoryServer;
let seq = 0;

/** A raw row, written past the schema so a missing `collected` stays missing (an old row). */
const row = (over: Record<string, unknown>): Record<string, unknown> => {
  seq += 1;
  return {
    _id: new Types.ObjectId(),
    kind: 'driver',
    vehicleId: new Types.ObjectId(),
    vehicleCode: null,
    violationTypeId: new Types.ObjectId(),
    amount: 12,
    year: null,
    count: null,
    unitValue: null,
    date: new Date('2023-06-10T00:00:00.000Z'),
    filedYear: null,
    homeVehicleId: null,
    driverEmployeeId: new Types.ObjectId(),
    driverName: null,
    collected: false,
    isDeleted: false,
    createdAt: new Date(Date.UTC(2023, 5, 1, 0, 0, seq)),
    ...over,
  };
};

/** The names an old book spells «مجهول» with, and what `isUnknownFleetDriver` makes of each. */
const NAMES: { name: string | null; unknown: boolean }[] = [
  { name: 'مجهول', unknown: true },
  { name: ' مجهول ', unknown: true },
  { name: ' مجهول', unknown: true },
  { name: 'مجهول  ', unknown: true },
  { name: '　مجهول ', unknown: true },
  { name: '﻿مجهول ', unknown: true },
  { name: ' ', unknown: true },
  { name: '', unknown: true },
  { name: null, unknown: true },
  { name: 'مجهول علي', unknown: false },
  { name: 'محمد', unknown: false },
];

const query = (raw: Record<string, unknown>) =>
  ListFleetViolationsQuerySchema.parse({ pageSize: 100, ...raw });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('ecms-violation-register-meta'));
  await FleetViolationModel.collection.insertMany([
    // 2023: 129 drivers' fines owed at 12 — 1,548 — and one old row with no tick at all, 40: the
    // 130 owed come to 1,588, more than one page of 100 holds.
    ...Array.from({ length: 129 }, () => row({})),
    (() => {
      const old = row({ amount: 40 });
      delete old['collected'];
      return old;
    })(),
    // Collected, and deleted: never owed.
    row({ amount: 999, collected: true }),
    row({ amount: 999, isDeleted: true }),
    // The company's 2023 statements: one owed (3 × 100), one collected.
    row({
      kind: 'vehicle',
      year: 2023,
      count: 3,
      unitValue: 100,
      amount: 300,
      date: null,
      driverEmployeeId: null,
    }),
    row({
      kind: 'vehicle',
      year: 2023,
      count: 1,
      unitValue: 75,
      amount: 75,
      date: null,
      driverEmployeeId: null,
      collected: true,
    }),
    // May 2025: binary residue the footer must not print.
    row({ amount: 0.1, date: new Date('2025-05-03T00:00:00.000Z') }),
    row({ amount: 0.2, date: new Date('2025-05-04T00:00:00.000Z') }),
    // February 2024: the old book's spellings of «مجهول», no employee named.
    ...NAMES.map(({ name }, i) =>
      row({
        date: new Date(Date.UTC(2024, 1, i + 1)),
        driverEmployeeId: null,
        driverName: name,
        amount: 5,
      }),
    ),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

describe('D03 — meta.outstandingAmount is the whole filter’s owed amount, never the page’s', () => {
  it('130 owed drivers’ fines: a page of 100, the footer 1,588', async () => {
    const page = await fleetViolationService.listWithOutstanding(
      query({ year: 2023, kind: 'driver', collected: 'false' }),
    );
    expect(page.items).toHaveLength(100);
    expect(page.meta).toEqual({
      page: 1,
      pageSize: 100,
      totalItems: 130,
      totalPages: 2,
      outstandingAmount: 1588,
    });
    // What the old footer printed — the rows in hand — is short of it.
    const inHand = page.items.reduce((sum, doc) => sum + doc.amount, 0);
    expect(inHand).toBeLessThan(1588);
  });

  it('every page of the same filter carries the same figure', async () => {
    const second = await fleetViolationService.listWithOutstanding(
      query({ year: 2023, kind: 'driver', collected: 'false', page: 2 }),
    );
    expect(second.items).toHaveLength(30);
    expect(second.meta.outstandingAmount).toBe(1588);
  });

  it('a list that lists the collected too still adds the owed part only', async () => {
    const page = await fleetViolationService.listWithOutstanding(
      query({ year: 2023, kind: 'driver' }),
    );
    expect(page.meta.totalItems).toBe(131);
    expect(page.meta.outstandingAmount).toBe(1588);
  });

  it('follows the half the list asked — the company’s, the drivers’, or both', async () => {
    const of = async (raw: Record<string, unknown>) =>
      (await fleetViolationService.listWithOutstanding(query({ year: 2023, ...raw }))).meta
        .outstandingAmount;
    expect(await of({ kind: 'vehicle' })).toBe(300);
    expect(await of({})).toBe(1888);
    expect(await of({ collected: 'true' })).toBe(0);
  });

  it('is rounded to the piastre — 0.1 + 0.2 is 0.30', async () => {
    const page = await fleetViolationService.listWithOutstanding(
      query({ kind: 'driver', from: '2025-05-01', to: '2025-05-31' }),
    );
    expect(page.meta.totalItems).toBe(2);
    expect(page.meta.outstandingAmount).toBe(0.3);
  });

  it('the plain list answers the same page, without the figure', async () => {
    const plain = await fleetViolationService.list(
      query({ year: 2023, kind: 'driver', collected: 'false' }),
    );
    expect(plain.meta).toEqual({ page: 1, pageSize: 100, totalItems: 130, totalPages: 2 });
  });
});

describe('D42 — the «مجهول» filter reads names as isUnknownFleetDriver does', () => {
  it('finds «مجهول» with any Unicode spacing, and no name — never a real name', async () => {
    const page = await fleetViolationService.listWithOutstanding(
      query({ from: '2024-02-01', to: '2024-02-29', unknownDriver: 'true' }),
    );
    const expected = NAMES.filter((entry) =>
      isUnknownFleetDriver({ driverEmployeeId: null, driverName: entry.name }),
    );
    // The contract's own rule and the table's both say so.
    expect(expected.map((entry) => entry.unknown)).toEqual(expected.map(() => true));
    expect(NAMES.filter((entry) => entry.unknown)).toHaveLength(expected.length);
    expect(page.items.map((doc) => doc.driverName).sort()).toEqual(
      expected.map((entry) => entry.name).sort(),
    );
    expect(page.meta.outstandingAmount).toBe(5 * expected.length);
  });
});
