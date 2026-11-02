// «ربط الكروت بالسيارات» — every rule of the pure link comparison, on his own rows: the 0849 pair
// (283 ↔ 530, the chassis agrees, held for the repair), MG 2 ↔ 172 (the chassis contradicts the
// sheet), «suz 62» through the go-live alias, «m g 3» through the fold, «سفر 1», an unknown «305»,
// a held slot, and «سفر 1» onto 285 while 285's card goes to «سفر 1».
import { describe, expect, it } from 'vitest';
import { foldSheetCode } from './compare-fuel-sheet';
import {
  FUEL_CARD_LINKS_IN_REPAIR,
  bareChassis,
  compareCardLinks,
  isLabelWord,
  linkResolver,
  placeVerdict,
  type LinkAlias,
  type LinkCard,
  type LinkVehicle,
  type LinkWorld,
} from './compare-card-links';
import { FUEL_SHEET_CODE_SEED } from './fuel-sheet-codes';
import { type FuelSheetRow } from './read-fuel-sheet';

const VEHICLES: LinkVehicle[] = (
  [
    ['62', '259771'],
    ['150', '250541'],
    ['172', '253813'],
    ['209', '312986'],
    ['231', '312521'],
    ['283', '783211'],
    ['285', '783212'],
    ['530', '401485'],
    ['MG 2', '60216'],
    ['MG 3', '89433'],
  ] as const
).map(([code, chassisNumber]) => ({ id: `v-${code}`, code, chassisNumber }));

/** The go-live table as the service hands it over. */
const ALIASES = new Map<string, LinkAlias>(
  FUEL_SHEET_CODE_SEED.map((seed) => [
    foldSheetCode(seed.sheetCode),
    { vehicleId: null, vehicleCode: seed.vehicleCode, label: seed.label },
  ]),
);

const card = (
  id: string,
  number: string,
  on: string | null,
  label: string | null = null,
): LinkCard => ({
  id,
  number,
  vehicleId: on === null ? null : `v-${on}`,
  label,
});

let nextRow = 2;
const row = (
  builtName: string,
  code: string | null,
  over: Partial<FuelSheetRow> = {},
): FuelSheetRow => ({
  row: nextRow++,
  number: '548**********0001',
  name: builtName,
  balance: 1,
  builtName,
  plate: null,
  chassis: null,
  code,
  numberKind: 'masked',
  ...over,
});

const worldOf = (cards: LinkCard[], aliases = ALIASES): LinkWorld => ({
  vehicles: VEHICLES,
  aliases,
  cards,
});

describe('his two swaps on the 4-10 statement', () => {
  it('283 ↔ 530: moved together, the chassis agrees with the sheet — held for the repair', () => {
    const p283 = card('p283', '5485640006880849', '283');
    const p530 = card('p530', '5485640006210849', '530');
    const { links } = compareCardLinks({
      matches: [
        { cardId: 'p283', sheet: row('EGYCASH-1137-401485', '530') },
        { cardId: 'p530', sheet: row('EGYCASH-8616-783211', '283') },
      ],
      sheetOnly: [],
      carColumn: true,
      world: worldOf([p283, p530]),
    });
    expect(links.map((l) => [l.cardId, l.kind, l.from.vehicleCode, l.to?.vehicleCode])).toEqual([
      ['p283', 'move', '283', '530'],
      ['p530', 'move', '530', '283'],
    ]);
    expect(links.map((l) => [l.chassisCar, l.pairWith, l.slotHeldBy, l.inRepair])).toEqual([
      ['530', 'p530', null, true],
      ['283', 'p283', null, true],
    ]);
    expect(FUEL_CARD_LINKS_IN_REPAIR).toEqual(['5485640006210849', '5485640006880849']);
  });

  it('MG 2 ↔ 172: «m g 2» through the alias — the chassis in each name says the system is right', () => {
    const mg2 = card('mg2', '5485640006881714', 'MG 2');
    const c172 = card('c172', '5485640005971714', '172');
    const { links } = compareCardLinks({
      matches: [
        { cardId: 'mg2', sheet: row('EGYCASH-4489-MB060216', '172') },
        { cardId: 'c172', sheet: row('EGYCASH-3675-B253813', 'm g 2') },
      ],
      sheetOnly: [],
      carColumn: true,
      world: worldOf([mg2, c172]),
    });
    expect(
      links.map((l) => [
        l.kind,
        l.to?.vehicleCode,
        l.resolvedBy,
        l.chassisCar,
        l.pairWith,
        l.inRepair,
      ]),
    ).toEqual([
      ['move', '172', 'code', 'MG 2', 'c172', false],
      ['move', 'MG 2', 'alias', '172', 'mg2', false],
    ]);
  });
});

describe('resolving the sheet’s code', () => {
  const resolver = linkResolver(worldOf([card('t1', '1', null, 'سفر 1')]));

  it('alias → registry code (folded) → a label → unknown', () => {
    expect(resolver.resolve('suz 62', null)).toEqual({
      place: { vehicleId: 'v-62', vehicleCode: '62', label: null },
      by: 'alias',
    });
    expect(resolver.resolve(' M G 3 ', null)?.place.vehicleCode).toBe('MG 3');
    expect(resolver.resolve('m g 3', null)?.by).toBe('alias');
    expect(linkResolver(worldOf([], new Map())).resolve('m g 3', null)).toEqual({
      place: { vehicleId: 'v-MG 3', vehicleCode: 'MG 3', label: null },
      by: 'code',
    });
    expect(resolver.resolve('سفر 1', null)?.place).toEqual({
      vehicleId: null,
      vehicleCode: null,
      label: 'سفر 1',
    });
    expect(linkResolver(worldOf([], new Map())).resolve('سفر 9', null)).toEqual({
      place: { vehicleId: null, vehicleCode: null, label: 'سفر 9' },
      by: 'label',
    });
    expect(resolver.resolve('305', null)).toBeNull();
    expect(resolver.resolve('  ', null)).toBeNull();
  });

  it('an alias the owner taught names the car by id; a car gone falls back to the code', () => {
    const taught = new Map<string, LinkAlias>([
      ['جيلى', { vehicleId: 'v-150', vehicleCode: null, label: null }],
      ['gone', { vehicleId: 'v-404', vehicleCode: null, label: null }],
    ]);
    const r = linkResolver(worldOf([], taught));
    expect(r.resolve('جيلى', null)?.place.vehicleCode).toBe('150');
    expect(r.resolve('gone', null)).toBeNull();
  });

  it('the chassis: letter prefix and leading zeros tolerated; the column first, else the name', () => {
    expect(bareChassis('MB060216')).toBe('60216');
    expect(bareChassis(' b257539 ')).toBe('257539');
    expect(resolver.chassisCar(row('EGYCASH-4489-MB060216', null))).toBe('MG 2');
    expect(resolver.chassisCar(row('EGYCASH', null, { chassis: '0401485' }))).toBe('530');
    expect(resolver.chassisCar(row('EGYCASH-1', null))).toBeNull();
    expect(isLabelWord('سفر 3')).toBe(true);
    expect(isLabelWord('اسبير')).toBe(true);
    expect(isLabelWord('285')).toBe(false);
  });
});

describe('the kinds', () => {
  it('«سفر 1» onto 285 while 285’s card goes to «سفر 1»: attach + detach, decided together', () => {
    const trip1 = card('trip1', '1', null, 'سفر 1');
    const c285 = card('c285', '2', '285');
    const { links } = compareCardLinks({
      matches: [
        { cardId: 'trip1', sheet: row('EGYCASH-8598-S783212', '285') },
        { cardId: 'c285', sheet: row('EGYCASH-8598-783212', 'سفر 1') },
      ],
      sheetOnly: [],
      carColumn: true,
      world: worldOf([trip1, c285]),
    });
    expect(links.map((l) => [l.cardId, l.kind, l.to, l.pairWith, l.slotHeldBy])).toEqual([
      ['trip1', 'attach', { vehicleId: 'v-285', vehicleCode: '285', label: null }, 'c285', null],
      ['c285', 'detach', { vehicleId: null, vehicleCode: null, label: 'سفر 1' }, 'trip1', null],
    ]);
  });

  it('a held slot; an unknown code; no code on a car; the same place says nothing', () => {
    const spare = card('spare', '1', null, 'اسبير');
    const c150 = card('c150', '2', '150');
    const c231 = card('c231', '3', '231');
    const c62 = card('c62', '4', '62');
    const c209 = card('c209', '5', '209');
    const { links } = compareCardLinks({
      matches: [
        { cardId: 'spare', sheet: row('EGYCASH-A', '150') },
        { cardId: 'c150', sheet: row('EGYCASH-B', '150') },
        { cardId: 'c231', sheet: row('EGYCASH-C', '305') },
        { cardId: 'c62', sheet: row('EGYCASH-D', 'suz 62') },
        { cardId: 'c209', sheet: row('EGYCASH-E', null) },
      ],
      sheetOnly: [],
      carColumn: true,
      world: worldOf([spare, c150, c231, c62, c209]),
    });
    expect(
      links.map((l) => [l.cardId, l.kind, l.slotHeldBy, l.to?.label ?? l.to?.vehicleCode ?? null]),
    ).toEqual([
      ['spare', 'attach', 'c150', '150'],
      ['c231', 'unknownCode', null, null],
      ['c209', 'detach', null, '209'],
    ]);
  });

  it('no car-code column: no links; sheet-only rows still say where the sheet puts them', () => {
    const c209 = card('c209', '5', '209');
    const sheetOnly = [row('EGYCASHTCS-1781-312986', '209'), row('EGYCASHTCS-6482-818014', '305')];
    const without = compareCardLinks({
      matches: [{ cardId: 'c209', sheet: row('EGYCASH-E', '150') }],
      sheetOnly,
      carColumn: false,
      world: worldOf([c209]),
    });
    expect(without.links).toEqual([]);
    expect(without.newCards.map((n) => n.to)).toEqual([null, null]);
    const withCodes = compareCardLinks({
      matches: [],
      sheetOnly,
      carColumn: true,
      world: worldOf([c209]),
    });
    expect(
      withCodes.newCards.map((n) => [
        n.to?.vehicleCode ?? null,
        n.resolvedBy,
        n.slotHeldBy,
        n.chassisCar,
      ]),
    ).toEqual([
      ['209', 'code', 'c209', '209'],
      [null, null, null, null],
    ]);
  });

  it('the place verdict a line carries: true where it is, false elsewhere or unknown, null without a code', () => {
    const c62 = card('c62', '4', '62');
    const resolver = linkResolver(worldOf([c62]));
    expect(placeVerdict('suz 62', c62, resolver, true)).toBe(true);
    expect(placeVerdict('150', c62, resolver, true)).toBe(false);
    expect(placeVerdict('305', c62, resolver, true)).toBe(false);
    expect(placeVerdict(null, c62, resolver, true)).toBeNull();
    expect(placeVerdict('62', c62, resolver, false)).toBeNull();
  });
});
