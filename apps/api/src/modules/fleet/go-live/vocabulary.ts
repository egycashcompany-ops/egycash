// The house's own Fleet vocabulary, as DATA — the lists the owner handed over from the legacy
// system, ready to be put into the catalogs the Fleet screens read.
//
// IT LIVES IN THE MODULE BECAUSE THE BOOT SEED IS ITS CALLER. It began beside the CLI that was
// meant to apply it, and that placement was the mistake: a list that arrives only when somebody
// remembers to type a command is a list that does not arrive. `fleet.seed.ts` now applies it on
// every boot, exactly as it applies the driver catalogs beside it, so a deploy carries the
// vocabulary the way a deploy carries everything else. `fleet-vocabulary.cli.ts` still re-exports
// this and still works; it is no longer the only way in.
//
// Importable and side-effect free. The split is the same one `seed-demo.ts` makes, and for the
// same reason: a list this long is worth reading in a test without booting a platform to do it.
import { type FleetCatalogKind } from '@ecms/contracts';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import { FleetCatalogItemModel } from '../catalogs/catalog-item.model';

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

/** `fleet_destinations` — where a car is sent for work. «الورشة» on the maintenance screens. */
const WORKSHOPS: readonly string[] = [
  'mcv',
  'مصنع قادر',
  'تويوتا',
  'MG',
  'بيجو',
  'جيلى',
  'سوزوكى',
  'Bus Egypt',
  'سوق محلى',
  'نيسان',
  'توكيل + مصنع',
  'تكنو وان',
];

/** `fleet_works` — «نوع العمل» on a workshop visit. Two of them count; see above. */
const WORK_TYPES: readonly string[] = [
  'صيانة',
  'إصلاح',
  'تغيير زجاج',
  'سمكرة',
  'بطاريه',
  'معايرات بالجهاز',
  'ضبط الفرامل',
  'ضبط دبرياج',
  'صيانة + إصلاح',
];

/** `fleet_ops_tybe` — «نوع المأمورية» the roster assigns a crew to. */
const MISSION_TYPES: readonly string[] = [
  'نقل أموال (يومي)',
  'سفر',
  'إحتياطي سفر',
  'مسائي',
  'محصنة',
  'شلاتين',
  'إيباج',
  'بدون سائق',
  'ضم ATM',
  'إحتياطى',
  'أسوان',
  'مأمورية',
];

/** `fleet_insurance` — «شركة التأمين» on a vehicle. */
const INSURERS: readonly string[] = ['الدلتا للتأمين', 'مصر للتأمين'];

/** `fleet_spare_parts` — «قطع الغيار» fitted on a visit. The longest list, and the one the
 *  maintenance dialogs can now grow from the workshop floor when a part is missing. */
const SPARE_PARTS: readonly string[] = [
  'رشاش',
  'فلتر جاز',
  'زيت',
  'فلتر زيت',
  'فلتر هواء',
  'فلتر تكييف',
  'فلتر فاصل',
  'شحن فريون',
  'سربنتينة تكييف',
  'سربنتينة مياة',
  'سربنتينة زيت',
  'سيرفو',
  'طلمبة جاز',
  'طلمبة زيت',
  'طلمبة مياه',
  'مارش',
  'دينامو',
  'كومبروسور تكييف',
  'طنبورة كرنك',
  'كلاتش مروحة',
  'مروحة تبريد',
  'سير مجموعة',
  'سير تكييف أمامى',
  'سير تكييف خلفى',
  'كوز فرامل',
  'قربة مياه ردياتير',
  'قربة مياه مساحات',
  'طقم مساحات',
  'قرص طارة دركسيون',
  'لمبة فانوس',
  'موتور مساحات',
  'جاويط عجل',
  'صامولة عجل',
  'إسكترا',
  'خرطوم هواء',
  'خرطوم جاز',
  'خرطوم تكييف',
  'طقم تيل أمامى',
  'طقم تيل خلفى',
  'طقم دبرياج',
  'فولام',
  'إسطوانة دبرياج',
  'دسك دبرياج',
  'بلية دبرياج',
  'طقم دسك أمامى',
  'طقم دسك خلفى',
  'حساس إيرماس',
  'حساس فرامل',
  'مساعدين أمامى',
  'مساعدين خلفى',
  'مساعدين كابينة',
  'فتيس',
  'زيت محرك',
  'زيت فتيس',
  'زيت كارونة',
  'زيت باكم',
  'زيت باور',
  'زجاج أمامى',
  'ضبط زوايا',
  'اصلاح باب سائق',
  'اصلاح باب قائد',
  'قاعدة كومبروسور',
  'تثبيت خزنة',
  'تغيير كالون مشفر',
  'اصلاح سارينة',
  'اصلاح فنار',
  'كومبروسور كهرباء',
  'تغيير شاشة كاميرات',
  'تغيير كاميرا',
  'اصلاح باب خزنة داخلى',
  'اصلاح باب خزنة خلفى',
  'اصلاح باب جرار',
  'بطارية سيارة',
  'بطارية ريموت',
  'بكرة خشنه',
  'بكرة ناعمه',
  'DVR',
  'تيل فرامل يد',
  'اصلاح الونش',
  'ماستر دبرياج',
  'ماسورة باكم',
  'اصلاح مرش',
  'مسورة تغزيه',
  '2 بطاريه سياره',
  'صرة عجل أمامى يمين',
  'صرة عجل أمامى شمال',
  'دورة جاز',
  '3 حزام امان',
  'ريداتير',
  'شكمان',
  'ارماس',
  'شورت بلوك',
  'بطاريه الاضافيه',
  '2 تيش اسكاترا',
  '2 بيضة اسكاترا',
  '2 مقص امامى',
  'انتلركولر',
  'معيره',
  'مستر دبرياج علوى',
  'مشترك مساحات',
  'واير فرامل يد',
  'ماسورة جاز',
  'ترباس خزنة داخلى',
  'فلتر سربنتينة تكييف',
  'كوعة مياة تبريد زيت',
  'جلب مقصات',
  'زوايا',
  'بارات داخلى',
  'بارات خارجى',
  'مسمار ميزان امامى',
  'كاوتش ميزان',
  'قاعدة فلتر جاز',
  'خرطوم قربة',
  'حساس ABS',
  'فيشة ضفيرة ABS',
  'خرطوم باكم',
  'باب خلفى',
  'بلف منظم تربو',
  'طقم طنابير امامى',
  'طقم طنابير خلفى',
  'ماسورة تكييف',
  'طقم بطاريات',
  'حساس كرنك',
  'ماستر دبرياج علوى',
  'ماستر دبرياج سفلى',
  'سوستة',
  'كنترول إيرباج',
  'ترصيص',
  'بلاور تكييف',
  'ضفيرة خلفية',
  'مراية جمب يمين',
  'مراية جمب شمال',
];

/**
 * The five lists, by the catalog they belong to.
 *
 * Names are stored TRIMMED, and that is not cosmetic: the catalog's own duplicate guard matches
 * `name.ar` exactly, so «فلتر زيت » and «فلتر زيت» are two different parts to it — two rows in the
 * dropdown that look identical, and two halves of every report that counts them.
 */
export const FLEET_VOCABULARY: readonly { kind: FleetCatalogKind; names: readonly string[] }[] = [
  { kind: 'workshop', names: WORKSHOPS },
  { kind: 'workType', names: WORK_TYPES },
  { kind: 'sparePart', names: SPARE_PARTS },
  { kind: 'missionType', names: MISSION_TYPES },
  { kind: 'insuranceCompany', names: INSURERS },
];

export interface VocabularyChange {
  kind: FleetCatalogKind;
  name: string;
  /** `create` = not there at all. `flag` = there, but not counted when it has to be. */
  action: 'create' | 'flag';
}

export interface VocabularyPlan {
  changes: VocabularyChange[];
  /** Already correct, and left alone. */
  unchanged: number;
}

const counts = (kind: FleetCatalogKind, name: string): boolean =>
  kind === 'workType' && COUNTING_WORK_TYPES.includes(name);

/**
 * What WOULD change, without changing it.
 *
 * The plan is computed against the live catalogs rather than assumed, because this runs against a
 * database somebody has already been using: most of these names are expected to be there, and the
 * only honest report is the one that says which are not.
 */
export const planFleetVocabulary = async (): Promise<VocabularyPlan> => {
  const changes: VocabularyChange[] = [];
  let unchanged = 0;
  for (const { kind, names } of FLEET_VOCABULARY) {
    for (const raw of names) {
      const name = raw.trim();
      const existing = await fleetCatalogItemRepository.findByKindAndNameAr(kind, name);
      if (existing === null) {
        changes.push({ kind, name, action: 'create' });
        continue;
      }
      // THE FLAG IS REPAIRED ON A ROW THAT ALREADY EXISTS, which `ensure` alone would not do — it
      // returns the existing document untouched. «صيانة» is very likely already in the catalog
      // from an earlier hand-entry, unflagged, and leaving it that way would reproduce the silence
      // this list is partly meant to end.
      if (counts(kind, name) && existing.countsForAlarm !== true) {
        changes.push({ kind, name, action: 'flag' });
        continue;
      }
      unchanged += 1;
    }
  }
  return { changes, unchanged };
};

/**
 * Apply a plan. Creates what is missing and flags what is mis-flagged; touches nothing else.
 *
 * `by` is the author, and `null` is the honest value for the BOOT SEED: nobody pressed anything,
 * so there is nobody to record. The operator running the CLI is a real person and is recorded as
 * one. The flag repair splits on the same fact — `update` is the audited, version-checked path a
 * person's edit goes through, and an unauthored boot write goes to the model directly, exactly as
 * `migrateViolationTypeSides` next door already does for the same kind of one-line repair.
 */
export const applyFleetVocabulary = async (
  plan: VocabularyPlan,
  by: string | null,
): Promise<VocabularyPlan> => {
  for (const change of plan.changes) {
    if (change.action === 'create') {
      await fleetCatalogItemService.ensure(
        {
          kind: change.kind,
          name: { ar: change.name, en: change.name },
          countsForAlarm: counts(change.kind, change.name),
        },
        by,
      );
      continue;
    }
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(change.kind, change.name);
    if (existing === null) continue;
    if (by === null) {
      await FleetCatalogItemModel.updateOne(
        { _id: existing._id },
        { $set: { countsForAlarm: true } },
      ).exec();
      continue;
    }
    await fleetCatalogItemService.update(
      String(existing._id),
      { countsForAlarm: true, version: existing.__v },
      by,
    );
  }
  return plan;
};
