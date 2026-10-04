// The owner's two fuel-card sheets, on rows, with no database: what the asset holds, that every
// code in it is a car of the registry, and where the plan puts each card — nothing left out.
import { readFileSync, readdirSync } from 'node:fs';
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
import {
  FUEL_CARD_PHOTOS_DIR,
  FUEL_CARD_PHOTOS_GO_LIVE_MARK,
  planFuelCardPhotos,
} from './fuel-card-photos';

const dir = resolveGoLiveDataDir() as string;
const asset = parseFuelCards(JSON.parse(readFileSync(join(dir, FUEL_CARDS_FILE), 'utf8')));

const row = (over: Partial<FuelCardRow>): FuelCardRow => ({
  company: 'wataniya',
  number: '5485640000000001',
  name: 'EGYCASH-1',
  balance: 100,
  expiresAt: '2027-01-31',
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
    expect(FUEL_CARD_PHOTOS_GO_LIVE_MARK).toBe('go-live:fuel-card-photos:v1');
  });

  it('dates 413 cards, each on the last day of its «VALID THRU» month; 13 wait for a date', () => {
    const dated = asset.rows.filter((card) => card.expiresAt !== null);
    expect(dated).toHaveLength(413);
    for (const card of dated) {
      const day = new Date(`${card.expiresAt as string}T00:00:00.000Z`);
      const next = new Date(day.getTime() + 86_400_000);
      expect(next.getUTCDate(), `${card.number} ${card.expiresAt}`).toBe(1);
    }
    const undated = asset.rows
      .filter((card) => card.expiresAt === null)
      .map((card) => `${card.company}:${card.sheetCode}`)
      .sort();
    expect(undated).toEqual(
      [
        ...['suz 63', 'suz 65', 'suz 66', 'suz 68'].map((code) => `wataniya:${code}`),
        ...['286', '287', '291', '294', '530', '532', '533', '534', '809'].map(
          (code) => `chillout:${code}`,
        ),
      ].sort(),
    );
  });

  it('a renewed card carries the date on its photo, not the older sheet row', () => {
    const byNumber = new Map(asset.rows.map((card) => [card.number, card]));
    // Card 207: the sheet says 11/25, the card in the photo says 11/28.
    expect(byNumber.get('5485640006816967')?.expiresAt).toBe('2028-11-30');
  });

  it('ships 406 photos, each named for a card of the sheets', () => {
    const files = readdirSync(join(dir, FUEL_CARD_PHOTOS_DIR));
    expect(files).toHaveLength(406);
    const numbers = new Set(asset.rows.map((card) => card.number));
    expect(files.filter((file) => !numbers.has(file.replace(/\.jpg$/u, '')))).toEqual([]);
  });
});

describe('planFuelCardPhotos', () => {
  it('a photo goes on the card of its number; a stranger is listed, a non-image refused', () => {
    const plan = planFuelCardPhotos(
      ['1111.jpg', '2222.jpg', '3333.jpg', 'notes.txt', '1111.png'],
      new Map([
        ['1111', { cardId: 'c1', hasImage: false }],
        ['2222', { cardId: 'c2', hasImage: true }],
      ]),
    );
    expect(plan.matched).toEqual([
      { file: '1111.jpg', number: '1111', cardId: 'c1', hasImage: false },
      { file: '2222.jpg', number: '2222', cardId: 'c2', hasImage: true },
    ]);
    expect(plan.unmatched).toEqual(['3333.jpg']);
    expect(plan.notImages).toEqual(['notes.txt']);
    expect(plan.duplicates).toEqual(['1111']);
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
        row({ number: '5485640000000011', expiresAt: '01/27' }),
        { ...row({}), number: '5485640000000010', company: 'misr' },
      ],
    });
    expect(parsed.rows.map((card) => card.number)).toEqual(['5485640000000009']);
    expect(parsed.rejected).toHaveLength(6);
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
