// «فى الحركه اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت … و زرار لو اخترت اكتر من حاجة
// امسح كله مره واحده».
//
// A filter of «الكل» and two choices stays a plain dropdown; one with three choices or more is a
// MultiSelect with a clear-all. This fails on a Fleet filter bar that goes back — or a new screen
// that starts — with a single-choice dropdown of four options or more.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const code = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Fleet screens (not specs) whose source matches `pattern`; grep's «no match» is an answer. */
const grep = (pattern: string): string[] => {
  const run = spawnSync('grep', ['-rlE', pattern, 'modules/fleet'], { cwd: SRC, encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  return run.stdout
    .split('\n')
    .filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'))
    .sort();
};

/** Each single-choice dropdown with an «all» option, and how many options it lists by hand. */
const allDropdowns = (source: string): { at: number; options: number }[] => {
  const found: { at: number; options: number }[] = [];
  let at = source.indexOf('<Select');
  while (at !== -1) {
    const end = source.indexOf('</Select>', at);
    const block = source.slice(at, end);
    if (/<option value="">/u.test(block)) {
      found.push({ at, options: block.match(/<option\b/gu)?.length ?? 0 });
    }
    at = source.indexOf('<Select', end);
  }
  return found;
};

describe('a Fleet status filter with three choices or more takes several', () => {
  it('no Fleet filter is a single-choice dropdown of «all» and three choices or more', () => {
    const offenders = grep('<Select\\b').flatMap((file) =>
      allDropdowns(code(file))
        .filter((dropdown) => dropdown.options > 3)
        .map((dropdown) => `${file} (${dropdown.options} options)`),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['modules/fleet/pages/CustodyPage.tsx', 'source', 'FLEET_CUSTODY_SOURCES'],
    ['modules/fleet/pages/FuelChargingPage.tsx', 'state', 'CHARGING_STATES'],
    ['modules/fleet/pages/ReceiptsPage.tsx', 'kind', 'FLEET_RECEIPT_KINDS'],
  ])('%s: «%s» is a clearable multi-select over every choice', (file, param, list) => {
    const source = code(file);
    const at = source.indexOf(`patch({ ${param}: next.length === 0 ? null : next.join(',') })`);
    expect(at, 'the choice is written as a list').toBeGreaterThan(-1);
    const box = source.slice(source.lastIndexOf('<MultiSelect', at), at);
    expect(box, 'with the clear-all').toMatch(/\bclearable\b/u);
    expect(box, 'offering every choice').toContain(`${list}.map(`);
  });
});
