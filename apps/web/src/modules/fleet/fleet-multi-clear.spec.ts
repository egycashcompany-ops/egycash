// «لما يكون فيه مكان بدخل داتة واقدر اعمل اختيار على اكتر من حاجة اعملى اوبشن ان يكون في حاجة ادوس
// عليها امسح اللى اختارته كله».
//
// A CENSUS over every multi-pick on every Fleet screen, entry and filter alike: each one offers a
// clear-all. `MultiSelect` draws it only when asked (`clearable`), so a new screen that drops a
// multi-select in without asking fails here rather than shipping without one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Every non-spec Fleet file that renders `tag`. */
const filesRendering = (tag: string): string[] =>
  execFileSync('grep', ['-rlE', `<${tag}(\\s|$)`, 'modules/fleet'], { cwd: SRC, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '' && !line.includes('.spec.'));

/** The opening tag of every `<tag …>` in a file, props and all, up to its `>` or `/>`. */
const openingTags = (source: string, tag: string): string[] => {
  const tags: string[] = [];
  const re = new RegExp(`<${tag}(?=\\s)`, 'gu');
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    let depth = 0;
    let end = m.index;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, end + 1));
  }
  return tags;
};

describe('every Fleet multi-pick offers «مسح الكل»', () => {
  it.each(['MultiSelect', 'BranchFilterSelect'])(
    'every <%s> on a Fleet screen is clearable',
    (tag) => {
      const missing: string[] = [];
      for (const file of filesRendering(tag)) {
        for (const open of openingTags(read(file), tag)) {
          if (!/\bclearable\b/u.test(open)) missing.push(`${file}\n    ${open.split('\n')[0]}`);
        }
      }
      expect(
        missing,
        'a Fleet multi-select without `clearable` — pass it, so the reader can clear every pick at once',
      ).toEqual([]);
    },
  );

  it('finds the controls it guards — the census is not vacuous', () => {
    expect(filesRendering('MultiSelect').length).toBeGreaterThanOrEqual(10);
  });

  it('the driver picker is clearable when it picks SEVERAL drivers, not when it picks one', () => {
    expect(read('modules/fleet/components/DriverPickerFilter.tsx')).toContain('clearable = true');
    expect(read('modules/fleet/components/RegistryDriverPicker.tsx')).toContain(
      'clearable={multiple}',
    );
  });

  it('the notice editor’s several-answer checks and the ledger’s ticks clear in one press too', () => {
    expect(read('modules/fleet/pages/NoticeEditorPage.tsx')).toContain('data-notice-check-clear');
    const ledger = read('modules/fleet/components/DriverViolationsPanel.tsx');
    expect(ledger).toContain('data-ledger-clear="true"');
    expect(ledger).toContain('onClick={selection.clear}');
  });
});
