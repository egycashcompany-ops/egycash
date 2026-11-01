// The consumables' types reach the company by DEPLOYING — the caller is what is guarded here, with
// the list the owner approved and how a type the catalog already holds is recognised. The writing
// itself is proved against a real mongo in `tests/integration/it-go-live-consumable-types.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IT_CATALOG_KINDS } from '@ecms/contracts';
import {
  IT_CONSUMABLE_TYPE_CODES,
  IT_CONSUMABLE_TYPE_NAMES,
  consumableTypeSortOrder,
  matchConsumableTypes,
  type LiveConsumableType,
} from './consumable-type-defaults';
import { IT_CONSUMABLE_TYPES_MARK } from './consumable-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the consumable types are seeded by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it', (file) => {
    expect(code(file)).toContain('startItConsumableTypesGoLive();');
  });

  it('runs once per version of the list', () => {
    expect(IT_CONSUMABLE_TYPES_MARK).toBe('go-live:it-consumable-types:v1');
    expect(IT_CONSUMABLE_TYPES_MARK).toMatch(/:v\d+$/u);
  });

  it('writes the kind the catalog took for them', () => {
    expect(IT_CATALOG_KINDS).toContain('consumableType');
    expect(code('src/modules/it/go-live/consumable-types.ts')).toContain("kind: 'consumableType'");
  });
});

describe('the list the owner approved', () => {
  it('holds his nine types, by code, in his order', () => {
    expect(
      IT_CONSUMABLE_TYPE_CODES.map((type) => [
        type,
        IT_CONSUMABLE_TYPE_NAMES[type].ar,
        IT_CONSUMABLE_TYPE_NAMES[type].en,
      ]),
    ).toEqual([
      ['ink', 'حبارات', 'Ink & toner'],
      ['cables', 'كابلات', 'Cables'],
      ['adapters', 'محولات', 'Adapters'],
      ['mice', 'ماوس', 'Mice'],
      ['keyboards', 'كيبورد', 'Keyboards'],
      ['memory', 'رامات', 'Memory (RAM)'],
      ['storage', 'هاردات', 'Storage drives'],
      ['flash', 'فلاشات', 'Flash drives'],
      ['other', 'أخرى', 'Other'],
    ]);
  });

  it('lists them in that order, «أخرى» last, with room between two for the IT team’s own', () => {
    const orders = IT_CONSUMABLE_TYPE_CODES.map(consumableTypeSortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    expect(Math.max(...orders)).toBe(consumableTypeSortOrder('other'));
    // Above the catalog's default of 0, and spaced: a type slotted between two needs no renumbering.
    expect(Math.min(...orders)).toBeGreaterThan(1);
    orders.slice(1).forEach((order, index) => {
      expect(order - (orders[index] as number)).toBeGreaterThan(1);
    });
  });
});

describe('a type the catalog already holds is not seeded twice', () => {
  let ids = 0;
  const live = (over: Partial<LiveConsumableType>): LiveConsumableType => {
    ids += 1;
    return {
      id: `type-${String(ids)}`,
      code: null,
      name: { ar: `نوع ${String(ids)}`, en: `Type ${String(ids)}` },
      isActive: true,
      ...over,
    };
  };

  it('finds nothing in an empty catalog — every type is missing', () => {
    const matches = matchConsumableTypes([]);
    expect([...matches.keys()]).toEqual([...IT_CONSUMABLE_TYPE_CODES]);
    for (const [, match] of matches) expect(match.kind).toBe('missing');
  });

  it('recognises it by its code or by its Arabic name, however either is written', () => {
    const coded = live({ code: ' Cables ' });
    const named = live({ name: { ar: 'محوّلات', en: 'Converters' } });
    const matches = matchConsumableTypes([coded, named]);
    expect(matches.get('cables')).toEqual({ kind: 'found', type: coded, by: 'code' });
    expect(matches.get('adapters')).toEqual({ kind: 'found', type: named, by: 'name' });
    expect(matches.get('mice')).toEqual({ kind: 'missing' });
  });

  it('takes an active row before a retired one, the code before the name, the oldest first', () => {
    const retiredCode = live({ code: 'ink', isActive: false });
    const activeName = live({ name: { ar: 'حبارات', en: 'Toner' } });
    const first = live({ code: 'mice' });
    const second = live({ code: 'MICE' });
    const byName = live({ name: { ar: 'ماوس', en: 'Mouse' } });
    const matches = matchConsumableTypes([retiredCode, activeName, first, second, byName]);
    expect(matches.get('ink')).toEqual({ kind: 'found', type: activeName, by: 'name' });
    expect(matches.get('mice')).toEqual({ kind: 'found', type: first, by: 'code' });
  });

  it('reports a retired type as retired — never passed over for a twin beside it', () => {
    const retired = live({ name: { ar: 'فلاشات', en: 'USB' }, isActive: false });
    expect(matchConsumableTypes([retired]).get('flash')).toEqual({
      kind: 'inactive',
      type: retired,
      by: 'name',
    });
  });
});
