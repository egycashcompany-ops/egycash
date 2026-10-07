// The IT inventory reaches the company by DEPLOYING, and what it writes is the reviewed file — the
// file is held to the review here, the deploy's caller like the asset restart's, and the matching
// of branches and categories on spellings. The writing itself is proved against a real mongo in
// `tests/integration/it-go-live-inventory.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  foldName,
  matchBranches,
  matchCategories,
  parseInventory,
  type InventoryFile,
  type LiveBranch,
} from './inventory-import';
import { INVENTORY_FILE, resolveInventoryFile } from './inventory';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const committed = (): InventoryFile => {
  const file = resolveInventoryFile();
  if (file === null) throw new Error(`${INVENTORY_FILE} is not where the go-live looks`);
  return parseInventory(JSON.parse(readFileSync(file, 'utf8')));
};

describe('the inventory is imported by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItInventoryGoLive();');
  });

  it('waits for the asset restart, which would otherwise delete what it wrote', () => {
    const source = code('src/modules/it/go-live/inventory.ts');
    expect(source).toContain('isItGoLiveRunDone(IT_ASSET_RESTART_MARK, session)');
  });
});

describe('the committed file is the reviewed one', () => {
  const { devices } = committed();
  const count = (pick: (d: (typeof devices)[number]) => boolean) => devices.filter(pick).length;

  it('holds every device of the ten sheets, each in its branch', () => {
    expect(devices).toHaveLength(454);
    const byBranch = Object.fromEntries(
      [...new Set(devices.map((d) => d.branch))].map((b) => [b, count((d) => d.branch === b)]),
    );
    expect(byBranch).toEqual({
      المهندسين: 254,
      أسيوط: 31,
      طنطا: 35,
      الإسكندرية: 29,
      بورسعيد: 35,
      // «وصال هو فرع الشروق فعلاً».
      الشروق: 20,
      أكتوبر: 50,
    });
  });

  it('hands over only what the review settled: 170 head-office devices to 57 employees', () => {
    const handed = devices.filter((d) => d.holderCode !== null);
    expect(handed).toHaveLength(170);
    expect(new Set(handed.map((d) => d.holderCode)).size).toBe(57);
    expect(handed.every((d) => d.branch === 'المهندسين')).toBe(true);
    // The IT store is never handed to anybody.
    expect(handed.some((d) => d.holder?.includes('مخزن'))).toBe(false);
  });

  it('leaves the unsettled holders in stock, saying who the sheet had them with', () => {
    const unsettled = devices.find((d) => d.key === 'HQ PC#57'); // عقيد/تامر محمد — unconfirmed
    expect(unsettled?.holderCode).toBeNull();
    expect(unsettled?.notes).toContain('في الجرد مع: عقيد/تامر محمد');
    const branch = devices.find((d) => d.key === 'Tanta#3');
    expect(branch?.holderCode).toBeNull();
    expect(branch?.notes).toContain('في الجرد مع: خالد عثمان');
  });

  it('gives a repeated serial to one device only, and the other none', () => {
    const serials = devices.flatMap((d) => d.serial ?? []);
    expect(new Set(serials).size).toBe(serials.length);
    for (const key of ['HQ PC#132', 'IP Phone#29', 'IP Phone#57', 'Wesal#23']) {
      expect(devices.find((d) => d.key === key)?.serial).toBeNull();
    }
    expect(count((d) => d.serial === null)).toBe(5);
  });

  it('carries codes from HR and nothing else — no national ID is in the file', () => {
    const raw = readFileSync(resolveInventoryFile() ?? '', 'utf8');
    expect(raw).not.toMatch(/\b[23]\d{13}\b/u);
  });

  it('files the kinds the sheets hold', () => {
    const kinds = Object.fromEntries(
      [...new Set(devices.map((d) => d.category))].map((k) => [k, count((d) => d.category === k)]),
    );
    expect(kinds).toEqual({
      desktop: 166,
      allInOne: 2,
      screen: 147,
      laptop: 28,
      ipPhone: 63,
      printer: 48,
    });
  });
});

describe('branches are found by their spellings, never created', () => {
  const live = (ar: string, status: LiveBranch['status'] = 'active'): LiveBranch => ({
    id: ar,
    name: { ar, en: ar },
    status,
  });

  it('folds hamza, taa marbuta and spacing', () => {
    expect(foldName('الأسكندرية')).toBe(foldName('الاسكندرية'));
    expect(foldName('لاب توب')).toBe(foldName('لابتوب'));
    expect(foldName('شاشة')).toBe(foldName('شاشه'));
  });

  it('finds every branch the sheets name, by any of its spellings', () => {
    const matches = matchBranches([
      live('المهندسين'),
      live('طنطا'),
      live('الاسكندرية'),
      live('اسيوط'),
      live('بور سعيد'),
      live('وصال'),
      live('6 أكتوبر'),
    ]);
    for (const [, match] of matches) expect(match.kind).toBe('found');
  });

  it('refuses a branch that is missing, retired or named twice', () => {
    const matches = matchBranches([live('طنطا', 'inactive'), live('الشروق'), live('وصال')]);
    expect(matches.get('المهندسين')?.kind).toBe('missing');
    expect(matches.get('طنطا')?.kind).toBe('inactive');
    expect(matches.get('الشروق')?.kind).toBe('ambiguous');
  });
});

describe('categories are the IT team’s own where they have one', () => {
  it('takes an existing category by any of its names, an active one first', () => {
    const matches = matchCategories([
      { id: 'aio', name: { ar: 'كمبيوتر All', en: 'AIO' }, isActive: true },
      { id: 'old-screen', name: { ar: 'شاشات', en: 'Screens' }, isActive: false },
      { id: 'screen', name: { ar: 'شاشه', en: 'Monitor' }, isActive: true },
    ]);
    expect(matches.get('allInOne')?.id).toBe('aio');
    expect(matches.get('screen')?.id).toBe('screen');
    expect(matches.get('laptop')).toBeNull();
    expect(matches.get('desktop')).toBeNull();
  });
});
