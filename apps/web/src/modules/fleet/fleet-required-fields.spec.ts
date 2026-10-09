// «كل شاشات الحركة … لو هو بيملى بيضيف داتا او بيعدل وفى قيم اجبارى … وداس على حفظ او تعديل وهو مش
// كاتبها يجيلوا مسدج انه فى كذا وكذا وكذا المفروض يدخلهم والخانات نفسها تتقلب باللون الاحمر».
//
// Every Fleet form that has required values goes through `useRequiredFields`: Save stays pressable,
// a press with something missing shows the banner and marks the fields. This pins which forms do,
// and fails on a form that goes back to a silent disabled Save — or a new one that starts with it.
// The behaviour itself is tested in `shared/ui/required-fields.spec.tsx`.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

/** Comments explain the rule; they must not be able to satisfy it. */
const code = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

/** The Fleet screens (not specs) whose source matches `pattern`; grep's «no match» is an answer. */
const grep = (pattern: string): string[] => {
  const run = spawnSync('grep', ['-rlE', pattern, 'modules/fleet'], { cwd: SRC, encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  return run.stdout
    .split('\n')
    .filter((file) => file.endsWith('.tsx') && !file.includes('.spec.'))
    .sort();
};

/** How many forms each file holds — each one a rule list, a guarded Save and a banner. */
const FORMS: Record<string, number> = {
  'modules/fleet/components/AccidentFormDialog.tsx': 1,
  // Catalog item, vehicle type.
  'modules/fleet/components/CatalogDialogs.tsx': 2,
  // The company statement entry bar.
  'modules/fleet/components/CompanyViolationsPanel.tsx': 1,
  'modules/fleet/components/CorrectOdometerDialog.tsx': 1,
  'modules/fleet/components/DealershipInvoiceDialog.tsx': 1,
  // The drivers' counting bar and its cards.
  'modules/fleet/components/DriverViolationsPanel.tsx': 1,
  'modules/fleet/components/FuelCardDialog.tsx': 1,
  'modules/fleet/components/FuelTransferDialog.tsx': 1,
  // Check-in, check-out, edit.
  'modules/fleet/components/MaintenanceDialogs.tsx': 3,
  'modules/fleet/components/ReceiptDialog.tsx': 1,
  'modules/fleet/components/RecordOdometerDialog.tsx': 1,
  'modules/fleet/components/UnavailabilityDialog.tsx': 1,
  'modules/fleet/components/VehicleFormDialog.tsx': 1,
  'modules/fleet/components/VehicleStatusDialog.tsx': 1,
  // Company row, driver fine, grievance.
  'modules/fleet/components/ViolationDialogs.tsx': 3,
  // The values card.
  'modules/fleet/pages/FleetSettingsPage.tsx': 1,
};

const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;

/**
 * Each `useRequiredFields([...])` call: its argument text, parentheses balanced, and the form that
 * OWNS it — the source from that call to the next one. A file holding several dialogs (check-in,
 * check-out and edit; a catalog item and a vehicle type) lists the same key in each, and a mark
 * dropped from one must not be covered by its neighbour's.
 */
const ruleLists = (source: string): { list: string; owner: string }[] => {
  const starts: number[] = [];
  let at = source.indexOf('useRequiredFields(');
  while (at !== -1) {
    starts.push(at);
    at = source.indexOf('useRequiredFields(', at + 1);
  }
  return starts.map((start, index) => {
    let depth = 0;
    let end = start + 'useRequiredFields'.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      if (depth === 0) break;
    }
    return {
      list: source.slice(start, end + 1),
      owner: source.slice(start, starts[index + 1] ?? source.length),
    };
  });
};

/**
 * Every `<Button …>` opening tag in a file — and every raw `<button …>`, which a form drawn to the
 * owner's own design (the fuel card form) uses for its Save, and every `<DesignSave …>`, the same
 * design's Save shared by the forms drawn in it since — braces balanced so a `>` inside `{…}` does
 * not end it.
 */
const buttonTags = (source: string): string[] => {
  const tags: string[] = [];
  const next = (from: number): number => {
    const found = ['<Button', '<button', '<DesignSave']
      .map((tag) => source.indexOf(tag, from))
      .filter((index) => index !== -1);
    return found.length === 0 ? -1 : Math.min(...found);
  };
  let at = next(0);
  while (at !== -1) {
    let depth = 0;
    let end = at;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
      if (source[end] === '>' && depth === 0) break;
    }
    tags.push(source.slice(at, end + 1));
    at = next(end);
  }
  return tags;
};

/**
 * The only `disabled` a guarded Save may carry: a permission the reader lacks, or nothing changed
 * to save — neither is a missing value, and neither is what the press is meant to explain.
 */
const ALLOWED_DISABLED = new Set(['disabled={!mayRecord}', 'disabled={!anyDirty}']);

describe('every Fleet form with required values names what is missing', () => {
  it.each(Object.entries(FORMS).map(([file, forms]) => ({ file, forms })))(
    '$file: $forms form(s), each with its rules, a guarded Save and the banner',
    ({ file, forms }) => {
      const source = code(file);
      expect(count(source, /\buseRequiredFields\(/gu), 'rule lists').toBe(forms);
      expect(count(source, /\.guard\(/gu), 'guarded saves').toBe(forms);
      expect(count(source, /<MissingFieldsBanner\b/gu), 'banners').toBe(forms);
    },
  );

  it('every required value it lists also turns its own field red — in its own form', () => {
    let checked = 0;
    for (const file of Object.keys(FORMS)) {
      for (const { list, owner } of ruleLists(code(file))) {
        for (const match of list.matchAll(/\bkey: '([A-Za-z]+)'/gu)) {
          const key = match[1] as string;
          expect(owner, `${file}: «${key}» is listed but never marked in its own form`).toContain(
            `isMissing('${key}')`,
          );
          checked += 1;
        }
      }
    }
    // The settings card and the drivers' cards build their keys; every other key is a literal.
    expect(checked, 'the rule lists were actually read').toBeGreaterThan(50);
  });

  it('the table covers every Fleet form that uses the guard', () => {
    expect(grep('useRequiredFields\\(')).toEqual(Object.keys(FORMS).sort());
  });

  /**
   * A Save disabled over a missing value says nothing — the very thing the owner photographed.
   * The one form left with one has nothing a person can fill: the drivers registry's form is all
   * optional («عاوز كل البيانات الموجوده دى اختيارى»), and the employee it is for comes from the row
   * that opened it, never from a box.
   */
  it('no guarded Save is disabled over anything but a permission or «nothing changed»', () => {
    let guarded = 0;
    for (const [file, forms] of Object.entries(FORMS)) {
      const saves = buttonTags(code(file)).filter((tag) => tag.includes('.guard('));
      expect(saves, `${file}: guarded Save buttons`).toHaveLength(forms);
      for (const tag of saves) {
        for (const match of tag.matchAll(/disabled=\{[^}]*\}/gu)) {
          expect(ALLOWED_DISABLED.has(match[0]), `${file}: ${match[0]} on a guarded Save`).toBe(
            true,
          );
        }
        guarded += 1;
      }
    }
    expect(guarded).toBe(Object.values(FORMS).reduce((sum, forms) => sum + forms, 0));
  });

  it('no Fleet Save that skips the guard is disabled — bar the all-optional drivers form', () => {
    // A Save that calls its submit directly AND is disabled is a silent one: the press says nothing.
    // The drivers registry's form is the one exception: nothing on it is required («عاوز كل
    // البيانات الموجوده دى اختيارى»), and the employee it is for comes from the row, not a box.
    const silent = grep('<Button')
      .filter((file) =>
        buttonTags(code(file)).some(
          (tag) =>
            /onClick=\{\(\) => void (submit|save)\(\)\}/u.test(tag) && /\bdisabled=\{/u.test(tag),
        ),
      )
      .sort();
    expect(silent).toEqual(['modules/fleet/components/DriverFormDialog.tsx']);
  });
});
