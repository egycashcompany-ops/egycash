// The house's own Fleet vocabulary — the names alone, in both languages.
//
// Split out of `vocabulary.ts` so the catalog write paths can ask it for an English name: that file
// applies the lists through the catalog service, and the catalog service importing it back would
// be a cycle. This one imports nothing that runs. See `vocabulary.ts` for where the lists came from
// and why every name carries its English.
import { type FleetCatalogKind } from '@ecms/contracts';

/** One catalog row as the house names it, in both languages. */
export interface VocabularyName {
  ar: string;
  en: string;
}

/**
 * Which work types RESET the maintenance counter — «صيانة» and «صيانة + إصلاح», named by the owner.
 *
 * This is the single most consequential flag in the file. A visit whose work type is not counted
 * leaves the alarm measuring from the service before it, and says nothing while it does: the car
 * reads «لا صيانة محسوبة بعد» on the alarms board and nobody is told why. That is exactly what
 * happened on vehicle 150, with «تقطيع» — hours spent looking for a broken calculation that was
 * working correctly on a flag nobody had ticked.
 */
export const COUNTING_WORK_TYPES: readonly string[] = ['صيانة', 'صيانة + إصلاح'];

const n = (ar: string, en: string): VocabularyName => ({ ar, en });

/** `fleet_destinations` — where a car is sent for work. «الورشة» on the maintenance screens. */
const WORKSHOPS: readonly VocabularyName[] = [
  n('mcv', 'MCV'),
  n('مصنع قادر', 'Kader Factory'),
  n('تويوتا', 'Toyota'),
  n('MG', 'MG'),
  n('بيجو', 'Peugeot'),
  n('جيلى', 'Geely'),
  n('سوزوكى', 'Suzuki'),
  n('Bus Egypt', 'Bus Egypt'),
  n('سوق محلى', 'Local market'),
  n('نيسان', 'Nissan'),
  n('توكيل + مصنع', 'Dealer + factory'),
  n('تكنو وان', 'Techno One'),
];

/**
 * `fleet_works` — «نوع العمل» on a workshop visit. Two of them count; see above.
 *
 * «صيانة» is written as «Periodic maintenance» because that is the English the boot seed has
 * always given that row, and the seed reaches it first: a different string here would not change
 * the row (ensure leaves an existing one alone) — it would only make this list disagree with it.
 */
const WORK_TYPES: readonly VocabularyName[] = [
  n('صيانة', 'Periodic maintenance'),
  n('إصلاح', 'Repair'),
  n('تغيير زجاج', 'Glass replacement'),
  n('سمكرة', 'Bodywork'),
  n('بطاريه', 'Battery'),
  n('معايرات بالجهاز', 'Machine calibration'),
  n('ضبط الفرامل', 'Brake adjustment'),
  n('ضبط دبرياج', 'Clutch adjustment'),
  n('صيانة + إصلاح', 'Maintenance + repair'),
];

/** `fleet_ops_tybe` — «نوع المأمورية» the roster assigns a crew to. */
const MISSION_TYPES: readonly VocabularyName[] = [
  n('نقل أموال (يومي)', 'Cash transport (daily)'),
  n('سفر', 'Travel'),
  n('إحتياطي سفر', 'Travel standby'),
  n('مسائي', 'Evening'),
  n('محصنة', 'Armoured'),
  n('شلاتين', 'Shalateen'),
  n('إيباج', 'Ebag'),
  n('بدون سائق', 'Without driver'),
  n('ضم ATM', 'ATM consolidation'),
  n('إحتياطى', 'Standby'),
  n('أسوان', 'Aswan'),
  n('مأمورية', 'Assignment'),
];

/** `fleet_insurance` — «شركة التأمين» on a vehicle. */
const INSURERS: readonly VocabularyName[] = [
  n('الدلتا للتأمين', 'Delta Insurance'),
  n('مصر للتأمين', 'Misr Insurance'),
];

/**
 * `fleet_spare_parts` — «قطع الغيار» fitted on a visit. The longest list, and the one the
 * maintenance dialogs can grow from the workshop floor when a part is missing.
 *
 * The English is the workshop's English — «جاز» is diesel in Egypt, «باكم» the brake vacuum
 * pump, «مقص» a control arm, «ميزان» the stabiliser bar — and a name whose only meaning is the
 * house's own slang («اسكاترا», the steering linkage) keeps that word in brackets so the two
 * columns can still be matched by eye.
 */
const SPARE_PARTS: readonly VocabularyName[] = [
  n('رشاش', 'Injector'),
  n('فلتر جاز', 'Diesel filter'),
  n('زيت', 'Oil'),
  n('فلتر زيت', 'Oil filter'),
  n('فلتر هواء', 'Air filter'),
  n('فلتر تكييف', 'A/C filter'),
  n('فلتر فاصل', 'Separator filter'),
  n('شحن فريون', 'Freon recharge'),
  n('سربنتينة تكييف', 'A/C coil'),
  n('سربنتينة مياة', 'Water coil'),
  n('سربنتينة زيت', 'Oil cooler coil'),
  n('سيرفو', 'Brake servo'),
  n('طلمبة جاز', 'Diesel pump'),
  n('طلمبة زيت', 'Oil pump'),
  n('طلمبة مياه', 'Water pump'),
  n('مارش', 'Starter motor'),
  n('دينامو', 'Alternator'),
  n('كومبروسور تكييف', 'A/C compressor'),
  n('طنبورة كرنك', 'Crankshaft pulley'),
  n('كلاتش مروحة', 'Fan clutch'),
  n('مروحة تبريد', 'Cooling fan'),
  n('سير مجموعة', 'Serpentine belt'),
  n('سير تكييف أمامى', 'Front A/C belt'),
  n('سير تكييف خلفى', 'Rear A/C belt'),
  n('كوز فرامل', 'Brake wheel cylinder'),
  n('قربة مياه ردياتير', 'Radiator expansion tank'),
  n('قربة مياه مساحات', 'Washer fluid reservoir'),
  n('طقم مساحات', 'Wiper blade set'),
  n('قرص طارة دركسيون', 'Steering wheel disc'),
  n('لمبة فانوس', 'Headlamp bulb'),
  n('موتور مساحات', 'Wiper motor'),
  n('جاويط عجل', 'Wheel stud'),
  n('صامولة عجل', 'Wheel nut'),
  n('إسكترا', 'Steering linkage (scatra)'),
  n('خرطوم هواء', 'Air hose'),
  n('خرطوم جاز', 'Diesel hose'),
  n('خرطوم تكييف', 'A/C hose'),
  n('طقم تيل أمامى', 'Front brake pads set'),
  n('طقم تيل خلفى', 'Rear brake pads set'),
  n('طقم دبرياج', 'Clutch kit'),
  n('فولام', 'Flywheel'),
  n('إسطوانة دبرياج', 'Clutch slave cylinder'),
  n('دسك دبرياج', 'Clutch disc'),
  n('بلية دبرياج', 'Clutch release bearing'),
  n('طقم دسك أمامى', 'Front brake discs set'),
  n('طقم دسك خلفى', 'Rear brake discs set'),
  n('حساس إيرماس', 'Air mass sensor'),
  n('حساس فرامل', 'Brake sensor'),
  n('مساعدين أمامى', 'Front shock absorbers'),
  n('مساعدين خلفى', 'Rear shock absorbers'),
  n('مساعدين كابينة', 'Cabin shock absorbers'),
  n('فتيس', 'Gearbox'),
  n('زيت محرك', 'Engine oil'),
  n('زيت فتيس', 'Gearbox oil'),
  n('زيت كارونة', 'Differential oil'),
  n('زيت باكم', 'Vacuum pump oil'),
  n('زيت باور', 'Power steering oil'),
  n('زجاج أمامى', 'Windscreen'),
  n('ضبط زوايا', 'Wheel alignment'),
  n('اصلاح باب سائق', 'Driver door repair'),
  n('اصلاح باب قائد', 'Crew leader door repair'),
  n('قاعدة كومبروسور', 'Compressor mount'),
  n('تثبيت خزنة', 'Safe mounting'),
  n('تغيير كالون مشفر', 'Coded lock replacement'),
  n('اصلاح سارينة', 'Siren repair'),
  n('اصلاح فنار', 'Headlamp repair'),
  n('كومبروسور كهرباء', 'Electric compressor'),
  n('تغيير شاشة كاميرات', 'Camera screen replacement'),
  n('تغيير كاميرا', 'Camera replacement'),
  n('اصلاح باب خزنة داخلى', 'Inner safe door repair'),
  n('اصلاح باب خزنة خلفى', 'Rear safe door repair'),
  n('اصلاح باب جرار', 'Sliding door repair'),
  n('بطارية سيارة', 'Car battery'),
  n('بطارية ريموت', 'Remote battery'),
  n('بكرة خشنه', 'Grooved pulley'),
  n('بكرة ناعمه', 'Smooth pulley'),
  n('DVR', 'DVR'),
  n('تيل فرامل يد', 'Handbrake shoes'),
  n('اصلاح الونش', 'Winch repair'),
  n('ماستر دبرياج', 'Clutch master cylinder'),
  n('ماسورة باكم', 'Vacuum pipe'),
  n('اصلاح مرش', 'Washer nozzle repair'),
  n('مسورة تغزيه', 'Feed pipe'),
  n('2 بطاريه سياره', '2 car batteries'),
  n('صرة عجل أمامى يمين', 'Front right wheel hub'),
  n('صرة عجل أمامى شمال', 'Front left wheel hub'),
  n('دورة جاز', 'Diesel circuit'),
  n('3 حزام امان', '3 seat belts'),
  n('ريداتير', 'Radiator'),
  n('شكمان', 'Exhaust'),
  n('ارماس', 'Air mass sensor (MAF)'),
  n('شورت بلوك', 'Short block'),
  n('بطاريه الاضافيه', 'Auxiliary battery'),
  n('2 تيش اسكاترا', '2 steering linkage rods (scatra)'),
  n('2 بيضة اسكاترا', '2 tie rod ends (scatra)'),
  n('2 مقص امامى', '2 front control arms'),
  n('انتلركولر', 'Intercooler'),
  n('معيره', 'Calibration'),
  n('مستر دبرياج علوى', 'Upper clutch master (mister)'),
  n('مشترك مساحات', 'Wiper linkage'),
  n('واير فرامل يد', 'Handbrake cable'),
  n('ماسورة جاز', 'Diesel pipe'),
  n('ترباس خزنة داخلى', 'Inner safe bolt'),
  n('فلتر سربنتينة تكييف', 'A/C coil filter'),
  n('كوعة مياة تبريد زيت', 'Oil cooler water elbow'),
  n('جلب مقصات', 'Control arm bushes'),
  n('زوايا', 'Alignment'),
  n('بارات داخلى', 'Inner bars'),
  n('بارات خارجى', 'Outer bars'),
  n('مسمار ميزان امامى', 'Front stabiliser link'),
  n('كاوتش ميزان', 'Stabiliser bar bush'),
  n('قاعدة فلتر جاز', 'Diesel filter housing'),
  n('خرطوم قربة', 'Reservoir hose'),
  n('حساس ABS', 'ABS sensor'),
  n('فيشة ضفيرة ABS', 'ABS harness connector'),
  n('خرطوم باكم', 'Vacuum hose'),
  n('باب خلفى', 'Rear door'),
  n('بلف منظم تربو', 'Turbo regulator valve'),
  n('طقم طنابير امامى', 'Front brake drums set'),
  n('طقم طنابير خلفى', 'Rear brake drums set'),
  n('ماسورة تكييف', 'A/C pipe'),
  n('طقم بطاريات', 'Battery set'),
  n('حساس كرنك', 'Crankshaft sensor'),
  n('ماستر دبرياج علوى', 'Upper clutch master cylinder'),
  n('ماستر دبرياج سفلى', 'Lower clutch master cylinder'),
  n('سوستة', 'Leaf spring'),
  n('كنترول إيرباج', 'Airbag control unit'),
  n('ترصيص', 'Wheel balancing'),
  n('بلاور تكييف', 'A/C blower'),
  n('ضفيرة خلفية', 'Rear wiring harness'),
  n('مراية جمب يمين', 'Right side mirror'),
  n('مراية جمب شمال', 'Left side mirror'),
];

/**
 * The five lists, by the catalog they belong to.
 *
 * Arabic names are stored TRIMMED, and that is not cosmetic: the catalog's own duplicate guard
 * matches `name.ar` exactly, so «فلتر زيت » and «فلتر زيت» are two different parts to it — two
 * rows in the dropdown that look identical, and two halves of every report that counts them.
 */
export const FLEET_VOCABULARY: readonly {
  kind: FleetCatalogKind;
  names: readonly VocabularyName[];
}[] = [
  { kind: 'workshop', names: WORKSHOPS },
  { kind: 'workType', names: WORK_TYPES },
  { kind: 'sparePart', names: SPARE_PARTS },
  { kind: 'missionType', names: MISSION_TYPES },
  { kind: 'insuranceCompany', names: INSURERS },
];

/** Every Arabic name the vocabulary pairs with its English — the translations the house made. */
export const FLEET_VOCABULARY_PAIRS: readonly (readonly [string, string])[] =
  FLEET_VOCABULARY.flatMap((list) => list.names.map((name) => [name.ar, name.en] as const));
