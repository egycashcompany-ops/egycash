// Best-effort Arabic → Latin transliteration for seeding the *editable* English name from the
// Arabic name (the review step lets the user correct it). Egyptian short vowels are not written
// in Arabic script, so a pure letter map reads poorly ('حسن' → 'Hsn'). Three layers, in order:
//
//   1. a dictionary of common Egyptian given and family names, spelled the way Egyptian
//      passports and HR records usually spell them ('محمد' → 'Mohamed', not 'Muhammad');
//   2. structural rules for the compounds a dictionary cannot enumerate — 'عبد' + a divine name
//      ('عبد الرحمن' → 'Abdelrahman'), the article ('الحديدي' → 'Elhadidy'), 'أبو' + a name;
//   3. a letter fallback that infers the commonest short vowels instead of dropping them.
//
// Never authoritative — always user-editable.

/** Strip harakat + tatweel and fold the alef/hamza variants. Keeps ة/ى so endings can be read. */
const stripMarks = (s: string): string =>
  s
    .replace(/[ً-ْٰـ]/g, '') // harakat, superscript alef, tatweel
    .replace(/[آأإٱ]/g, 'ا'); // آ أ إ ٱ → ا

/** Lookup key: also folds the letters Egyptian spelling uses interchangeably at word end. */
const keyOf = (word: string): string =>
  stripMarks(word).replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');

// Common Egyptian names (keys are folded by `keyOf` at load, so ة/ه and ى/ي both match).
const NAMES: Record<string, string> = {
  // ── male given names ──
  محمد: 'Mohamed',
  احمد: 'Ahmed',
  محمود: 'Mahmoud',
  مصطفى: 'Mostafa',
  علي: 'Ali',
  عمر: 'Omar',
  حسن: 'Hassan',
  حسين: 'Hussein',
  ابراهيم: 'Ibrahim',
  اسماعيل: 'Ismail',
  يوسف: 'Youssef',
  خالد: 'Khaled',
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
  سيد: 'Sayed',
  عادل: 'Adel',
  عاطف: 'Atef',
  // The فاعل shape: the letter rule writes its second vowel as 'a' (Faras); records write 'e'.
  فارس: 'Fares',
  ماهر: 'Maher',
  عامر: 'Amer',
  هاشم: 'Hashem',
  طاهر: 'Taher',
  جاسر: 'Gasser',
  فاضل: 'Fadel',
  ناجح: 'Nageh',
  حاكم: 'Hakem',
  عصام: 'Essam',
  عماد: 'Emad',
  عمرو: 'Amr',
  عزت: 'Ezzat',
  عز: 'Ezz',
  اشرف: 'Ashraf',
  امير: 'Amir',
  امين: 'Amin',
  انور: 'Anwar',
  ايهاب: 'Ehab',
  باسم: 'Bassem',
  بلال: 'Belal',
  بهاء: 'Bahaa',
  تامر: 'Tamer',
  توفيق: 'Tawfik',
  ثروت: 'Tharwat',
  جمال: 'Gamal',
  جلال: 'Galal',
  حاتم: 'Hatem',
  حازم: 'Hazem',
  حامد: 'Hamed',
  حمدي: 'Hamdy',
  حمادة: 'Hamada',
  حسام: 'Hossam',
  حسني: 'Hosny',
  حلمي: 'Helmy',
  حماد: 'Hammad',
  خليل: 'Khalil',
  رافت: 'Raafat',
  رجب: 'Ragab',
  رضا: 'Reda',
  رمضان: 'Ramadan',
  رشاد: 'Rashad',
  رشدي: 'Roshdy',
  رفعت: 'Refaat',
  زكريا: 'Zakaria',
  زكي: 'Zaky',
  زياد: 'Ziad',
  زين: 'Zein',
  سامي: 'Samy',
  سعد: 'Saad',
  سعيد: 'Saeed',
  سليمان: 'Soliman',
  سمير: 'Samir',
  سلامة: 'Salama',
  سالم: 'Salem',
  سيف: 'Seif',
  شادي: 'Shady',
  شعبان: 'Shaaban',
  شوقي: 'Shawky',
  صابر: 'Saber',
  صالح: 'Saleh',
  صبري: 'Sabry',
  صلاح: 'Salah',
  صفوت: 'Safwat',
  طه: 'Taha',
  عاصم: 'Assem',
  عرفة: 'Arafa',
  عبده: 'Abdo',
  عثمان: 'Osman',
  عطية: 'Attia',
  علاء: 'Alaa',
  عوض: 'Awad',
  عيد: 'Eid',
  عيسى: 'Eissa',
  فادي: 'Fady',
  فاروق: 'Farouk',
  فتحي: 'Fathy',
  فريد: 'Farid',
  فؤاد: 'Fouad',
  فوزي: 'Fawzy',
  فيصل: 'Faisal',
  قاسم: 'Kassem',
  كمال: 'Kamal',
  لطفي: 'Lotfy',
  ماجد: 'Maged',
  مازن: 'Mazen',
  مالك: 'Malek',
  مجدي: 'Magdy',
  مدحت: 'Medhat',
  مراد: 'Mourad',
  مروان: 'Marwan',
  مسعد: 'Mosaad',
  معتز: 'Moataz',
  ممدوح: 'Mamdouh',
  منصور: 'Mansour',
  منير: 'Mounir',
  مهدي: 'Mahdy',
  موسى: 'Moussa',
  مؤمن: 'Moamen',
  نادر: 'Nader',
  نبيل: 'Nabil',
  نجيب: 'Naguib',
  نصر: 'Nasr',
  نعيم: 'Naeem',
  نور: 'Nour',
  هشام: 'Hesham',
  هيثم: 'Haitham',
  وائل: 'Wael',
  وجدي: 'Wagdy',
  وحيد: 'Waheed',
  ياسر: 'Yasser',
  ياسين: 'Yassin',
  يحيى: 'Yehia',
  يسري: 'Yousry',
  يونس: 'Younes',
  ابوبكر: 'Abobakr',
  بكر: 'Bakr',
  زيد: 'Zeid',
  بدر: 'Badr',
  جابر: 'Gaber',
  جورج: 'George',
  حمزة: 'Hamza',
  رزق: 'Rizk',
  سمعان: 'Samaan',
  شحاتة: 'Shehata',
  شنودة: 'Shenouda',
  عزيز: 'Aziz',
  فهمي: 'Fahmy',
  كيرلس: 'Kirollos',
  مينا: 'Mina',
  مرقص: 'Morcos',
  بيتر: 'Peter',
  ميخائيل: 'Mikhail',
  جرجس: 'Gerges',
  بولس: 'Boulos',
  بطرس: 'Boutros',
  حنا: 'Hanna',
  عياد: 'Ayad',
  ابانوب: 'Abanoub',
  مايكل: 'Michael',
  رومانى: 'Romany',
  اندرو: 'Andrew',
  ماركو: 'Marco',
  فلوباتير: 'Filopateer',
  مجاهد: 'Mogahed',
  متولي: 'Metwally',
  مرسي: 'Morsy',
  منتصر: 'Montaser',
  نصار: 'Nassar',
  هلال: 'Helal',
  وهبة: 'Wahba',
  يسرى: 'Yousry',
  انس: 'Anas',
  ادهم: 'Adham',
  اياد: 'Eyad',
  ايمان: 'Eman',
  بسام: 'Bassam',
  جودة: 'Gouda',
  حافظ: 'Hafez',
  حسانين: 'Hassanein',
  خضر: 'Khedr',
  دياب: 'Diab',
  رأفت: 'Raafat',
  ربيع: 'Rabie',
  رياض: 'Riad',
  زهران: 'Zahran',
  سرور: 'Sorour',
  سلطان: 'Soltan',
  شاكر: 'Shaker',
  شهاب: 'Shehab',
  صادق: 'Sadek',
  ضياء: 'Diaa',
  طلعت: 'Talaat',
  عبدو: 'Abdo',
  عرفات: 'Arafat',
  عفيفي: 'Afifi',
  عكاشة: 'Okasha',
  غالي: 'Ghaly',
  غريب: 'Gharib',
  فرج: 'Farag',
  فكري: 'Fekry',
  قطب: 'Kotb',
  قنديل: 'Kandil',
  كامل: 'Kamel',
  لبيب: 'Labib',
  محسن: 'Mohsen',
  مختار: 'Mokhtar',
  مسعود: 'Masoud',
  مصطفي: 'Mostafa',
  مكرم: 'Makram',
  منسي: 'Mansy',
  موافي: 'Mowafy',
  نوح: 'Nouh',
  هارون: 'Haroun',
  هيكل: 'Heikal',
  وفيق: 'Wafik',
  يعقوب: 'Yacoub',
  عادلي: 'Adly',
  شلبي: 'Shalaby',
  بيومي: 'Bayoumi',
  بدوي: 'Badawy',
  حجازي: 'Hegazy',
  حنفي: 'Hanafy',
  خطاب: 'Khattab',
  درويش: 'Darwish',
  سويلم: 'Sweilam',
  شرف: 'Sharaf',
  شعراوي: 'Shaarawy',
  صقر: 'Sakr',
  عبيد: 'Obeid',
  علام: 'Allam',
  عويس: 'Oweis',
  غنيم: 'Ghoneim',
  فراج: 'Farrag',
  قرني: 'Korany',
  محفوظ: 'Mahfouz',
  مرعي: 'Marey',
  مطاوع: 'Metawea',
  نجم: 'Negm',
  نوفل: 'Nofal',
  هريدي: 'Heridy',
  يوسفي: 'Youssefy',
  اسامة: 'Osama',
  // ── female given names ──
  فاطمة: 'Fatma',
  عائشة: 'Aisha',
  مريم: 'Mariam',
  سارة: 'Sara',
  هدى: 'Hoda',
  منى: 'Mona',
  دينا: 'Dina',
  ياسمين: 'Yasmin',
  اسماء: 'Asmaa',
  هبة: 'Heba',
  ندى: 'Nada',
  ريهام: 'Reham',
  شيماء: 'Shaimaa',
  امل: 'Amal',
  نورهان: 'Nourhan',
  مي: 'Mai',
  ميار: 'Mayar',
  مها: 'Maha',
  هند: 'Hend',
  رنا: 'Rana',
  ايه: 'Aya',
  اية: 'Aya',
  اسراء: 'Esraa',
  الاء: 'Alaa',
  امال: 'Amal',
  اميرة: 'Amira',
  امنية: 'Omnia',
  انجي: 'Engy',
  ايناس: 'Enas',
  بسمة: 'Basma',
  بسنت: 'Bassant',
  جنى: 'Gana',
  جيهان: 'Gihan',
  حنان: 'Hanan',
  حبيبة: 'Habiba',
  حنين: 'Hanin',
  خديجة: 'Khadiga',
  دعاء: 'Doaa',
  رانيا: 'Rania',
  ربا: 'Roba',
  رحاب: 'Rehab',
  رحمة: 'Rahma',
  رشا: 'Rasha',
  رضوى: 'Radwa',
  رقية: 'Roqaya',
  روان: 'Rawan',
  ريم: 'Reem',
  زينب: 'Zeinab',
  سالي: 'Sally',
  سحر: 'Sahar',
  سعاد: 'Soad',
  سلمى: 'Salma',
  سماح: 'Samah',
  سمر: 'Samar',
  سميرة: 'Samira',
  سهام: 'Seham',
  سهير: 'Soheir',
  سوزان: 'Suzan',
  شروق: 'Shorouk',
  شهد: 'Shahd',
  شيرين: 'Shereen',
  صفاء: 'Safaa',
  عبير: 'Abeer',
  عزة: 'Azza',
  علياء: 'Alyaa',
  غادة: 'Ghada',
  فاتن: 'Faten',
  فرح: 'Farah',
  فريدة: 'Farida',
  فايزة: 'Fayza',
  لمياء: 'Lamiaa',
  لبنى: 'Lobna',
  ليلى: 'Laila',
  مروة: 'Marwa',
  مريهان: 'Merhan',
  منار: 'Manar',
  منة: 'Menna',
  ميرنا: 'Mirna',
  نادية: 'Nadia',
  نجلاء: 'Naglaa',
  نرمين: 'Nermin',
  نسرين: 'Nesreen',
  نعمة: 'Neama',
  نهى: 'Noha',
  نهال: 'Nehal',
  نيرة: 'Nayera',
  هالة: 'Hala',
  هناء: 'Hanaa',
  هيام: 'Hiam',
  وفاء: 'Wafaa',
  ولاء: 'Walaa',
  يارا: 'Yara',
  يسرا: 'Yosra',
  يمنى: 'Yomna',
  ثريا: 'Soraya',
  عفاف: 'Afaf',
  كريمة: 'Karima',
  ماجدة: 'Magda',
  مديحة: 'Madiha',
  نبيلة: 'Nabila',
  نجوى: 'Nagwa',
  نوال: 'Nawal',
  هويدا: 'Howaida',
  وداد: 'Wedad',
  سناء: 'Sanaa',
  صباح: 'Sabah',
  عطيات: 'Atiat',
  فوزية: 'Fawzia',
  زينات: 'Zeinat',
  تهاني: 'Tahany',
  ايات: 'Ayat',
  مارينا: 'Marina',
  ماريان: 'Marian',
  كريستين: 'Christine',
  ميريام: 'Miriam',
  دميانة: 'Demiana',
  مارثا: 'Martha',
  فيرونيا: 'Feronia',
  // ── components and common family names ──
  السيد: 'Elsayed',
  الدين: 'Eldin',
  الاسلام: 'Elislam',
  الله: 'Allah',
  عبدالله: 'Abdallah',
  الحديدي: 'Elhadidy',
  المصري: 'Elmasry',
  الشافعي: 'Elshafei',
  الشربيني: 'Elsherbiny',
  الجمل: 'Elgamal',
  النجار: 'Elnaggar',
  الشيخ: 'Elsheikh',
  العربي: 'Elaraby',
  البنا: 'Elbanna',
  الحسيني: 'Elhusseiny',
  الدسوقي: 'Eldesouky',
  الصاوي: 'Elsawy',
  الطوخي: 'Eltoukhy',
  الفقي: 'Elfeky',
  القاضي: 'Elkady',
  الهواري: 'Elhawary',
  الزيات: 'Elzayat',
  السعيد: 'Elsaeed',
  الشاذلي: 'Elshazly',
  المنشاوي: 'Elmenshawy',
  الحداد: 'Elhaddad',
  الخولي: 'Elkholy',
  الدمرداش: 'Eldemerdash',
  الغندور: 'Elghandour',
  العطار: 'Elattar',
  الحلواني: 'Elhalawany',
  رضوان: 'Radwan',
  حسنين: 'Hassanein',
  ابوزيد: 'Abouzeid',
  ابوالعلا: 'Aboulela',
};

// Second halves of 'عبد ال…' compounds, as Egyptian records spell the whole name.
const ABD_COMPOUNDS: Record<string, string> = {
  الله: 'Abdallah',
  الرحمن: 'Abdelrahman',
  الرحيم: 'Abdelrahim',
  العزيز: 'Abdelaziz',
  الحميد: 'Abdelhamid',
  الحليم: 'Abdelhalim',
  الحكيم: 'Abdelhakim',
  الحي: 'Abdelhay',
  الخالق: 'Abdelkhalek',
  الرازق: 'Abdelrazek',
  الرؤوف: 'Abdelraouf',
  الستار: 'Abdelsattar',
  السلام: 'Abdelsalam',
  السميع: 'Abdelsamie',
  الشافي: 'Abdelshafy',
  الصمد: 'Abdelsamad',
  العال: 'Abdelaal',
  العليم: 'Abdelalim',
  العظيم: 'Abdelazim',
  الغفار: 'Abdelghaffar',
  الغني: 'Abdelghany',
  الفتاح: 'Abdelfattah',
  القادر: 'Abdelkader',
  الكريم: 'Abdelkarim',
  اللطيف: 'Abdellatif',
  المجيد: 'Abdelmegeed',
  المنعم: 'Abdelmoneim',
  المطلب: 'Abdelmotaleb',
  المعطي: 'Abdelmoaty',
  المقصود: 'Abdelmaksoud',
  الناصر: 'Abdelnasser',
  النبي: 'Abdelnaby',
  الهادي: 'Abdelhady',
  الوهاب: 'Abdelwahab',
  الواحد: 'Abdelwahed',
  الباسط: 'Abdelbaset',
  الباقي: 'Abdelbaky',
  التواب: 'Abdeltawab',
  الجواد: 'Abdelgawad',
  الجليل: 'Abdelgalil',
  الحفيظ: 'Abdelhafez',
  الرشيد: 'Abdelrashid',
  المحسن: 'Abdelmohsen',
  المولى: 'Abdelmawla',
  الودود: 'Abdelwadoud',
  ربه: 'Abdrabo',
  المسيح: 'Abdelmessih',
};

const fold = (table: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(table).map(([ar, en]) => [keyOf(ar), en]));

const DICTIONARY = fold(NAMES);
const ABD = fold(ABD_COMPOUNDS);

const CONSONANTS: Record<string, string> = {
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
  غ: 'gh',
  ف: 'f',
  ق: 'k',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
};

const capitalize = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/**
 * Letter fallback for a word the dictionary does not know. Arabic script writes long vowels and
 * leaves short ones out, so the commonest Egyptian patterns are inferred: 'a' after an initial
 * consonant that is followed by another ('سمير' → 'Samir'), and between two final consonants
 * ('حسن' → 'Hasan'); و/ي read as vowels between consonants and as w/y at a syllable edge.
 */
const fallbackWord = (word: string): string => {
  const letters = [...stripMarks(word)].filter((ch) => /[ء-ي]/.test(ch));
  const isVowelLetter = (ch: string | undefined): boolean =>
    ch === 'ا' || ch === 'و' || ch === 'ي' || ch === 'ى';
  let out = '';
  letters.forEach((ch, i) => {
    const prev = letters[i - 1];
    const next = letters[i + 1];
    const last = i === letters.length - 1;
    if (ch === 'ا') out += 'a';
    else if (ch === 'ع' || ch === 'ء' || ch === 'ئ' || ch === 'ؤ') {
      if (i === 0) out += next === 'ي' ? 'e' : next === 'و' ? 'o' : 'a';
      else if (!last && prev !== 'ا' && !isVowelLetter(next)) out += 'a';
    } else if (ch === 'و')
      out += i === 0 || next === 'ا' || isVowelLetter(prev) ? 'w' : last ? 'o' : 'ou';
    else if (ch === 'ي' || ch === 'ى') {
      if (i === 0 || next === 'ا' || next === 'و') out += 'y';
      else out += last ? 'y' : 'i';
    } else if (ch === 'ة') out += 'a';
    else if (ch === 'ه' && last && i > 0) out += 'a';
    else {
      out += CONSONANTS[ch] ?? '';
      // Inferred short vowels: after a first consonant followed by another consonant, and
      // between a word's last two consonants.
      const consonantNext =
        next !== undefined && !isVowelLetter(next) && next !== 'ة' && next !== 'ه';
      const lastPair = i === letters.length - 2 && next !== undefined && !isVowelLetter(next);
      if ((i === 0 && consonantNext) || (lastPair && !(ch === 'ل' && i === 1))) out += 'a';
    }
  });
  return capitalize(out.replace(/aa+/g, 'aa').replace(/(.)\1{2,}/g, '$1$1'));
};

const lookup = (word: string): string | undefined => DICTIONARY.get(keyOf(word));

/** One word, using the dictionary, the article rule, then the letter fallback. */
const transliterateWord = (word: string): string => {
  const known = lookup(word);
  if (known !== undefined) return known;
  const key = keyOf(word);
  // A word fused onto 'عبد' ('عبدالرحمن', 'عبدربه').
  if (key.startsWith('عبد') && key.length > 3) {
    const rest = key.slice(3);
    const compound = ABD.get(rest);
    if (compound !== undefined) return compound;
    return `Abd${(rest.startsWith('ال') ? 'el' : '') + transliterateWord(rest.replace(/^ال/, '')).toLowerCase()}`;
  }
  // A word fused onto 'ابو' ('ابوزيد').
  if (key.startsWith('ابو') && key.length > 3) {
    return `Abou${transliterateWord(key.slice(3).replace(/^ال/, '')).toLowerCase()}`;
  }
  // The article: 'El' + the word ('الحديدي' → 'Elhadidy').
  if (key.startsWith('ال') && key.length > 3) {
    const rest = key.slice(2);
    return `El${(lookup(rest) ?? fallbackWord(rest)).toLowerCase()}`;
  }
  return fallbackWord(word);
};

/**
 * Transliterate an Arabic full name to a suggested Latin form. Returns '' when there is nothing
 * to transliterate (no Arabic letters) so callers can leave the field untouched.
 */
export const transliterateArabicName = (arabic: string): string => {
  const cleaned = stripMarks(arabic)
    .replace(/[^ء-ي\s]/g, ' ')
    .trim();
  if (cleaned === '' || !/[ء-ي]/.test(cleaned)) return '';
  const words = cleaned.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as string;
    const next = words[i + 1];
    const key = keyOf(word);
    // 'عبد' written apart from what it governs: 'عبد الرحمن', 'عبد ربه', 'عبد الله'.
    if (key === 'عبد' && next !== undefined) {
      const nextKey = keyOf(next);
      const compound = ABD.get(nextKey);
      out.push(
        compound ??
          `Abd${(nextKey.startsWith('ال') ? 'el' : '') + transliterateWord(nextKey.replace(/^ال/, '')).toLowerCase()}`,
      );
      i += 1;
      continue;
    }
    // 'ابو' written apart: 'ابو بكر' → 'Abobakr' is a given name; otherwise 'Abou' + the name.
    if (key === 'ابو' && next !== undefined) {
      const nextKey = keyOf(next);
      out.push(
        lookup(`ابو${nextKey}`) ??
          `Abou${transliterateWord(nextKey.replace(/^ال/, '')).toLowerCase()}`,
      );
      i += 1;
      continue;
    }
    const word2 = transliterateWord(word);
    if (word2 !== '') out.push(word2);
  }
  return out.join(' ').trim();
};
