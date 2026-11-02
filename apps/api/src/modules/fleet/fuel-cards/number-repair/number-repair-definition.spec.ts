// The repair's definition is a constant; this pins every value of it to its three sources — the
// analyst's table (its committed PIN-free extract), the go-live asset, the photos on disk — and to
// the cycle algebra. The asset's PIN field is read ONLY as «is there one» (`!= null`): no PIN value
// is compared, printed or kept by this file.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FUEL_CARD_LINKS_IN_REPAIR } from '../reconcile/compare-card-links';
import {
  REPAIR_CARS,
  REPAIR_CYCLES,
  REPAIR_PAIR,
  REPAIR_PAIR_NUMBERS,
  REPAIR_RECORDS,
  recordsOf,
} from './number-repair-definition';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../../../../assets/fleet-go-live');

interface AssetCard {
  company: string;
  number: string;
  name: string;
  balance: number;
  expiresAt: string | null;
  vehicleCode: string | null;
}
// Each row's PIN field becomes a yes/no here, and the value is dropped on the spot.
const asset = new Map(
  (
    JSON.parse(readFileSync(join(assets, 'fuel-cards-2026-10-04.json'), 'utf8')) as {
      cards: (AssetCard & Record<string, unknown>)[];
    }
  ).cards.map((row) => {
    const card: AssetCard & { hasPin: boolean } = {
      company: row.company,
      number: row.number,
      name: row.name,
      balance: row.balance,
      expiresAt: row.expiresAt,
      vehicleCode: row.vehicleCode,
      hasPin: row['password'] != null,
    };
    return [card.number, card] as const;
  }),
);
const photoBytes = (number: string): number =>
  statSync(join(assets, 'fuel-card-photos', `${number}.jpg`)).size;

interface Evidence {
  embossedName: string;
  stickerCar: string;
  validThru: string;
}
interface Extract {
  cycles: { id: string; cars: string[]; numbersHeld: string[] }[];
  records15: {
    cycle: string;
    car: string;
    name: string;
    number: {
      currentFull: string;
      correctFull: string;
      correctNumberIsNowOnRecordOfCar: string;
    };
    expiry: { current: string; correct: string };
    goLiveBalance_unchanged: number;
    registry: { chassisMatches: boolean };
    photo: { current: Evidence; correct: Evidence };
  }[];
  pair0849: {
    records: {
      numberFull: string;
      car: { code: string };
      name: { before: string; after: string };
      openingBalance: { before: number; after: number; delta: number };
      photo: Evidence;
      statement_d81237e3: { balance: number };
    }[];
  };
}
const extractText = readFileSync(join(here, 'table-6d.json'), 'utf8');
const extract = JSON.parse(extractText) as Extract;
const cents = (egp: number): number => Math.round(egp * 100);

describe('the repair definition', () => {
  it('is the analyst table, value for value (its committed PIN-free extract)', () => {
    expect(REPAIR_CYCLES.map((c) => [c.unit, c.cars])).toEqual(
      extract.cycles.map((c) => [c.id, c.cars]),
    );
    expect(
      REPAIR_RECORDS.map((r) => ({
        cycle: r.unit,
        car: r.car,
        name: r.name,
        number: { currentFull: r.before.number, correctFull: r.after.number },
        expiry: { current: r.before.expiresAt, correct: r.after.expiresAt },
        goLiveBalance_unchanged: r.goLiveBalance,
        registry: { chassisMatches: !r.chassisTypo },
        photo: { current: r.photoBefore, correct: r.photoAfter },
      })),
    ).toEqual(
      extract.records15.map((r) => ({
        cycle: r.cycle,
        car: r.car,
        name: r.name,
        number: { currentFull: r.number.currentFull, correctFull: r.number.correctFull },
        expiry: r.expiry,
        goLiveBalance_unchanged: r.goLiveBalance_unchanged,
        registry: r.registry,
        photo: r.photo,
      })),
    );
    expect(
      REPAIR_PAIR.map((p) => ({
        numberFull: p.number,
        car: { code: p.car },
        name: { before: p.nameBefore, after: p.nameAfter },
        openingBalance: { before: p.openingBefore, after: p.openingAfter, delta: p.delta },
        photo: p.photo,
        statement_d81237e3: { balance: p.statementOpening },
      })),
    ).toEqual(extract.pair0849.records);
    // The table names each record's right number by the car that holds it today.
    for (const r of extract.records15) {
      const holder = REPAIR_RECORDS.find((x) => x.before.number === r.number.correctFull);
      expect(holder?.car).toBe(r.number.correctNumberIsNowOnRecordOfCar);
    }
  });

  it('is the go-live asset: every number is a Wataniya card, on that car, under that name', () => {
    for (const r of REPAIR_RECORDS) {
      const now = asset.get(r.before.number);
      const right = asset.get(r.after.number);
      expect(now, r.car).toMatchObject({
        company: 'wataniya',
        name: r.name,
        vehicleCode: r.car,
        expiresAt: r.before.expiresAt,
        balance: r.goLiveBalance,
        hasPin: r.before.hasPin,
      });
      // The right number is on another record of the cycle — with ITS expiry and PIN (yes/no).
      expect(right, r.car).toMatchObject({
        company: 'wataniya',
        expiresAt: r.after.expiresAt,
        hasPin: r.after.hasPin,
      });
    }
    for (const p of REPAIR_PAIR) {
      expect(asset.get(p.number), p.car).toMatchObject({
        company: 'wataniya',
        name: p.nameBefore,
        vehicleCode: p.car,
        expiresAt: p.expiresAt,
        balance: p.openingBefore,
        hasPin: p.hasPin,
      });
    }
  });

  it('names every one of the 17 photos by its byte size on disk', () => {
    for (const r of REPAIR_RECORDS) {
      expect(r.before.photoBytes, r.car).toBe(photoBytes(r.before.number));
      expect(r.after.photoBytes, r.car).toBe(photoBytes(r.after.number));
    }
    for (const p of REPAIR_PAIR) expect(p.photoBytes, p.car).toBe(photoBytes(p.number));
  });

  it('every cycle closes: each record receives what the record before it holds', () => {
    for (const cycle of REPAIR_CYCLES) {
      const rows = recordsOf(cycle.unit);
      expect(rows.map((r) => r.car)).toEqual(cycle.cars);
      expect(rows.map((r) => r.order)).toEqual(rows.map((_, i) => i + 1));
      rows.forEach((row, i) => {
        const previous = rows[(i - 1 + rows.length) % rows.length];
        expect(row.after, row.car).toEqual(previous?.before);
        expect(row.photoAfter, row.car).toEqual(previous?.photoBefore);
        // The photo of the right number shows the record's own name and car.
        expect(row.photoAfter.embossedName, row.car).toBe(row.name);
        expect(row.photoAfter.stickerCar, row.car).toBe(row.car);
      });
      // A number is held by exactly one record and received by exactly one.
      expect(new Set(rows.map((r) => r.before.number)).size).toBe(rows.length);
      expect(new Set(rows.map((r) => r.after.number))).toEqual(
        new Set(rows.map((r) => r.before.number)),
      );
    }
    expect(REPAIR_RECORDS).toHaveLength(15);
    expect(new Set(REPAIR_CARS).size).toBe(17);
  });

  it('the five records left with no PIN are cars 284, 269, 230, 256 and 251', () => {
    expect(REPAIR_RECORDS.filter((r) => !r.after.hasPin).map((r) => r.car)).toEqual([
      '284',
      '269',
      '230',
      '256',
      '251',
    ]);
    expect(REPAIR_RECORDS.filter((r) => !r.before.hasPin).map((r) => r.car)).toEqual([
      '525',
      '284',
      '269',
      '800',
      '267',
    ]);
  });

  it('the pair swaps name and opening; its numbers are the batch-3 link lock', () => {
    const [p530, p283] = REPAIR_PAIR;
    expect([p530.car, p283.car]).toEqual(['530', '283']);
    expect([p530.nameBefore, p530.nameAfter]).toEqual([p283.nameAfter, p283.nameBefore]);
    expect([p530.openingBefore, p530.openingAfter]).toEqual([
      p283.openingAfter,
      p283.openingBefore,
    ]);
    for (const p of REPAIR_PAIR) {
      expect(cents(p.openingAfter) - cents(p.openingBefore)).toBe(cents(p.delta));
      expect(p.number.slice(-4)).toBe('0849');
    }
    expect(cents(p530.delta)).toBe(-1_187_262);
    expect(p283.statementOpening).toBe(11_430.62);
    expect([...FUEL_CARD_LINKS_IN_REPAIR]).toEqual([...REPAIR_PAIR_NUMBERS]);
  });

  it('holds no PIN: every PIN fact is a yes/no, and neither source file names one', () => {
    for (const r of REPAIR_RECORDS) {
      expect(typeof r.before.hasPin).toBe('boolean');
      expect(typeof r.after.hasPin).toBe('boolean');
      expect(Object.keys(r.before).sort()).toEqual(
        ['expiresAt', 'hasPin', 'number', 'photoBytes'].sort(),
      );
    }
    const source = readFileSync(join(here, 'number-repair-definition.ts'), 'utf8');
    expect(source).not.toMatch(/password/i);
    expect(extractText).not.toMatch(/password|"pin/i);
  });
});
