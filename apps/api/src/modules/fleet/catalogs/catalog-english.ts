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

const ARABIC_LETTER = /[ء-يٮ-ۓۺ-ۿ]/u;

/** Does this text carry an Arabic letter — the test an English name must pass. */
export const hasArabicLetters = (text: string): boolean => ARABIC_LETTER.test(text);

/** The lookup key: hamza forms, taa marbuta, alef maqsura and spacing folded flat. */
const keyOf = (name: string): string =>
  name
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
  صيانه: 'Maintenance',
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
};

/** Arabic letters spelt in Latin ones, word by word, each word capitalised. */
export const transliterate = (ar: string): string =>
  ar
    .replace(/[ً-ٰٟ]/gu, '')
    .split(/\s+/u)
    .filter((word) => word !== '')
    .map((word) => {
      const latin = [...word].map((ch) => LETTERS[ch] ?? ch).join('');
      return latin.charAt(0).toUpperCase() + latin.slice(1);
    })
    .join(' ');

/**
 * The English for an Arabic catalog name: the house's translation when there is one (the given
 * pairs first, then `FLEET_TRANSLATIONS`), a transliteration otherwise.
 */
export const englishName = (
  ar: string,
  known: Iterable<readonly [string, string]> = [],
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
 */
export const withEnglishName = <T extends { ar: string; en: string }>(
  name: T,
  known: Iterable<readonly [string, string]> = [],
): T => (hasArabicLetters(name.en) ? { ...name, en: englishName(name.ar, known) } : name);
