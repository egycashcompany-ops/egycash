// Egyptian administrative geography — the governorates and the cities/markaz inside each.
//
// Records are kept in ARABIC: these values are typed into official Egyptian paperwork, and a
// transliteration would make the data disagree with the documents it describes. The English
// column exists only to bridge the National-ID number, which decodes to an English governorate
// name (`EGYPT_GOVERNORATE_CODES`), and to label the list in an English UI.
//
// `code` is the National-ID governorate code, so a number, an OCR read, and a manually chosen
// governorate all land on the same record instead of three spellings of the same place.
export interface EgyptGovernorate {
  /** National-ID governorate code — the key used by `EGYPT_GOVERNORATE_CODES`. */
  code: string;
  ar: string;
  en: string;
  /** Cities / markaz, Arabic, in the order an Egyptian list conventionally reads. */
  cities: readonly string[];
}

export const EGYPT_GOVERNORATES: readonly EgyptGovernorate[] = [
  {
    code: '01',
    ar: 'القاهرة',
    en: 'Cairo',
    cities: [
      'مصر الجديدة', 'مدينة نصر', 'المعادي', 'حلوان', 'الزمالك', 'وسط البلد', 'عابدين',
      'السيدة زينب', 'مصر القديمة', 'الخليفة', 'المقطم', 'التجمع الخامس', 'القاهرة الجديدة',
      'الشروق', 'بدر', 'العبور', 'الرحاب', 'مدينتي', '15 مايو', 'شبرا', 'روض الفرج',
      'الساحل', 'الزاوية الحمراء', 'الشرابية', 'الوايلي', 'الزيتون', 'حدائق القبة',
      'عين شمس', 'المطرية', 'المرج', 'السلام', 'مدينة السلام', 'النزهة', 'منشية ناصر',
      'الأزبكية', 'باب الشعرية', 'الجمالية', 'الموسكي', 'الدرب الأحمر', 'بولاق',
      'البساتين', 'دار السلام', 'طرة',
    ],
  },
  {
    code: '02',
    ar: 'الإسكندرية',
    en: 'Alexandria',
    cities: [
      'المنتزه', 'سيدي جابر', 'سموحة', 'شرق', 'وسط', 'غرب', 'الجمرك', 'محرم بك', 'اللبان',
      'كرموز', 'باكوس', 'فلمنج', 'ميامي', 'العصافرة', 'المندرة', 'أبو قير', 'الدخيلة',
      'العامرية', 'برج العرب', 'برج العرب الجديدة', 'العجمي', 'الساحل الشمالي',
    ],
  },
  {
    code: '03',
    ar: 'بورسعيد',
    en: 'Port Said',
    cities: [
      'بورسعيد', 'بورفؤاد', 'حي الشرق', 'حي الغرب', 'حي المناخ', 'حي الزهور', 'حي الضواحي',
      'حي العرب', 'حي الجنوب',
    ],
  },
  {
    code: '04',
    ar: 'السويس',
    en: 'Suez',
    cities: ['السويس', 'الأربعين', 'عتاقة', 'الجناين', 'فيصل', 'العين السخنة'],
  },
  {
    code: '11',
    ar: 'دمياط',
    en: 'Damietta',
    cities: [
      'دمياط', 'دمياط الجديدة', 'رأس البر', 'فارسكور', 'الزرقا', 'السرو', 'الروضة',
      'كفر البطيخ', 'عزبة البرج', 'ميت أبو غالب', 'كفر سعد',
    ],
  },
  {
    code: '12',
    ar: 'الدقهلية',
    en: 'Dakahlia',
    cities: [
      'المنصورة', 'طلخا', 'ميت غمر', 'دكرنس', 'أجا', 'منية النصر', 'السنبلاوين', 'الكردي',
      'بني عبيد', 'المنزلة', 'ميت سلسيل', 'جمصة', 'محلة دمنة', 'نبروه', 'شربين', 'المطرية',
      'بلقاس', 'تمي الأمديد', 'الجمالية', 'المنصورة الجديدة',
    ],
  },
  {
    code: '13',
    ar: 'الشرقية',
    en: 'Sharqia',
    cities: [
      'الزقازيق', 'العاشر من رمضان', 'منيا القمح', 'بلبيس', 'مشتول السوق', 'القنايات',
      'أبو حماد', 'القرين', 'ههيا', 'أبو كبير', 'فاقوس', 'الصالحية الجديدة', 'الإبراهيمية',
      'ديرب نجم', 'كفر صقر', 'أولاد صقر', 'الحسينية', 'صان الحجر', 'منشأة أبو عمر',
    ],
  },
  {
    code: '14',
    ar: 'القليوبية',
    en: 'Qalyubia',
    cities: [
      'بنها', 'شبرا الخيمة', 'قليوب', 'الخانكة', 'الخصوص', 'العبور', 'القناطر الخيرية',
      'كفر شكر', 'طوخ', 'قها', 'شبين القناطر', 'بنها الجديدة',
    ],
  },
  {
    code: '15',
    ar: 'كفر الشيخ',
    en: 'Kafr El Sheikh',
    cities: [
      'كفر الشيخ', 'دسوق', 'فوه', 'مطوبس', 'برج البرلس', 'بلطيم', 'الحامول', 'بيلا',
      'الرياض', 'سيدي سالم', 'قلين', 'سيدي غازي', 'كفر الشيخ الجديدة',
    ],
  },
  {
    code: '16',
    ar: 'الغربية',
    en: 'Gharbia',
    cities: [
      'طنطا', 'المحلة الكبرى', 'كفر الزيات', 'زفتى', 'السنطة', 'قطور', 'بسيون', 'سمنود',
    ],
  },
  {
    code: '17',
    ar: 'المنوفية',
    en: 'Monufia',
    cities: [
      'شبين الكوم', 'منوف', 'سرس الليان', 'أشمون', 'الباجور', 'قويسنا', 'بركة السبع',
      'تلا', 'الشهداء', 'السادات',
    ],
  },
  {
    code: '18',
    ar: 'البحيرة',
    en: 'Beheira',
    cities: [
      'دمنهور', 'كفر الدوار', 'رشيد', 'إدكو', 'أبو المطامير', 'أبو حمص', 'الدلنجات',
      'المحمودية', 'الرحمانية', 'إيتاي البارود', 'حوش عيسى', 'شبراخيت', 'كوم حمادة',
      'بدر', 'وادي النطرون', 'النوبارية الجديدة',
    ],
  },
  {
    code: '19',
    ar: 'الإسماعيلية',
    en: 'Ismailia',
    cities: [
      'الإسماعيلية', 'فايد', 'القنطرة شرق', 'القنطرة غرب', 'التل الكبير', 'أبو صوير',
      'القصاصين الجديدة', 'الإسماعيلية الجديدة',
    ],
  },
  {
    code: '21',
    ar: 'الجيزة',
    en: 'Giza',
    cities: [
      'الجيزة', 'الدقي', 'العجوزة', 'المهندسين', 'إمبابة', 'بولاق الدكرور', 'الهرم',
      'فيصل', 'الوراق', 'الطالبية', '6 أكتوبر', 'الشيخ زايد', 'حدائق أكتوبر', 'البدرشين',
      'الصف', 'أطفيح', 'العياط', 'الحوامدية', 'أوسيم', 'كرداسة', 'أبو النمرس',
      'منشأة القناطر', 'الواحات البحرية',
    ],
  },
  {
    code: '22',
    ar: 'بني سويف',
    en: 'Beni Suef',
    cities: [
      'بني سويف', 'بني سويف الجديدة', 'الواسطى', 'ناصر', 'إهناسيا', 'ببا', 'الفشن', 'سمسطا',
    ],
  },
  {
    code: '23',
    ar: 'الفيوم',
    en: 'Fayoum',
    cities: ['الفيوم', 'الفيوم الجديدة', 'طامية', 'سنورس', 'إطسا', 'إبشواي', 'يوسف الصديق'],
  },
  {
    code: '24',
    ar: 'المنيا',
    en: 'Minya',
    cities: [
      'المنيا', 'المنيا الجديدة', 'العدوة', 'مغاغة', 'بني مزار', 'مطاي', 'سمالوط',
      'أبو قرقاص', 'ملوي', 'دير مواس',
    ],
  },
  {
    code: '25',
    ar: 'أسيوط',
    en: 'Assiut',
    cities: [
      'أسيوط', 'أسيوط الجديدة', 'ديروط', 'منفلوط', 'القوصية', 'أبنوب', 'أبو تيج',
      'الغنايم', 'ساحل سليم', 'البداري', 'صدفا',
    ],
  },
  {
    code: '26',
    ar: 'سوهاج',
    en: 'Sohag',
    cities: [
      'سوهاج', 'سوهاج الجديدة', 'أخميم', 'أخميم الجديدة', 'البلينا', 'المراغة', 'المنشأة',
      'دار السلام', 'جرجا', 'جهينة الجديدة', 'ساقلتة', 'طما', 'طهطا', 'الكوثر',
    ],
  },
  {
    code: '27',
    ar: 'قنا',
    en: 'Qena',
    cities: [
      'قنا', 'قنا الجديدة', 'أبو تشت', 'نجع حمادي', 'دشنا', 'الوقف', 'قفط', 'نقادة',
      'فرشوط', 'قوص',
    ],
  },
  {
    code: '28',
    ar: 'أسوان',
    en: 'Aswan',
    cities: [
      'أسوان', 'أسوان الجديدة', 'دراو', 'كوم أمبو', 'نصر النوبة', 'كلابشة', 'إدفو',
      'الرديسية', 'البصيلية', 'السباعية', 'أبو سمبل السياحية',
    ],
  },
  {
    code: '29',
    ar: 'الأقصر',
    en: 'Luxor',
    cities: [
      'الأقصر', 'الأقصر الجديدة', 'إسنا', 'طيبة الجديدة', 'الزينية', 'البياضية', 'القرنة',
      'أرمنت', 'الطود',
    ],
  },
  {
    code: '31',
    ar: 'البحر الأحمر',
    en: 'Red Sea',
    cities: [
      'الغردقة', 'الدهار', 'رأس غارب', 'سفاجا', 'القصير', 'مرسى علم', 'الشلاتين',
      'حلايب', 'أبو رماد',
    ],
  },
  {
    code: '32',
    ar: 'الوادي الجديد',
    en: 'New Valley',
    cities: ['الخارجة', 'الداخلة', 'الفرافرة', 'باريس', 'بلاط'],
  },
  {
    code: '33',
    ar: 'مطروح',
    en: 'Matrouh',
    cities: [
      'مرسى مطروح', 'الحمام', 'العلمين', 'الضبعة', 'النجيلة', 'سيدي براني', 'السلوم',
      'سيوة', 'مارينا',
    ],
  },
  {
    code: '34',
    ar: 'شمال سيناء',
    en: 'North Sinai',
    cities: ['العريش', 'الشيخ زويد', 'رفح', 'بئر العبد', 'الحسنة', 'نخل'],
  },
  {
    code: '35',
    ar: 'جنوب سيناء',
    en: 'South Sinai',
    cities: [
      'الطور', 'شرم الشيخ', 'دهب', 'نويبع', 'طابا', 'سانت كاترين', 'أبو رديس',
      'أبو زنيمة', 'رأس سدر',
    ],
  },
];

const BY_CODE = new Map(EGYPT_GOVERNORATES.map((g) => [g.code, g]));
const BY_AR = new Map(EGYPT_GOVERNORATES.map((g) => [g.ar, g]));
const BY_EN = new Map(EGYPT_GOVERNORATES.map((g) => [g.en.toLowerCase(), g]));

/** Lookup by National-ID governorate code (`'01'`…`'35'`). `'88'` (born abroad) has no record. */
export const governorateByCode = (code: string): EgyptGovernorate | undefined => BY_CODE.get(code);

/**
 * Resolve whatever spelling a record carries — the Arabic name, or the English name a
 * National-ID decode / OCR read produces — to the one catalog record.
 */
export const findGovernorate = (value: string): EgyptGovernorate | undefined => {
  const v = value.trim();
  if (v === '') return undefined;
  return BY_AR.get(v) ?? BY_EN.get(v.toLowerCase()) ?? BY_CODE.get(v);
};

/** The cities of a governorate named in any accepted spelling; empty when it is unknown. */
export const citiesOfGovernorate = (governorate: string): readonly string[] =>
  findGovernorate(governorate)?.cities ?? [];

/** True when the city belongs to the governorate — the pair a form must not let drift apart. */
export const isCityOfGovernorate = (governorate: string, city: string): boolean =>
  citiesOfGovernorate(governorate).includes(city.trim());
