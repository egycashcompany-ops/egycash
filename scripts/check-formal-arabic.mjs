#!/usr/bin/env node
// The Arabic this product speaks is formal Arabic, and stays that way.
//
// «خلى كله الكلام اللى رسمى واللى يتكتب بعد كدا كلام رسمى» — the second half of that sentence is
// what this file is for. Rewriting the colloquial strings is an afternoon; keeping them out is only
// possible if something fails when the next one arrives, because nobody reviewing a diff of six
// thousand strings will catch «ومش» in one of them.
//
// WHY IT REPLACED A WORD LIST. The first version of this guard was a list of Egyptian words living
// inside the web test suite, and a screen the owner opened afterwards was still full of colloquial
// Arabic. Three separate holes:
//
//   1. it only ever read `i18n.ts`, so every Arabic sentence the SERVER composes — the whole
//      rejection half of the roster import — was never looked at;
//   2. «مش» was matched between non-letters, and Arabic glues its conjunction onto the next word,
//      so «ومش هيتعمل» walked straight past it;
//   3. a list of words cannot cover a dialect. «اتقريتش», «هيتعمل», «بيوقف», «اتضافوا» share no
//      letters with each other — they share a PREFIX, and that is what is checked here now.
//
// So the tells below are morphology first: the Egyptian verb prefixes (بـ, هـ, اتـ) and the ما…ش
// negation, which formal Arabic does not have and therefore cannot trip over by accident, plus the
// dialect's own pronouns and vocabulary, which carry no morphology to catch them by.
//
// WHAT IS NOT CHECKED, AND WHY
//
//   · Comments. A comment that quotes the owner verbatim — «عاوز اقدر ابحث فى الملاحظات» — is a
//     record of what a person said. Rewriting a quotation falsifies it.
//   · Tests. Their fixtures are what a user TYPED: a maintenance note reading «اتصلح فى ورشة
//     الجيزة» is data, and data is not written by us.
//   · The files in `DATA_FILES`. Their Arabic is input to match against, not prose to read.
//   · English. Its register was never in question.
//
// A guard that cries wolf gets loosened until it catches nothing, so only forms with no formal
// reading are listed: «جرّب» is ordinary Arabic and is absent, «الحاجة» is a noun in «عند الحاجة»
// and is absent. Everything the morphology reaches by accident — اتخاذ, اتصال, بيانات, بينما — is
// named in `FORMAL`, one word at a time, rather than by weakening the pattern.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The whole Arabic block. A kasra or a shadda between two letters is not a word boundary. */
const LETTER = '؀-ۿ';
/** Arabic writes «و» and «ف» onto the front of the next word; they are not a boundary either. */
const PROCLITIC = '(?:و|ف)?';

/**
 * Egyptian verb morphology. Formal Arabic has no بـ/هـ present-future prefix, no اتـ passive and
 * no ما…ش negation, so these cannot appear in formal prose except inside an unrelated word — and
 * those words are named in `FORMAL` below rather than softened away here.
 */
const MORPHOLOGY = [
  { re: new RegExp(`^${PROCLITIC}(?:بي|هي|هت)[${LETTER}]{3,}$`, 'u'), instead: 'يُفعل / سوف' },
  { re: new RegExp(`^${PROCLITIC}ات[${LETTER}]{3,}$`, 'u'), instead: 'أُفعل (المبني للمجهول)' },
  { re: new RegExp(`^ما?[${LETTER}]{2,}ش$`, 'u'), instead: 'لم / لا / ليس' },
];

/** Words the patterns above reach by accident. Formal Arabic, every one. */
const FORMAL = new Set([
  'اتخاذ', 'اتخاذه', 'اتخاذها', 'اتصال', 'اتصالك', 'اتصالات', 'اتفاق', 'اتفاقية', 'اتساق',
  'اتساع', 'اتجاه', 'اتحاد', 'اتباع', 'اتركه', 'اتركها', 'اتركهما', 'واتساب',
  'بيانات', 'بياناتك', 'بيانية', 'بينما', 'بينهم', 'بيان', 'بيئة', 'بيجو', 'بيضة',
  'هيئة', 'هيكل', 'هيكلة', 'مارش', 'مقاييس',
]);

/** Dialect vocabulary: no morphology to catch it by, and no formal reading either. */
const WORDS = [
  ['مش', 'ليس / غير / لا'], ['مفيش', 'لا يوجد'], ['محدش', 'لا أحد'], ['ملوش', 'ليس له'],
  ['مالوش', 'ليس له'], ['ماله', 'ليس له'], ['دلوقتي', 'الآن'], ['دلوقتى', 'الآن'],
  ['عشان', 'لأن / حتى'], ['علشان', 'لأن / حتى'], ['بتاع', 'الخاص بـ'], ['بتاعته', 'الخاص به'],
  ['بتوع', 'الخاصون بـ'], ['لسه', 'ما زال / بعد'], ['اللي', 'الذي / التي'],
  ['اللى', 'الذي / التي'], ['عايز', 'يريد'], ['عاوز', 'يريد'], ['كده', 'ذلك / هكذا'],
  ['كدا', 'ذلك / هكذا'], ['ازاي', 'كيف'], ['إزاي', 'كيف'], ['ازيك', 'كيف حالك'],
  ['ده', 'هذا'], ['دي', 'هذه'], ['دى', 'هذه'], ['دول', 'هؤلاء'], ['إيه', 'ما / ماذا'],
  ['كتير', 'كثير'], ['زرار', 'زر'], ['شوية', 'قليل / بعض'], ['استنى', 'انتظر'],
  ['بعدين', 'لاحقًا'], ['لوحده', 'منفردًا'], ['لوحدها', 'منفردة'], ['جداد', 'جدد'],
  ['الجداد', 'الجدد'], ['شغّال', 'يعمل'], ['الاتنين', 'كليهما'], ['اتنين', 'اثنين'],
  ['تلات', 'ثلاث'], ['كام', 'كم'], ['فين', 'أين'], ['حاجات', 'أشياء / عناصر'],
  ['القايمة', 'القائمة'], ['الداتا', 'البيانات'], ['السيستم', 'النظام'], ['فاضي', 'فارغ'],
  ['فاضى', 'فارغ'], ['فاضية', 'فارغة'], ['تاني', 'ثانٍ / مرة أخرى'], ['تانى', 'ثانٍ / مرة أخرى'],
  ['زي ما', 'كما'], ['غلط', 'خطأ / غير صحيح'], ['شيل', 'أزل'], ['سيب', 'اترك'],
  ['رجّع', 'أعِد'], ['حاطّه', 'يضعه'], ['جاية', 'قادمة / مأخوذة'], ['برضه', 'أيضًا'],
  ['بردو', 'أيضًا'], ['أوي', 'جدًا'], ['خالص', 'إطلاقًا'],
];

/**
 * Written Arabic ends these words with a dotted yāʾ. The dotless form is handwriting and Egyptian
 * typing habit; the last two are a dropped hamza. Kept apart from the register tells above because
 * it is spelling, not dialect — but it reaches the same reader on the same screen.
 */
const SPELLING = [
  ['فى', 'في'], ['أى', 'أي'], ['الى', 'إلى'], ['هى', 'هي'], ['الذى', 'الذي'], ['التى', 'التي'],
  ['اللذى', 'الذي'], ['عربى', 'عربي'], ['إنجليزى', 'إنجليزي'], ['انجليزى', 'إنجليزي'],
  ['الشهرى', 'الشهري'], ['الرئيسى', 'الرئيسي'], ['التسلسلى', 'التسلسلي'],
  ['الإلكترونى', 'الإلكتروني'], ['الالكترونى', 'الإلكتروني'], ['صباحى', 'صباحي'],
  ['مسائى', 'مسائي'], ['سبائكى', 'سبائكي'], ['إيجى', 'إيجي'], ['الكلى', 'الكلي'],
  ['إجمالى', 'إجمالي'], ['اجمالى', 'إجمالي'], ['الإجمالى', 'الإجمالي'], ['الاجمالى', 'الإجمالي'],
  ['كالتالى', 'كالتالي'], ['ارصدة', 'أرصدة'], ['ادارة', 'إدارة'],
];

/**
 * Files whose Arabic is INPUT or a DATABASE KEY, not prose.
 *
 * `vocabulary.ts` maps what HR typed into a spreadsheet — «ادى الخدمه» spelled three ways — onto
 * the enums the system has; correcting the spelling there would stop it matching the sheet. The
 * go-live vocabulary is the workshop's own names for parts («مارش», «طنبورة كرنك»). The geography
 * list is place names, and the transliterator's dictionary is name components.
 *
 * `*.seed.ts` is excluded for a different and sharper reason: a seed is matched against rows that
 * already exist, by Arabic name (`fleetCatalogItemService.ensure` → `findByKindAndNameAr`).
 * Correcting a spelling there does NOT rename the live row — it seeds a SECOND one beside it, and
 * every dropdown shows both. Those entries are catalog data their owner renames on the catalogs
 * screen, which is what that screen is for; a spelling fix in code would be a data migration
 * wearing a typo's clothes.
 */
const DATA_FILES = [
  'apps/api/src/workforce-import/vocabulary.ts',
  'apps/api/src/modules/fleet/go-live/vocabulary.ts',
  'packages/contracts/src/common/egypt-geography.ts',
  'apps/web/src/shared/national-id/transliterate.ts',
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', 'assets', 'spikes', 'tests',
]);

const sourceFiles = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(spec|test|seed)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

/** Blank out comments, keeping line numbers, so a quotation of the owner is not read as prose. */
const withoutComments = (source) =>
  source
    .replace(/\/\*[^]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));

const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** Every tell in one string, as `«form» → replacement`. Exported so the spec tests the real thing. */
export const offendersIn = (text) => {
  const found = new Map();
  for (const word of text.match(new RegExp(`[${LETTER}]+`, 'gu')) ?? []) {
    if (FORMAL.has(word)) continue;
    const morph = MORPHOLOGY.find(({ re }) => re.test(word));
    if (morph) found.set(word, `«${word}» → صيغة عامية، اكتبها ${morph.instead}`);
  }
  for (const [form, instead] of WORDS) {
    const re = form.includes(' ')
      ? new RegExp(form.replace(/ /g, '\\s'), 'u')
      : new RegExp(`(?:^|[^${LETTER}])${PROCLITIC}${form}(?:$|[^${LETTER}])`, 'u');
    if (re.test(text)) found.set(form, `«${form}» → ${instead}`);
  }
  for (const [wrong, right] of SPELLING) {
    if (new RegExp(`(?:^|[^${LETTER}])${wrong}(?:$|[^${LETTER}])`, 'u').test(text)) {
      found.set(wrong, `«${wrong}» → «${right}»`);
    }
  }
  return [...found.values()];
};

/** Every Arabic string literal in the product's own prose, with where it is written. */
export const productStrings = () => {
  const excluded = new Set(DATA_FILES.map((p) => resolve(ROOT, p)));
  const out = [];
  for (const dir of ['apps', 'packages']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      if (excluded.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      if (!new RegExp(`[${LETTER}]`, 'u').test(source)) continue;
      withoutComments(source)
        .split('\n')
        .forEach((line, index) => {
          STRING_LITERAL.lastIndex = 0;
          let match = STRING_LITERAL.exec(line);
          while (match !== null) {
            const text = match[1] ?? match[2] ?? match[3] ?? '';
            if (new RegExp(`[${LETTER}]`, 'u').test(text)) {
              out.push({ file: relative(ROOT, file), line: index + 1, text });
            }
            match = STRING_LITERAL.exec(line);
          }
        });
    }
  }
  return out;
};

export const findOffenders = () =>
  productStrings()
    .map((entry) => ({ ...entry, found: offendersIn(entry.text) }))
    .filter((entry) => entry.found.length > 0);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const strings = productStrings();
  if (strings.length < 4000) {
    // A guard over nothing passes forever. The walk has to be proved to have found the prose
    // before its silence about it means anything.
    console.error(`only ${String(strings.length)} Arabic strings found — the scan is broken`);
    process.exit(2);
  }
  const offenders = findOffenders();
  if (offenders.length === 0) {
    console.log(`Formal Arabic: ${String(strings.length)} Arabic strings, no colloquial form.`);
    process.exit(0);
  }
  // Printed in full rather than counted: whoever trips this needs the line and the replacement,
  // not the news that a number went up.
  console.error(`${String(offenders.length)} Arabic string(s) are not written in formal Arabic:\n`);
  for (const { file, line, text, found } of offenders) {
    console.error(`  ${file}:${String(line)}`);
    console.error(`    ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`);
    for (const note of found) console.error(`    ${note}`);
    console.error('');
  }
  process.exit(1);
}
