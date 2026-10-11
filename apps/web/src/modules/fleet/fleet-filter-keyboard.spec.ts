// «الموشر فى الفلاتر كلها لما اجى انزل بالسعم ل تحت مش بينول عشان اختار» — in ALL the filters.
//
// The arrows, Enter and the caret that stays in the search box live in ONE place, the shared
// `MultiSelect` (its own spec holds the keys). That reaches every Fleet filter only while every
// drop-down on a Fleet filter bar IS that control, or a native `<select>`, which the browser
// already walks with the arrows. A CENSUS, so a new hand-made list on a bar fails here rather than
// shipping without the keyboard.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
/** Source with comments stripped: a tag named only in prose is not a control. */
const code = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The browser's own controls — the arrows already walk a `<select>`. */
const NATIVE = new Set(['Select', 'Input', 'DebouncedInput', 'select', 'input']);
/** Each of these is the shared `MultiSelect`, or a control drawn on it — see the last test. */
const ON_MULTISELECT: Record<string, string> = {
  MultiSelect: 'shared/ui/MultiSelect.tsx',
  VehicleCodeFilter: 'modules/fleet/components/VehicleCodeFilter.tsx',
  DriverPickerFilter: 'modules/fleet/components/DriverPickerFilter.tsx',
  RegistryDriverPicker: 'modules/fleet/components/RegistryDriverPicker.tsx',
  CatalogMultiSelect: 'modules/fleet/components/CatalogMultiSelect.tsx',
  BranchFilterSelect: 'modules/hr/recruitment/shared/BranchFilterSelect.tsx',
};
/** The bar's frame — not drop-downs. `DateBox` holds a date box and its calendar button. */
const FRAME = new Set([
  'FilterBar',
  'FilterWithIcon',
  'FilterField',
  'FilteredCount',
  'ResetIcon',
  'DateBox',
]);

const barFiles = (): string[] =>
  execFileSync('grep', ['-rl', '<FilterBar', 'modules/fleet'], { cwd: SRC, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'))
    .sort();

/** Every tag inside each `<FilterBar …>…</FilterBar>` of a file. */
const barTags = (source: string): string[] => {
  const tags: string[] = [];
  let at = source.indexOf('<FilterBar');
  while (at !== -1) {
    const end = source.indexOf('</FilterBar>', at);
    for (const match of source.slice(at, end).matchAll(/<([A-Z][A-Za-z]*|select|input)\b/gu)) {
      tags.push(match[1]!);
    }
    at = source.indexOf('<FilterBar', end);
  }
  return tags;
};

describe('every drop-down on a Fleet filter bar walks with the arrows', () => {
  it('is the shared MultiSelect (or drawn on it), or a native select', () => {
    const strangers: string[] = [];
    for (const file of barFiles()) {
      for (const tag of barTags(code(file))) {
        if (!NATIVE.has(tag) && !FRAME.has(tag) && !(tag in ON_MULTISELECT)) {
          strangers.push(`${file}: <${tag}>`);
        }
      }
    }
    expect(
      strangers,
      'a control on a Fleet filter bar that is neither MultiSelect nor a native select — draw it on MultiSelect, which carries the keyboard',
    ).toEqual([]);
  });

  it('finds the bars it guards — the census is not vacuous', () => {
    const files = barFiles();
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files).toContain('modules/fleet/pages/MaintenancePage.tsx');
  });

  it.each(Object.entries(ON_MULTISELECT).filter(([tag]) => tag !== 'MultiSelect'))(
    '<%s> is drawn on MultiSelect',
    (_tag, file) => {
      expect(code(file)).toMatch(/<(MultiSelect|DriverPickerFilter)\b/u);
    },
  );

  it('the spare-parts filter is a MultiSelect that empties its box on a pick', () => {
    const page = code('modules/fleet/pages/MaintenancePage.tsx');
    const bar = page.slice(page.indexOf('<FilterBar'), page.indexOf('</FilterBar>'));
    const label = bar.indexOf("t('fleet.maintenance.fields.spareParts')");
    expect(label, 'the bar asks about spare parts').toBeGreaterThan(-1);
    const parts = bar.slice(bar.lastIndexOf('<', label), bar.indexOf('/>', label));
    expect(parts).toMatch(/^<MultiSelect\b/u);
    expect(parts).toContain('clearSearchOnPick');
  });
});
