// The October all-in-ones reach the company by DEPLOYING, and what they write is the reviewed file —
// the file is held to the owner's review here («موافق على كل اقتراحاتك، طبّق الأربعة»), with the
// deploy's caller, the device the copies are made from and the category they fall back to. The
// writing itself is proved against a real mongo in `tests/integration/it-go-live-aio-october.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AioOctoberFileSchema,
  copySpecs,
  hasSpecs,
  inventoryCategoryFor,
  parseAioOctober,
  pickTemplate,
  type AioOctoberFile,
} from './aio-october-import';
import { AIO_OCTOBER_FILE, IT_AIO_OCTOBER_MARK, resolveAioOctoberFile } from './aio-october';
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
  const file = resolveAioOctoberFile();
  if (file === null) throw new Error(`${AIO_OCTOBER_FILE} is not where the go-live looks`);
  return readFileSync(file, 'utf8');
};

const committed = (): AioOctoberFile => parseAioOctober(JSON.parse(raw()));

/** The serials the inventory registered — the register the October batch is added to. */
const inventorySerials = (): Set<string> => {
  const file = resolveInventoryFile();
  if (file === null) throw new Error('the inventory file is not where the go-live looks');
  const { devices } = parseInventory(JSON.parse(readFileSync(file, 'utf8')));
  return new Set(devices.flatMap((device) => device.serial?.toUpperCase() ?? []));
};

describe('the October all-in-ones are registered by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItAioOctoberGoLive();');
  });

  it('runs once per version of the file', () => {
    expect(IT_AIO_OCTOBER_MARK).toBe('go-live:it-aio-october-2026-10:v1');
    expect(IT_AIO_OCTOBER_MARK).toMatch(/:v\d+$/u);
  });

  it('waits for the inventory, whose device it copies and whose category it falls back to', () => {
    expect(code('src/modules/it/go-live/aio-october.ts')).toContain(
      'isItGoLiveRunDone(IT_INVENTORY_MARK)',
    );
  });
});

describe('the committed file is the reviewed one', () => {
  const file = committed();
  const serials = file.devices.map((device) => device.serial);

  it('holds the 97 devices the review kept, of the sheet’s 100 rows', () => {
    expect(file.devices).toHaveLength(97);
    // Rows 60 and 68 are the head office's two; row 71, a short scan, is row 62's device scanned
    // again — the owner read it off the device as MP30EPD8. The three left out.
    const rows = file.devices.map((device) => Number(device.key.replace(/^SN ايجي كاش صف /u, '')));
    const missing = Array.from({ length: 100 }, (_, index) => index + 1).filter(
      (row) => !rows.includes(row),
    );
    expect(missing).toEqual([60, 68, 71]);
  });

  it('gives every device its own 8-character serial, without the barcode’s «S»', () => {
    expect(new Set(serials).size).toBe(97);
    for (const serial of serials) {
      expect(serial).toMatch(/^[A-Z0-9]{8}$/u);
      expect(serial.startsWith('S')).toBe(false);
    }
  });

  it('leaves the head office’s two as the inventory registered them, and row 71’s short scan out', () => {
    const headOffice = ['MP30EPDA', 'MP30EPD2'];
    const registered = inventorySerials();
    // They are the inventory's — already on the register, at the head office.
    for (const serial of headOffice) expect(registered.has(serial)).toBe(true);
    for (const serial of [...headOffice, 'MP30EPD']) expect(serials).not.toContain(serial);
    // «MP30EPD8 فعلاً»: the device row 71 scanned short is row 62's, registered once, from row 62.
    expect(file.devices.filter((device) => device.serial === 'MP30EPD8')).toEqual([
      { key: 'SN ايجي كاش صف 62', serial: 'MP30EPD8' },
    ]);
    // And nothing else of the batch is on the register yet.
    expect(serials.filter((serial) => registered.has(serial))).toEqual([]);
  });

  it('copies the device the owner named, for the October branch', () => {
    expect(file.branch).toBe('أكتوبر');
    expect(file.template).toEqual({
      name: 'Lenovo ThinkCentre neo 50a 24',
      manufacturer: 'Lenovo',
      model: 'ThinkCentre neo 50a 24',
      category: 'allInOne',
    });
  });

  it('names nobody — «ومش متسلم لحد»: a row is its key and its serial', () => {
    expect(raw()).not.toMatch(/\b[23]\d{13}\b/u);
    for (const device of file.devices) {
      expect(Object.keys(device).sort()).toEqual(['key', 'serial']);
      expect(device.key).toMatch(/^SN ايجي كاش صف \d+$/u);
    }
  });
});

describe('a file keeps the register’s rules', () => {
  const accepts = (devices: { key: string; serial: string }[]) =>
    AioOctoberFileSchema.safeParse({
      source: 'test',
      branch: 'أكتوبر',
      template: {
        name: 'Lenovo ThinkCentre neo 50a 24',
        manufacturer: 'Lenovo',
        model: 'ThinkCentre neo 50a 24',
        category: 'allInOne',
      },
      devices,
    }).success;

  it('refuses a repeated row or serial — a serial without case', () => {
    expect(
      accepts([
        { key: 'a', serial: 'MP30EPF4' },
        { key: 'b', serial: 'MP30EPF3' },
      ]),
    ).toBe(true);
    expect(
      accepts([
        { key: 'a', serial: 'MP30EPF4' },
        { key: 'a', serial: 'MP30EPF3' },
      ]),
    ).toBe(false);
    expect(
      accepts([
        { key: 'a', serial: 'MP30EPF4' },
        { key: 'b', serial: 'mp30epf4' },
      ]),
    ).toBe(false);
  });
});

describe('«بنفس مواصفات» — the device the copies are made from', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  const specs = { processor: 'Intel Core i5', memory: null, networkAdapters: [] };

  it('says a device has specifications when one row of the table is filled', () => {
    expect(hasSpecs(null)).toBe(false);
    expect(hasSpecs(undefined)).toBe(false);
    expect(hasSpecs({ processor: null, storage: '  ', networkAdapters: [] })).toBe(false);
    expect(hasSpecs({ storage: 'SSD' })).toBe(true);
    expect(hasSpecs({ networkAdapters: ['Realtek PCIe GbE'] })).toBe(true);
  });

  it('takes the one somebody filled the specifications in on, the latest edited of those', () => {
    const older = { id: 'older', specs, updatedAt: at(5) };
    const newer = { id: 'newer', specs, updatedAt: at(9) };
    const bare = { id: 'bare', specs: null, updatedAt: at(20) };
    expect(pickTemplate([older, bare, newer])?.id).toBe('newer');
  });

  it('takes the latest edited when none has any, and nothing when there is none', () => {
    const first = { id: 'first', specs: null, updatedAt: at(5) };
    const second = { id: 'second', updatedAt: at(9) };
    expect(pickTemplate([first, second])?.id).toBe('second');
    expect(pickTemplate([])).toBeNull();
  });

  // The inventory registered the head office's two in one write: the same moment, every boot.
  it('keeps the order it is given for two edited at the same moment', () => {
    const one = { id: 'one', specs: null, updatedAt: at(7) };
    const two = { id: 'two', specs: null, updatedAt: at(7) };
    expect(pickTemplate([one, two])?.id).toBe('one');
    expect(pickTemplate([two, one])?.id).toBe('two');
  });

  it('copies the table into an object of each copy’s own', () => {
    const template = { ...specs, networkAdapters: ['Realtek PCIe GbE'] };
    const copy = copySpecs(template);
    expect(copy).toEqual({
      processor: 'Intel Core i5',
      memory: null,
      systemType: null,
      storage: null,
      mediaDrive: null,
      displayAdapter: null,
      graphicsMemory: null,
      networkAdapters: ['Realtek PCIe GbE'],
    });
    expect(copy.networkAdapters).not.toBe(template.networkAdapters);
  });
});

describe('without the device on the register, the category the inventory files it under', () => {
  const category = (id: string, ar: string, isActive = true) => ({
    id,
    name: { ar, en: ar },
    isActive,
  });

  it('is the IT team’s all-in-one category when the register has one', () => {
    const live = [category('desktop', 'كمبيوتر مكتبي'), category('aio', 'كمبيوتر All in One')];
    expect(inventoryCategoryFor(live, 'allInOne')?.id).toBe('aio');
  });

  it('is the desktops’ when it has none — the inventory filed its all-in-ones there', () => {
    const live = [category('desktop', 'كمبيوتر مكتبي'), category('screen', 'شاشة')];
    expect(inventoryCategoryFor(live, 'allInOne')?.id).toBe('desktop');
  });

  it('is nothing — and the import refuses — when neither is there', () => {
    expect(inventoryCategoryFor([category('screen', 'شاشة')], 'allInOne')).toBeNull();
  });
});
