// Which form a counted noun takes: Arabic's five («يوم واحد · يومان · 3 أيام · 11 يومًا · 100 يوم»),
// English's two. The i18n catalog holds one key per form, `<key>.<form>`, and this picks the key.
//
// `Intl.PluralRules('ar')` gives the CLDR answer where the runtime ships Arabic data; the hand rule
// beside it is the same table, for a runtime that does not. Zero reads as `few` («0 أيام»), as the
// custody boards count.
import { type Locale } from '@ecms/contracts';

export type PluralForm = 'one' | 'two' | 'few' | 'many' | 'other';
export const PLURAL_FORMS: readonly PluralForm[] = ['one', 'two', 'few', 'many', 'other'];

const arabicByHand = (n: number): PluralForm => {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const tail = n % 100;
  if (n === 0 || (tail >= 3 && tail <= 10)) return 'few';
  if (tail >= 11 && tail <= 99) return 'many';
  return 'other';
};

const arabicRules = ((): Intl.PluralRules | null => {
  try {
    const rules = new Intl.PluralRules('ar');
    return rules.resolvedOptions().locale.startsWith('ar') ? rules : null;
  } catch {
    return null;
  }
})();

export const pluralForm = (locale: Locale, n: number): PluralForm => {
  const whole = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;
  if (locale !== 'ar') return whole === 1 ? 'one' : 'other';
  if (arabicRules === null) return arabicByHand(whole);
  const category = arabicRules.select(whole);
  return category === 'zero' ? 'few' : (category as PluralForm);
};
