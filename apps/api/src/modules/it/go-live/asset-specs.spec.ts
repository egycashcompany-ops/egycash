// The devices' specifications reach the company by DEPLOYING, and what they add is the reviewed
// file — the file is held to the owner's review here («موافق على كل اقتراحاتك، طبّق الأربعة»), with
// the deploy's caller and the rule «وتزودها»: added where the device has none, never overwritten.
// The writing itself is proved against a real mongo in
// `tests/integration/it-go-live-asset-specs.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AssetSpecsFileSchema,
  filledSpecs,
  parseAssetSpecs,
  planAssetSpecs,
  sameSpec,
  targetSerial,
  type AssetSpecsFile,
  type AssetSpecsRow,
  type RegisterDevice,
} from './asset-specs-import';
import {
  ASSET_SPECS_FILE,
  IT_ASSET_SPECS_MARK,
  resolveAssetSpecsFile,
  specsHistoryNote,
} from './asset-specs';
import { parseInventory } from './inventory-import';
import { resolveInventoryFile } from './inventory';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const raw = (): string => {
  const file = resolveAssetSpecsFile();
  if (file === null) throw new Error(`${ASSET_SPECS_FILE} is not where the go-live looks`);
  return readFileSync(file, 'utf8');
};

const committed = (): AssetSpecsFile => parseAssetSpecs(JSON.parse(raw()));

describe('the devices’ specifications are added by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItAssetSpecsGoLive();');
  });

  it('runs once per version of the file', () => {
    expect(IT_ASSET_SPECS_MARK).toBe('go-live:it-asset-specs-2026-10:v1');
    expect(IT_ASSET_SPECS_MARK).toMatch(/:v\d+$/u);
  });

  it('waits for the inventory, which registered the devices', () => {
    expect(code('src/modules/it/go-live/asset-specs.ts')).toContain(
      'isItGoLiveRunDone(IT_INVENTORY_MARK)',
    );
  });

  it('writes each device only as it was read, inside one transaction', () => {
    const source = code('src/modules/it/go-live/asset-specs.ts');
    expect(source).toContain('...versionOf(row)');
    expect(source).toContain('$inc: { __v: 1 }');
  });
});

describe('the committed file is the reviewed one', () => {
  const { devices } = committed();

  it('holds the 38 devices of the sheet the register has', () => {
    expect(devices).toHaveLength(38);
    // Every one of them on the register as the inventory registered it — under its own spelling.
    const file = resolveInventoryFile();
    if (file === null) throw new Error('the inventory file is not where the go-live looks');
    const registered = new Set(
      parseInventory(JSON.parse(readFileSync(file, 'utf8'))).devices.flatMap(
        (device) => device.serial?.toUpperCase() ?? [],
      ),
    );
    expect(devices.filter((row) => !registered.has(targetSerial(row).toUpperCase()))).toEqual([]);
  });

  it('looks for the four the sheet mistyped under the register’s spelling — and only those', () => {
    const corrected = Object.fromEntries(
      devices.flatMap((row) =>
        row.registerSerial === null ? [] : [[row.serial, row.registerSerial]],
      ),
    );
    expect(corrected).toEqual({
      JSJSZXMS3: 'JSZXMS3',
      JZ24WF3: 'JZ24VF3',
      '8VPL8F3': 'BVPL8F3',
      '8WVGNQT3': '8WVGNJ3',
    });
  });

  it('writes each value one way', () => {
    const values = (pick: (row: AssetSpecsRow) => string) => [...new Set(devices.map(pick))].sort();
    expect(values((row) => row.processor)).toEqual(['Intel Core i5', 'Intel Core i7']);
    expect(values((row) => row.memory)).toEqual(['12 GB', '16 GB', '8 GB']);
    expect(values((row) => row.storage)).toEqual(['HDD', 'SSD']);
  });

  // The sheet says whose desk and which department; none of it travels.
  it('carries the device and nothing else — no employee, department or national ID', () => {
    expect(raw()).not.toMatch(/\b[23]\d{13}\b/u);
    for (const row of devices) {
      expect(Object.keys(row).sort()).toEqual([
        'key',
        'memory',
        'processor',
        'registerSerial',
        'serial',
        'storage',
      ]);
      expect(row.key).toMatch(/^جرد الأجهزة صف \d+$/u);
      // Nothing in Arabic but the row's key: a name or a department would be.
      for (const value of [
        row.serial,
        row.registerSerial ?? '',
        row.processor,
        row.memory,
        row.storage,
      ]) {
        expect(value).toMatch(/^[A-Za-z0-9 ]*$/u);
      }
    }
  });
});

describe('a file keeps the register’s rules', () => {
  const row = (over: Partial<AssetSpecsRow>): AssetSpecsRow => ({
    key: 'جرد الأجهزة صف 2',
    serial: 'B6K1QD3',
    registerSerial: null,
    processor: 'Intel Core i7',
    memory: '8 GB',
    storage: 'SSD',
    ...over,
  });
  const accepts = (devices: AssetSpecsRow[]) =>
    AssetSpecsFileSchema.safeParse({ source: 'test', devices }).success;

  it('refuses a repeated row, or two rows for one device', () => {
    expect(accepts([row({}), row({ key: 'b', serial: 'DQ8L933' })])).toBe(true);
    expect(accepts([row({}), row({ serial: 'DQ8L933' })])).toBe(false);
    expect(accepts([row({}), row({ key: 'b', serial: 'b6k1qd3' })])).toBe(false);
    expect(accepts([row({}), row({ key: 'b', serial: 'X', registerSerial: 'B6K1QD3' })])).toBe(
      false,
    );
  });

  it('refuses a correction that changes nothing', () => {
    expect(accepts([row({ registerSerial: 'b6k1qd3' })])).toBe(false);
  });
});

describe('«وتزودها» — added where the device has none, never overwritten', () => {
  const row = (serial: string, over: Partial<AssetSpecsRow> = {}): AssetSpecsRow => ({
    key: `row ${serial}`,
    serial,
    registerSerial: null,
    processor: 'Intel Core i7',
    memory: '8 GB',
    storage: 'SSD',
    ...over,
  });
  const device = (
    serialNumber: string,
    specs: NonNullable<RegisterDevice['specs']> | null,
  ): RegisterDevice => ({
    id: serialNumber,
    assetCode: `AST-${serialNumber}`,
    serialNumber,
    specs,
  });

  it('fills every row of a device that has no specifications at all', () => {
    const [decision] = planAssetSpecs([row('B6K1QD3')], [device('B6K1QD3', null)]);
    expect(decision).toMatchObject({
      kind: 'found',
      fill: { processor: 'Intel Core i7', memory: '8 GB', storage: 'SSD' },
      kept: [],
    });
  });

  it('keeps a typed value, reporting it only when the sheet disagrees', () => {
    const typed = device('DQ8L933', { processor: 'Intel Core i5', memory: '  ', storage: 'ssd' });
    const [decision] = planAssetSpecs([row('DQ8L933')], [typed]);
    expect(decision).toMatchObject({
      kind: 'found',
      fill: { memory: '8 GB' },
      kept: [
        {
          key: 'row DQ8L933',
          assetCode: 'AST-DQ8L933',
          field: 'processor',
          kept: 'Intel Core i5',
          sheet: 'Intel Core i7',
        },
      ],
    });
    expect(decision?.kind === 'found' ? Object.keys(decision.fill) : []).toEqual(['memory']);
  });

  it('reads two spellings of one value as one', () => {
    expect(sameSpec('8GB', '8 GB')).toBe(true);
    expect(sameSpec('intel core i7', 'Intel Core i7')).toBe(true);
    expect(sameSpec('Core i7', 'Intel Core i7')).toBe(false);
  });

  it('finds a device without case, under the register’s spelling of a mistyped serial', () => {
    const decisions = planAssetSpecs(
      [row('4S58033'), row('JSJSZXMS3', { registerSerial: 'JSZXMS3' })],
      [device('4s58033', null), device('JSZXMS3', null), device('JSJSZXMS3', null)],
    );
    expect(decisions.map((d) => (d.kind === 'found' ? d.device.assetCode : d.kind))).toEqual([
      'AST-4s58033',
      'AST-JSZXMS3',
    ]);
  });

  it('reports a serial the register does not hold, and never guesses between two', () => {
    const decisions = planAssetSpecs(
      [row('NOPE123'), row('AB12345')],
      [device('AB12345', null), device('ab12345', null)],
    );
    expect(decisions.map((d) => d.kind)).toEqual(['notFound', 'ambiguous']);
    expect(decisions[1]).toMatchObject({ assetCodes: ['AST-AB12345', 'AST-ab12345'] });
  });

  it('leaves every other row of the table as it was, and makes the table when there is none', () => {
    const current = {
      processor: 'Intel Core i5',
      memory: null,
      systemType: '64-bit',
      storage: null,
      mediaDrive: null,
      displayAdapter: 'Intel UHD Graphics',
      graphicsMemory: null,
      networkAdapters: ['Intel Ethernet I219-LM'],
    };
    expect(filledSpecs(current, { memory: '8 GB', storage: 'SSD' })).toEqual({
      ...current,
      memory: '8 GB',
      storage: 'SSD',
    });
    expect(filledSpecs(undefined, { processor: 'Intel Core i7' })).toEqual({
      processor: 'Intel Core i7',
      memory: null,
      systemType: null,
      storage: null,
      mediaDrive: null,
      displayAdapter: null,
      graphicsMemory: null,
      networkAdapters: [],
    });
  });

  it('names the rows it filled in the device’s history, as the asset screen names them', () => {
    expect(specsHistoryNote(['processor', 'memory', 'storage'])).toBe(
      'أُضيفت المواصفات من ملف «جرد الأجهزة» — أكتوبر 2026: المعالج، إجمالي ذاكرة النظام، إجمالي سعة الأقراص الصلبة',
    );
  });
});
