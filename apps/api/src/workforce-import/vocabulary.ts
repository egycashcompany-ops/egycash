// Mapping what HR typed onto the closed vocabularies the system actually has.
//
// The workbook is free text where ECMS has enums, and the spread is not small: `الموقف من التجنيد`
// has SIXTEEN distinct values for four real states — `ادى الخدمه`, `ادى الخدمة` and `أدى الخدمة`
// are the same thing spelled three ways (477 + 438 + 47 employees), and three cells contain dates.
// `سبب الإستبعاد` has eleven values for five exit types, `الوفاه`/`الوفاة`/`حالة وفاة`/`متوفى`
// among them.
//
// Everything here returns `null` for "I do not know what this is" rather than guessing a default.
// A guessed military status is a false statement on someone's file; an unmapped value is a line in
// the rejection report that a human resolves. That asymmetry is the whole design of this module.
import {
  type EmployeeExitType,
  type EducationLevel,
  type InsuranceStatus,
  type MaritalStatus,
  type MilitaryStatus,
  type WeaponLicenseType,
} from '@ecms/contracts';

/** Fold spelling variation so one concept is not four entries: hamza forms, ة/ه, ى/ي, spacing. */
const fold = (s: string): string =>
  s
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
    .replace(/[إأآا]/gu, 'ا')
    .replace(/[ىي]/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[ظض]/gu, 'ض') // `ظابط` for `ضابط` is pervasive in this file
    .replace(/\s+/gu, ' ')
    .trim();

const lookup = <T>(table: Record<string, T>) => {
  const folded = new Map<string, T>(Object.entries(table).map(([k, v]) => [fold(k), v]));
  return (raw: string | null): T | null => (raw === null ? null : (folded.get(fold(raw)) ?? null));
};

/** `الحالة الاجتماعية` — four values, an exact match to the platform enum. */
export const maritalStatus = lookup<MaritalStatus>({
  اعزب: 'single',
  عزباء: 'single',
  متزوج: 'married',
  متزوجة: 'married',
  مطلق: 'divorced',
  مطلقة: 'divorced',
  ارمل: 'widowed',
  ارملة: 'widowed',
});

/**
 * `الموقف من التجنيد`. An officer has served — `ظابط`, `ظابط شرف`, `عريف` are 217 employees whose
 * service is complete, so they map to `completed` rather than to a status of their own; the RANK
 * itself is preserved on the officer block, which is where a rank belongs.
 *
 * `لم يصبه الدور` (his turn has not come) and `مطلوب للتجنيد` (called up) are `postponed`: neither
 * is exemption and neither is completion. The three date cells and `نموذج` map to nothing.
 */
export const militaryStatus = lookup<MilitaryStatus>({
  'ادى الخدمه': 'completed',
  'ادى الخدمة': 'completed',
  'أدى الخدمة': 'completed',
  'ادى الخدمة العسكرية': 'completed',
  ادى: 'completed',
  'انهى الخدمة': 'completed',
  ظابط: 'completed',
  'ظابط شرف': 'completed',
  'ظابط احتياط': 'completed',
  عريف: 'completed',
  رقيب: 'completed',
  اعفاء: 'exempted',
  'اعفاء نهائي': 'exempted',
  'اعفاء نهائى': 'exempted',
  'معافي نهائيا': 'exempted',
  'اعفاء قوات مسلحه': 'exempted',
  'اعفاء مؤقت': 'postponed',
  'لم يصبه الدور': 'postponed',
  'مطلوب للتجنيد': 'postponed',
  مؤجل: 'postponed',
  'يؤدي الخدمة': 'serving',
  'لا ينطبق': 'notApplicable',
});

/**
 * `سبب الإستبعاد` → the exit type.
 *
 * `انقطاع` (absconding, 120 people) and `عدم صلاحية` (unsuitability, 42) are terminations: the
 * company ended the employment. `ايقاف` likewise. `عدم تجديد` and `انتهاء التعاقد` are
 * `endOfContract` — the term simply ran out, which is a different fact about a person than being
 * dismissed, and the distinction follows them into any future rehire decision.
 */
export const exitType = lookup<EmployeeExitType>({
  استقالة: 'resignation',
  استقاله: 'resignation',
  'استقالة بدون اخطار': 'resignation',
  انقطاع: 'termination',
  'عدم صلاحية': 'termination',
  'عدم صلاحيه': 'termination',
  ايقاف: 'termination',
  فصل: 'termination',
  'عدم تجديد': 'endOfContract',
  'انتهاء التعاقد': 'endOfContract',
  'انتهاء العقد': 'endOfContract',
  الوفاه: 'death',
  الوفاة: 'death',
  'حالة وفاة': 'death',
  متوفى: 'death',
  وفاة: 'death',
  المعاش: 'retirement',
  'بلوغ السن': 'retirement',
});

/**
 * `الحالة التأمينية`. The column is contaminated — fourteen distinct values, of which ten are JOB
 * TITLES that ended up in the wrong column (`سائق`, `اخصائى صراف الى`, and a bare `÷`). Only the
 * four real answers map; the rest return null and land in the rejection report, because writing
 * "this employee's insurance status is: driver" would be worse than recording nothing.
 */
export const insuranceStatus = lookup<InsuranceStatus>({
  'مؤمن عليه': 'insured',
  'مؤمن علية': 'insured',
  'غير مؤمن عليه': 'notInsured',
  'غير مؤمن علية': 'notInsured',
});

/** `رخصة السلاح` — who the licence is held by. */
export const weaponLicenseType = lookup<WeaponLicenseType>({
  شخصى: 'personal',
  شخصي: 'personal',
  شركة: 'company',
  شركه: 'company',
  موتوسيكل: 'motorcycle',
});

/**
 * `المؤهل الدراسي` → the education LEVEL, read from the qualification's opening word.
 *
 * There are 226 distinct qualification strings — `بكالوريوس تجاره`, `ليسانس حقوق`, `دبلوم تجارى` —
 * and the level is the first word of nearly all of them. This is a prefix match rather than a
 * lookup for that reason. The full string is preserved separately as the specialization, so
 * nothing is lost when the level is all this can determine.
 */
export const educationLevel = (raw: string | null): EducationLevel | null => {
  if (raw === null) return null;
  const s = fold(raw);
  if (/^(دكتوراه|دكتوراة|phd)/u.test(s)) return 'doctorate';
  if (/^(ماجستير|ماجيستير)/u.test(s)) return 'master';
  if (/^(بكالوريوس|بكالريوس|ليسانس|بكالوريس)/u.test(s)) return 'bachelor';
  if (/^(دبلوم|دبلومه|معهد)/u.test(s)) return 'diploma';
  if (/^(ثانوي|ثانويه|توجيهي)/u.test(s)) return 'secondary';
  if (/^(اعدادي|اعداديه)/u.test(s)) return 'preparatory';
  if (/^(ابتدائي|ابتدائيه)/u.test(s)) return 'primary';
  if (/^(محو اميه|بدون مؤهل|يقرا ويكتب|امي)/u.test(s)) return 'none';
  return null;
};

/**
 * Fold an org-unit name for MATCHING against what exists in ECMS.
 *
 * `القسم` has 45 distinct values that are far fewer real sections: `الرقابة والمستهلكات` and
 * `الرقابة و المستهلكات`, `التشغيل ( ادارى )` and `التشغيل ( إدارى )`, `التشغيل (خارجى)` and
 * `التشغيل ( خارجى )`. Folding lets those meet without anybody editing the source file.
 *
 * Matching only — the name that gets CREATED is the one the sheet actually contains, so the
 * organization keeps the company's own spelling rather than this function's normalization.
 */
export const orgKey = (raw: string | null): string | null => {
  if (raw === null) return null;
  const s = fold(raw)
    .replace(/[()]/gu, ' ')
    // A standalone conjunction is joined to the word it introduces, so `الرقابة و المستهلكات` and
    // `الرقابة والمستهلكات` meet. Written as an explicit space-و-space match: JS `\b` is defined
    // over ASCII word characters and never fires next to an Arabic letter, so a `\bو` here would
    // silently do nothing — which is exactly how the first version of this failed.
    .replace(/ و /gu, ' و')
    .replace(/\s+/gu, ' ')
    .trim();
  return s === '' ? null : s;
};
