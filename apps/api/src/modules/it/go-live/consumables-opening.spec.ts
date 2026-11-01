// The consumables' opening stock reaches the company by DEPLOYING, and what it writes is the
// reviewed file — «دخّل الأرصدة». The file is held to the review here, with the deploy's caller, the
// types it waits for, and the rules a row keeps. The writing itself is proved against a real mongo
// in `tests/integration/it-go-live-consumables-opening.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IT_CONSUMABLE_TYPE_CODES } from './consumable-type-defaults';
import {
  ConsumablesOpeningFileSchema,
  matchStoreItems,
  parseConsumablesOpening,
  type ConsumableOpeningItem,
  type ConsumablesOpeningFile,
  type LiveStoreItem,
} from './consumables-opening-import';
import {
  CONSUMABLES_OPENING_FILE,
  IT_CONSUMABLES_OPENING_MARK,
  resolveConsumablesOpeningFile,
} from './consumables-opening';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const raw = (): string => {
  const file = resolveConsumablesOpeningFile();
  if (file === null) throw new Error(`${CONSUMABLES_OPENING_FILE} is not where the go-live looks`);
  return readFileSync(file, 'utf8');
};

const committed = (): ConsumablesOpeningFile => parseConsumablesOpening(JSON.parse(raw()));

describe('the opening stock is entered by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it, after the types', (file) => {
    const source = code(file);
    const types = source.indexOf('startItConsumableTypesGoLive();');
    const opening = source.indexOf('startItConsumablesOpeningGoLive();');
    expect(opening).toBeGreaterThan(-1);
    // Started second, so its wait for this boot's seeding has something to wait on.
    expect(types).toBeGreaterThan(-1);
    expect(types).toBeLessThan(opening);
  });

  it('runs once per version of the file', () => {
    expect(IT_CONSUMABLES_OPENING_MARK).toBe('go-live:it-consumables-opening-2026-10:v1');
    expect(IT_CONSUMABLES_OPENING_MARK).toMatch(/:v\d+$/u);
  });

  it('waits for the types it files under — and for this boot’s seeding of them', () => {
    const source = code('src/modules/it/go-live/consumables-opening.ts');
    expect(source).toContain('isItGoLiveRunDone(IT_CONSUMABLE_TYPES_MARK, session)');
    expect(source).toContain('await itConsumableTypesSettled();');
  });
});

describe('the committed file is the reviewed one', () => {
  const file = committed();

  it('counts ten items in the head office’s store', () => {
    expect(file.branch).toBe('المهندسين');
    expect(file.items.map((item) => [item.name, item.qty])).toEqual([
      ['SSD', 3],
      ['RAM 8 GB', 5],
      ['Keyboard', 23],
      ['Mouse', 13],
      ['Patch Cord 1 m', 21],
      ['Patch Cord 3 m', 24],
      ['Power Cable', 5],
      ['HDMI Cable 10 m', 2],
      ['HDMI Cable 3 m', 11],
      ['HDMI Cable 1 m', 1],
    ]);
    expect(file.items.reduce((sum, item) => sum + item.qty, 0)).toBe(108);
  });

  it('files every item under a type the seed writes', () => {
    for (const item of file.items) expect(IT_CONSUMABLE_TYPE_CODES).toContain(item.type);
    const byType: Record<string, number> = {};
    for (const item of file.items) byType[item.type] = (byType[item.type] ?? 0) + 1;
    expect(byType).toEqual({ storage: 1, memory: 1, keyboards: 1, mice: 1, cables: 6 });
  });

  it('counts in pieces, and says where the counts came from', () => {
    expect(new Set(file.items.map((item) => item.unit))).toEqual(new Set(['قطعة']));
    expect(file.source).toContain('جرد الأجهزة');
  });
});

describe('a row keeps the register’s rules', () => {
  const item = (over: Partial<ConsumableOpeningItem>): ConsumableOpeningItem => ({
    key: 'جرد الأجهزة — Mouse',
    name: 'Mouse',
    type: 'mice',
    unit: 'قطعة',
    qty: 13,
    ...over,
  });
  const accepts = (items: unknown[], over: Record<string, unknown> = {}) =>
    ConsumablesOpeningFileSchema.safeParse({
      source: 'test',
      branch: 'المهندسين',
      items,
      ...over,
    }).success;

  it('takes a reviewed row', () => {
    expect(accepts([item({}), item({ key: 'b', name: 'Keyboard', type: 'keyboards' })])).toBe(true);
  });

  it('refuses a repeated key, and one item counted twice however its name is written', () => {
    expect(accepts([item({}), item({ name: 'Keyboard' })])).toBe(false);
    expect(accepts([item({}), item({ key: 'b', name: 'mouse' })])).toBe(false);
    expect(
      accepts([
        item({ name: 'Patch Cord 1 m' }),
        item({ key: 'b', name: 'Patch Cord 1m', type: 'cables' }),
      ]),
    ).toBe(false);
  });

  it('refuses a type the seed does not write, and a count that is not a whole number of units', () => {
    expect(accepts([item({ type: 'toner' as never })])).toBe(false);
    expect(accepts([item({ qty: 0 })])).toBe(false);
    expect(accepts([item({ qty: -3 })])).toBe(false);
    expect(accepts([item({ qty: 1.5 })])).toBe(false);
  });

  it('refuses a store the go-live cannot find, and anything the review did not settle', () => {
    expect(accepts([item({})], { branch: 'القاهرة' })).toBe(false);
    expect(accepts([item({})], { source: ' ' })).toBe(false);
    expect(accepts([{ ...item({}), minQty: 2 }])).toBe(false);
    expect(accepts([])).toBe(false);
  });
});

describe('an item the store already keeps is that item', () => {
  const live = (id: string, name: string): LiveStoreItem => ({
    id,
    code: `CON-0000${id}`,
    name,
    active: true,
  });
  const row = (key: string, name: string): ConsumableOpeningItem => ({
    key,
    name,
    type: 'cables',
    unit: 'قطعة',
    qty: 1,
  });

  it('by the exact name first, then however it is written, the earliest added first', () => {
    const matches = matchStoreItems(
      [row('a', 'Mouse'), row('b', 'HDMI Cable 3 m'), row('c', 'SSD')],
      [
        live('1', 'mouse'),
        live('2', 'Mouse'),
        live('3', 'hdmi cable 3m'),
        live('4', 'HDMI CABLE 3 M'),
      ],
    );
    expect(matches.get('a')?.id).toBe('2');
    expect(matches.get('b')?.id).toBe('3');
    expect(matches.get('c')).toBeNull();
  });

  it('never takes another item for it', () => {
    const matches = matchStoreItems(
      [row('a', 'HDMI Cable 1 m'), row('b', 'Patch Cord 3 m')],
      [live('1', 'HDMI Cable 10 m'), live('2', 'Patch Cord 1 m')],
    );
    expect(matches.get('a')).toBeNull();
    expect(matches.get('b')).toBeNull();
  });
});
