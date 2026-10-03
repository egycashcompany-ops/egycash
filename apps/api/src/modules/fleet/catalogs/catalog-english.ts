// The English side of a Fleet catalog name — «ترجمهم انت».
//
// The catalogs carry every name twice, Arabic and English, and the English box is English-only on
// the screen. The legacy imports could not honour that: they knew one string per name, so they
// stored the Arabic in BOTH halves (`{ ar: name, en: name }`), and an English box opening on
// «فلتر زيت» could not be saved without a translation. This is that translation.
//
// Three answers, in order:
//   1. the house's own translation — `FLEET_TRANSLATIONS` below, plus the vocabulary's pairs that
//      the boot step hands in (`go-live/vocabulary.ts`, where every name already carries its
//      English);
//   2. failing that, a transliteration — a company's or a place's own name is not translated
//      («تكنو بوش» is Techno Bosch), and a name nobody has translated yet is still better spelt
//      in Latin letters than shown in Arabic inside an English box;
//   3. a name that already holds no Arabic letter is left exactly as it is.
//
// Pure: no database, no service. The boot step (`translateCatalogEnglishNames`) and the two write
// paths (catalog items, vehicle types) all ask this one function.

import { FLEET_VOCABULARY_PAIRS } from '../go-live/vocabulary-names';

/**
 * Arabic letters, as a pattern source the boot step's database query reuses — the base block and
 * the presentation forms (Arabic copied out of a PDF arrives as those, and is still Arabic). The
 * escapes are resolved by the string itself, so the pattern holds the letters: the database's
 * regex engine does not read `\u` escapes.
 */
export const ARABIC_LETTER_SOURCE =
  '[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]';
const ARABIC_LETTER = new RegExp(ARABIC_LETTER_SOURCE, 'u');
const ARABIC_LETTERS = new RegExp(ARABIC_LETTER_SOURCE, 'gu');

/** Does this text carry an Arabic letter — the test an English name must pass. */
export const hasArabicLetters = (text: string): boolean => ARABIC_LETTER.test(text);

/**
 * The letters as they are typed: presentation forms back to their base letters (NFKC), and the
 * tatweel that only stretches a word («صيانـة») dropped.
 */
const plain = (name: string): string => name.normalize('NFKC').replace(/ـ/gu, '');

/** The lookup key: hamza forms, taa marbuta, alef maqsura and spacing folded flat. */
const keyOf = (name: string): string =>
  plain(name)
    .replace(/[آأإٱ]/gu, 'ا')
    .replace(/[ً-ٰٟ]/gu, '')
    .replace(/ة/gu, 'ه')
    .replace(/ى/gu, 'ي')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

/**
 * The names the legacy books brought in that the vocabulary does not already pair — car makes,
 * licence offices, operations, workshops, job grades, licence classes and the odd spare part.
 */
export const FLEET_TRANSLATIONS: Readonly<Record<string, string>> = {
  // Vehicle types and makes
  'تويوتا لاند كروزر': 'Toyota Land Cruiser',
  'تويوتا هاى اس': 'Toyota HiAce',
  'مرسيدس اسبرانتر 515': 'Mercedes Sprinter 515',
  'مرسيدس اسبرانتر 516': 'Mercedes Sprinter 516',
  'مرسيدس اسيليو 915': 'Mercedes Accelo 915',
  تويوتا: 'Toyota',
  'تويوتا 2': 'Toyota 2',
  بيجو: 'Peugeot',
  جيلى: 'Geely',
  سوزوكى: 'Suzuki',
  // Licence offices — the traffic unit, and the class letter it issues under
  'العجوزة ت': 'Agouza (T)',
  'العجوزة م': 'Agouza (M)',
  'برقاش ت': 'Barqash (T)',
  'برقاش م': 'Barqash (M)',
  // Operations and driver specializations
  ملاكى: 'Private',
  ميكروباص: 'Microbus',
  'نقل اموال': 'Cash transport',
  // Workshops and work types
  'تكنو بوش': 'Techno Bosch',
  صيانه: 'Periodic maintenance',
  // Driver job grades
  سائق: 'Driver',
  'سائق أ': 'Driver A',
  'سائق ب': 'Driver B',
  'سائق ج': 'Driver C',
  'سائق صراف الى': 'ATM cashier driver',
  'اخصائى صراف الى ( موتوسيكل )': 'ATM cashier specialist (motorcycle)',
  'منسق جراج': 'Garage coordinator',
  // Driving licence classes
  أولى: 'First class',
  اولى: 'First class',
  ثانية: 'Second class',
  تانيه: 'Second class',
  ثالثة: 'Third class',
  تالته: 'Third class',
  // Spare parts the vocabulary spells differently
  'فيشة ضفيرة ABS': 'ABS harness connector',
  'كنترول zs': 'ZS control unit',
  'كوعة مياة تبريد زيت': 'Oil cooler water elbow',
  'غير محدد': 'Unspecified',
};

const LETTERS: Readonly<Record<string, string>> = {
  ا: 'a',
  أ: 'a',
  إ: 'e',
  آ: 'a',
  ٱ: 'a',
  ء: '',
  ؤ: 'o',
  ئ: 'e',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'g',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'z',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  ة: 'a',
  و: 'o',
  ى: 'a',
  ي: 'y',
  پ: 'p',
  چ: 'ch',
  ڤ: 'v',
  ی: 'y',
  ې: 'y',
  ک: 'k',
  گ: 'g',
  ۀ: 'h',
  ە: 'h',
};

/** Arabic letters spelt in Latin ones, word by word, each word capitalised. */
export const transliterate = (ar: string): string =>
  plain(ar)
    .replace(/[ً-ٰٟ]/gu, '')
    .split(/\s+/u)
    .map((word) =>
      // A letter with no Latin spelling here is dropped rather than kept: an English name must not
      // carry Arabic, or its own box would refuse it.
      [...word]
        .map((ch) => LETTERS[ch] ?? ch)
        .join('')
        .replace(ARABIC_LETTERS, ''),
    )
    .filter((word) => word !== '')
    .map((latin) => latin.charAt(0).toUpperCase() + latin.slice(1))
    .join(' ');

/**
 * The English for an Arabic catalog name: the house's translation when there is one (the given
 * pairs first, then `FLEET_TRANSLATIONS`), a transliteration otherwise.
 */
export const englishName = (
  ar: string,
  known: Iterable<readonly [string, string]> = FLEET_VOCABULARY_PAIRS,
): string => {
  const key = keyOf(ar);
  for (const [arabic, english] of known) {
    if (keyOf(arabic) === key && !hasArabicLetters(english)) return english;
  }
  for (const [arabic, english] of Object.entries(FLEET_TRANSLATIONS)) {
    if (keyOf(arabic) === key) return english;
  }
  return transliterate(ar.trim());
};

/**
 * A name as it may be STORED: its English half kept when it is English, translated when it still
 * carries Arabic letters (an import, or a part typed once into one box and saved as both halves).
 *
 * Only an ARABIC name is translated from. Halves saved the wrong way round (a Latin «Arabic» and an
 * Arabic «English») are left alone: rebuilding the English from the Latin half would overwrite the
 * only Arabic the row has.
 */
export const withEnglishName = <T extends { ar: string; en: string }>(
  name: T,
  known: Iterable<readonly [string, string]> = FLEET_VOCABULARY_PAIRS,
): T =>
  hasArabicLetters(name.en) && hasArabicLetters(name.ar)
    ? { ...name, en: englishName(name.ar, known) }
    : name;
