// The owner's two fuel-card sheets, on rows, with no database: what the asset holds, that every
// code in it is a car of the registry, and where the plan puts each card — nothing left out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGoLiveDataDir } from './vehicles';
import { parseCars } from './vehicles-import';
import { VEHICLE_CHANGES_NEW_FILE } from './vehicle-changes';
import {
  FUEL_CARDS_FILE,
  parseFuelCards,
  planFuelCards,
  type FuelCardRow,
} from './fuel-cards-import';
import { FUEL_CARDS_GO_LIVE_MARK } from './fuel-cards';

const dir = resolveGoLiveDataDir() as string;
const asset = parseFuelCards(JSON.parse(readFileSync(join(dir, FUEL_CARDS_FILE), 'utf8')));

const row = (over: Partial<FuelCardRow>): FuelCardRow => ({
  company: 'wataniya',
  number: '5485640000000001',
  name: 'EGYCASH-1',
  balance: 100,
  password: '1234',
  sheetCode: '61',
  vehicleCode: '61',
  label: null,
  ...over,
});

describe('the sheets, as shipped', () => {
  it('are 426 cards — 216 Wataniya (EGYCASH) and 210 Chill Out (EGYCASHTCS) — none rejected', () => {
    expect(asset.rejected).toEqual([]);
    expect(asset.rows).toHaveLength(426);
    const of = (company: string) => asset.rows.filter((card) => card.company === company);
    expect(of('wataniya')).toHaveLength(216);
    expect(of('chillout')).toHaveLength(210);
    const total = (company: string) =>
      Math.round(of(company).reduce((sum, card) => sum + card.balance, 0) * 100) / 100;
    expect(total('wataniya')).toBe(1073393.26);
    expect(total('chillout')).toBe(1571346.78);
  });

  it('every car code is a car of the registry, and no car holds two cards of one company', () => {
    const cars = parseCars(JSON.parse(readFileSync(join(dir, VEHICLE_CHANGES_NEW_FILE), 'utf8')));
    const codes = new Set(cars.cars.map((car) => car.code));
    const onCars = asset.rows.filter((card) => card.vehicleCode !== null);
    expect(onCars.filter((card) => !codes.has(card.vehicleCode as string))).toEqual([]);
    const pairs = onCars.map((card) => `${card.vehicleCode}|${card.company}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('the cards on no car are the ones the owner named, each under its label', () => {
    const labelled = asset.rows
      .filter((card) => card.vehicleCode === null)
      .map((card) => `${card.company}:${card.label}`)
      .sort();
    expect(labelled).toEqual(
      [
        'chillout:اسبير',
        'chillout:تويوتا اللواء',
        'wataniya:تويوتا اللواء',
        ...[1, 2, 3, 4, 5, 6].map((n) => `wataniya:سفر ${n}`),
      ].sort(),
    );
  });

  it('carries the owner’s corrections: the fixed number, its password, «194» on 288', () => {
    const byNumber = new Map(asset.rows.map((card) => [card.number, card]));
    expect(byNumber.has('548564004775884')).toBe(false);
    expect(byNumber.get('5485640004775884')).toBeDefined();
    expect(byNumber.get('5485640005908534')?.password).toBe('0926');
    const sheet194 = asset.rows.filter((card) => card.sheetCode === '194');
    expect(sheet194.map((card) => card.vehicleCode)).toEqual(['288', '288']);
  });

  it('keeps every password as text, a short one padded back to its four digits', () => {
    const passwords = asset.rows.flatMap((card) => (card.password === null ? [] : [card.password]));
    expect(passwords).toHaveLength(311);
    expect(passwords.filter((password) => /^\d{1,3}$/u.test(password))).toEqual([]);
  });

  it('has its own run key', () => {
    expect(FUEL_CARDS_GO_LIVE_MARK).toBe('go-live:fuel-cards:v1');
  });
});

describe('parseFuelCards', () => {
  it('refuses a row with no number, a car AND a label, or a number twice', () => {
    const parsed = parseFuelCards({
      cards: [
        row({ number: '' }),
        row({ label: 'سفر 1' }),
        row({ vehicleCode: null, label: null }),
        row({ number: '5485640000000009' }),
        row({ number: '5485640000000009', vehicleCode: '62', sheetCode: '62' }),
        { ...row({}), number: '5485640000000010', company: 'misr' },
      ],
    });
    expect(parsed.rows.map((card) => card.number)).toEqual(['5485640000000009']);
    expect(parsed.rejected).toHaveLength(5);
  });
});

describe('planFuelCards — where each card goes', () => {
  const vehicles = new Map([
    ['61', 'v61'],
    ['62', 'v62'],
  ]);

  it('a card goes on its car; a labelled one on no car', () => {
    const plan = planFuelCards(
      [
        row({}),
        row({ number: '2', company: 'chillout' }),
        row({ number: '3', vehicleCode: null, label: 'سفر 1' }),
      ],
      vehicles,
      new Set(),
      new Set(),
    );
    expect(plan.create.map((card) => [card.row.number, card.vehicleId, card.label])).toEqual([
      ['5485640000000001', 'v61', null],
      ['2', 'v61', null],
      ['3', null, 'سفر 1'],
    ]);
  });

  it('a number already on a card is not written again — a re-run writes nothing', () => {
    const plan = planFuelCards([row({})], vehicles, new Set(['5485640000000001']), new Set());
    expect(plan.create).toEqual([]);
    expect(plan.alreadyThere).toEqual(['5485640000000001']);
  });

  it('a code the registry lost, or a car whose slot is taken, still imports — on no car, by the code', () => {
    const plan = planFuelCards(
      [row({ vehicleCode: '99', sheetCode: '99' }), row({ number: '2' })],
      vehicles,
      new Set(),
      new Set(['v61|wataniya']),
    );
    expect(plan.create.map((card) => [card.row.number, card.vehicleId, card.label])).toEqual([
      ['5485640000000001', null, '99'],
      ['2', null, '61'],
    ]);
    expect(plan.unknownCodes).toEqual(['5485640000000001 — 99']);
    expect(plan.carTaken).toEqual(['2 — 61']);
  });

  it('two rows for one car and company: the first takes the slot, the second goes on no car', () => {
    const plan = planFuelCards([row({}), row({ number: '2' })], vehicles, new Set(), new Set());
    expect(plan.create.map((card) => card.vehicleId)).toEqual(['v61', null]);
  });
});
