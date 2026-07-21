// Best-effort Arabic → Latin transliteration for seeding the *editable* English name from the
// Arabic name (the review step lets the user correct it). Egyptian short vowels are not written
// in Arabic script, so a pure letter map reads poorly; a small dictionary of the most common
// Egyptian name components carries the frequent cases, with a letter-by-letter fallback for the
// rest. Never authoritative — always user-editable.

// Strip harakat (diacritics) + tatweel, and fold the alef/hamza/ya variants.
const stripMarks = (s: string): string =>
  s
    .replace(/[ً-ْٰـ]/g, '') // harakat, superscript alef, tatweel
    .replace(/[آأإ]/g, 'ا') // آ أ إ → ا
    .replace(/ى/g, 'ي'); // ى → ي

// Common Egyptian name words (normalized, marks stripped). Editable afterwards.
const DICTIONARY: Record<string, string> = {
  محمد: 'Mohamed',
  احمد: 'Ahmed',
  محمود: 'Mahmoud',
  مصطفى: 'Mostafa',
  مصطفي: 'Mostafa',
  علي: 'Ali',
  حسن: 'Hassan',
  حسين: 'Hussein',
  ابراهيم: 'Ibrahim',
  عبد: 'Abd',
  الله: 'Allah',
  عبدالله: 'Abdallah',
  عبدالرحمن: 'Abdelrahman',
  عبدالعزيز: 'Abdelaziz',
  خالد: 'Khaled',
  عمر: 'Omar',
  يوسف: 'Youssef',
  سيد: 'Sayed',
  طارق: 'Tarek',
  كريم: 'Karim',
  اسلام: 'Islam',
  رامي: 'Ramy',
  شريف: 'Sherif',
  وليد: 'Walid',
  ايمن: 'Ayman',
  هاني: 'Hany',
  سامح: 'Sameh',
  ناصر: 'Nasser',
  فاطمة: 'Fatma',
  عائشة: 'Aisha',
  مريم: 'Mariam',
  سارة: 'Sara',
  ساره: 'Sara',
  نور: 'Nour',
  هدى: 'Hoda',
  منى: 'Mona',
  مني: 'Mona',
  دينا: 'Dina',
  ياسمين: 'Yasmin',
  اسماء: 'Asmaa',
  هبة: 'Heba',
  هبه: 'Heba',
  ندى: 'Nada',
  ريهام: 'Reham',
  شيماء: 'Shaimaa',
  امل: 'Amal',
  نورهان: 'Nourhan',
  السيد: 'Elsayed',
  الدين: 'Eldin',
};

const LETTERS: Record<string, string> = {
  ا: 'a', ء: '', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l',
  م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y', ئ: '', ؤ: '',
};

const capitalize = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

const transliterateWord = (word: string): string => {
  if (word in DICTIONARY) return DICTIONARY[word] as string;
  let out = '';
  for (const ch of word) out += LETTERS[ch] ?? '';
  return capitalize(out);
};

/**
 * Transliterate an Arabic full name to a suggested Latin form. Returns '' when there is nothing
 * to transliterate (no Arabic letters) so callers can leave the field untouched.
 */
export const transliterateArabicName = (arabic: string): string => {
  const cleaned = stripMarks(arabic).trim();
  if (cleaned === '' || !/[ء-ي]/.test(cleaned)) return '';
  return cleaned
    .split(/\s+/)
    .map(transliterateWord)
    .filter((w) => w !== '')
    .join(' ')
    .trim();
};
