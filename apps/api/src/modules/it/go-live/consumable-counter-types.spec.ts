// «حبارات» is given the printer's counter by DEPLOYING — the caller is what is guarded here: both
// processes start the step, after the types it ticks, under a versioned key. The tick itself is
// proved against a real mongo in `tests/integration/it-go-live-consumable-counter-types.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IT_CONSUMABLE_COUNTER_TYPES_MARK } from './consumable-counter-types';
import { IT_CONSUMABLE_TYPES_MARK } from './consumable-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('«حبارات» takes the printer counter by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it, after the types it ticks', (file) => {
    const source = code(file);
    const types = source.indexOf('startItConsumableTypesGoLive();');
    const counter = source.indexOf('startItConsumableCounterTypesGoLive();');
    expect(types).toBeGreaterThan(-1);
    expect(counter).toBeGreaterThan(types);
  });

  it('runs once per version of the list — its own key, not the types’ seed', () => {
    expect(IT_CONSUMABLE_COUNTER_TYPES_MARK).toBe('go-live:it-consumable-counter-types:v1');
    expect(IT_CONSUMABLE_COUNTER_TYPES_MARK).toMatch(/:v\d+$/u);
    expect(IT_CONSUMABLE_COUNTER_TYPES_MARK).not.toBe(IT_CONSUMABLE_TYPES_MARK);
  });

  it('waits for this boot’s seeding of the types before it asks for them', () => {
    const source = code('src/modules/it/go-live/consumable-counter-types.ts');
    const run = source.slice(source.indexOf('export const runItConsumableCounterTypesGoLive'));
    expect(run.indexOf('await itConsumableTypesSettled();')).toBeGreaterThan(-1);
    expect(run.indexOf('await itConsumableTypesSettled();')).toBeLessThan(
      run.indexOf('await flagItConsumableCounterTypes();'),
    );
  });
});
