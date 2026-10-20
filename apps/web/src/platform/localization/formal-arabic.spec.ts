// The Arabic the product speaks is formal Arabic — asserted here so `npm run test -w apps/web`
// fails on a colloquial string, not only CI.
//
// The tells themselves live in `scripts/check-formal-arabic.mjs`, which CI runs over the whole
// monorepo: the web dictionary, the sentences the API composes, the permission catalogue, the
// printed forms. They are NOT duplicated here. The first version of this guard kept its own copy
// of the list inside this file and read nothing but `i18n.ts`, and that is precisely how a screen
// full of «ومش هيتعمل» and «صفوف ما اتقريتش» reached the owner with a green build behind it. One
// list, read by both, or the two drift and the weaker one is the one that runs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROOT,
  VERBATIM_PAPERS,
  offendersIn,
  productStrings,
} from '../../../../../scripts/check-formal-arabic.mjs';

describe('the Arabic the product speaks is formal Arabic', () => {
  const strings = productStrings();

  it('reads the product prose at all — a guard over nothing passes forever', () => {
    // The scan walks the tree and matches string literals, so it has to be proved to have FOUND
    // the prose before its silence about it means anything.
    expect(strings.length).toBeGreaterThan(4000);
    expect(strings.some((s) => s.file.endsWith('i18n.ts'))).toBe(true);
    expect(strings.some((s) => s.file.endsWith('workforce-import/reasons.ts'))).toBe(true);
  });

  it('contains no colloquial Egyptian form, in any string a user reads', () => {
    const offenders = strings
      .map((entry) => ({ ...entry, found: offendersIn(entry.text) }))
      .filter((entry) => entry.found.length > 0)
      .map((entry) => `${entry.file}:${String(entry.line)} — ${entry.found.join(', ')}`);
    // Printed in full rather than counted: whoever trips this needs the line and the replacement,
    // not the news that a number went up.
    expect(offenders).toEqual([]);
  });

  it('still catches a colloquial string if one is added', () => {
    // The check above is only worth what it detects. These are the three ways the first version of
    // it was blind, one assertion each.
    // 1. A conjunction glued to the front — «ومش» is «و» + «مش», and the old word boundary missed it.
    expect(offendersIn('الملف ومش هيتحفظ')).toContain('«مش» → ليس / غير / لا');
    // 2. Morphology, not vocabulary: nobody lists «هيتحفظ», and nobody has to.
    expect(offendersIn('الملف ومش هيتحفظ')).toContain('«هيتحفظ» → صيغة عامية، اكتبها يُفعل / سوف');
    expect(offendersIn('صفوف ما اتقريتش')).toHaveLength(1);
    // 3. Spelling, which reaches the same reader on the same screen.
    expect(offendersIn('إجمالى المصروفات')).toContain('«إجمالى» → «إجمالي»');
    // The dialect's «ليس له» is still caught, after «ماله» (his property) left the list.
    expect(offendersIn('الملف مالوش صاحب')).toContain('«مالوش» → ليس له');
  });

  it('leaves formal Arabic alone, including the words that merely contain a tell', () => {
    // A guard that cries wolf gets loosened until it catches nothing, so the false positives it
    // was taught are pinned: «أعِده» is not «ده», «لدى» is not «دى», «اتخاذ» is not a passive.
    for (const formal of [
      'أعِده للمتقدم',
      'تعبر منتصف الليل',
      'جرّب اسمًا آخر',
      'أنشئ أمرًا عند الحاجة',
      'الصلاحية لدى المدير',
      'قرار «إعادة تعيين» يُسجَّل، ولا يملك الملف اتخاذه',
      'حروف عربية فقط — بدون أرقام',
      'بيانات الاتصال بينما تتم المراجعة',
      'هذه الإدارة مسجَّلة بالفعل',
      'حفاظ الشخص الحريص على ماله الخاص',
      // The custody dashboard's «رسم بياني / جدول» and «فاتورة ملاكي».
      'رسم بياني',
      'فاتورة ملاكي واحدة',
    ]) {
      expect(offendersIn(formal), formal).toEqual([]);
    }
  });
});

// His printed papers are exempt — by FILE, two of them, and nothing else. «عاوز زيهم بالظبط»: the
// custody's memos and letters print his words, his spelling included («الاجمالى النهائى»), so the
// file holding those words and the file holding his default names are listed in `VERBATIM_PAPERS`
// and not corrected. What keeps that exemption from quietly growing is pinned here: exactly those
// two files; every other file of the paper engine carries no Arabic letter at all (the
// Arabic-Indic digits, «٫» and the tatweel are built from code points, and they are not letters);
// and the rule itself is untouched — his words written anywhere else are still caught.
describe('his printed papers — the one exemption, held narrow', () => {
  const PAPER_LIB = 'apps/web/src/modules/fleet/lib';
  /** His scenario's data for the papers' specs: scanned like any other file (and formal). */
  const SAMPLES = `${PAPER_LIB}/custody-paper-samples.ts`;

  /** Comments blanked the way the check blanks them — a quotation of his is not code. */
  const code = (file: string): string =>
    readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[^]*?\*\//gu, ' ')
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/gu, '$1');

  it('exempts exactly his papers’ wording and his default names — both files exist', () => {
    expect([...VERBATIM_PAPERS].sort()).toEqual([
      'apps/web/src/modules/fleet/lib/custody-paper-wording.ts',
      'packages/contracts/src/modules/fleet-custody-paper-defaults.ts',
    ]);
    for (const file of VERBATIM_PAPERS) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });

  it('reads nothing out of them', () => {
    const strings = productStrings();
    for (const file of VERBATIM_PAPERS) {
      expect(
        strings.filter((s) => s.file === file),
        file,
      ).toEqual([]);
    }
  });

  it('keeps every other file of the paper engine free of Arabic letters', () => {
    const files = readdirSync(join(ROOT, PAPER_LIB))
      .filter((name) => /^custody-papers?(?:-[a-z]+)?\.ts$/u.test(name))
      .map((name) => `${PAPER_LIB}/${name}`)
      .filter((file) => !VERBATIM_PAPERS.includes(file) && file !== SAMPLES);
    expect(files.length).toBeGreaterThanOrEqual(7);
    // Arabic LETTERS (ء … ي): a digit, «٫» or the tatweel would be built from its code point.
    const offenders = files.filter((file) => /[\u0621-\u064A]/u.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it('still catches his spelling anywhere else — the exemption is the file, not a softer rule', () => {
    expect(offendersIn('الاجمالى النهائى')).toContain('«الاجمالى» → «الإجمالي»');
    expect(offendersIn('عن الفتره من 1 الى 30')).toContain('«الى» → «إلى»');
    // And the screens' own names for his papers are formal.
    expect(offendersIn('مذكرة بمصروفات الكاوتش')).toEqual([]);
    expect(offendersIn('مذكرة داخلية بمصروفات التموين')).toEqual([]);
  });
});
