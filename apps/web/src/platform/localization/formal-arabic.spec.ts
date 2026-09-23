// The Arabic the product speaks is formal Arabic — asserted here so `npm run test -w apps/web`
// fails on a colloquial string, not only CI.
//
// The tells themselves live in `scripts/check-formal-arabic.mjs`, which CI runs over the whole
// monorepo: the web dictionary, the sentences the API composes, the permission catalogue, the
// printed forms. They are NOT duplicated here. The first version of this guard kept its own copy
// of the list inside this file and read nothing but `i18n.ts`, and that is precisely how a screen
// full of «ومش هيتعمل» and «صفوف ما اتقريتش» reached the owner with a green build behind it. One
// list, read by both, or the two drift and the weaker one is the one that runs.
import { describe, expect, it } from 'vitest';

import { offendersIn, productStrings } from '../../../../../scripts/check-formal-arabic.mjs';

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
    ]) {
      expect(offendersIn(formal), formal).toEqual([]);
    }
  });
});
