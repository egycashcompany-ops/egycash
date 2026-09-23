// Every sentence the import says to a person, in both languages, in one place.
//
// THE SCREEN THIS FIXES. The roster preview is Arabic — its title, its counts, its column names —
// and the reasons inside it were English, verbatim from the code that decided them: «conflicting
// duplicate rows for one employment», «exit reason is blank — fill it in and re-run», «"المهندسين"
// already exists with code BR1». An HR manager approving a write to 2,600 records was being asked
// to act on sentences in a language the rest of the screen had told them they would not need.
//
// So a reason is a VALUE, not a string: `{ ar, en }`, the same `LocalizedString` every org entity
// already carries, chosen by the reader's locale at the last possible moment. The catalogue is a
// closed set of functions rather than a bag of strings so that a reason cannot be produced without
// both halves — a new rejection that forgets Arabic does not compile.
//
// The English is kept EXACTLY as it was, on purpose: `plan.spec.ts` pins several of these phrases
// and they are the ones operators have already read in logs. Only the language the screen shows
// changes; nothing the tests asserted becomes untrue.
import type { LocalizedString } from '@ecms/contracts';

const both = (ar: string, en: string): LocalizedString => ({ ar, en });

/** Why a ROW could not be read at all (`plan.ts`). */
export const rowReasons = {
  noCode: () => both('لا يوجد كود موظف', 'no employee code'),
  noArabicName: () => both('لا يوجد اسم بالعربي', 'no Arabic name'),
  noHireDate: () => both('لا يوجد تاريخ تعيين', 'no hiring date'),
  noSite: () => both('لا يوجد موقع (الموقع)', 'no site (الموقع)'),
  noDepartment: () => both('لا توجد إدارة (الإدارة)', 'no department (الإدارة)'),
  noJobTitle: () => both('لا توجد وظيفة (الوظيفة)', 'no job title (الوظيفة)'),
  noExitDate: () => both('لا يوجد تاريخ خروج', 'no exit date'),
  exitReasonBlank: () =>
    both('سبب الخروج فارغ — يُرجى استيفاؤه وإعادة رفع الملف', 'exit reason is blank — fill it in and re-run'),
  exitReasonUnknown: (reason: string) =>
    both(
      `سبب الخروج «${reason}» ليس من الأسباب المعروفة`,
      `exit reason "${reason}" is not one of the recognised reasons`,
    ),
  exitBeforeHire: () =>
    both(
      'تاريخ الخروج سابق لتاريخ التعيين — أحدهما غير صحيح',
      'exit date is before the hiring date — one of the two is wrong',
    ),
  duplicatePeriod: (sameExit: boolean) =>
    both(
      `صفوف مكرّرة متعارضة لنفس فترة العمل (نفس تاريخ التعيين${sameExit ? ' وتاريخ الخروج' : ''}) — تتطلب قرارًا من مسؤول قبل الاستيراد`,
      `conflicting duplicate rows for one employment (same hire date${sameExit ? ' and exit date' : ''})` +
        ' — needs a human decision before import',
    ),
  badCodeShape: (code: string) =>
    both(
      `كود الموظف «${code}» ليس على صيغة <٣ أرقام للفرع><٤ أرقام للرقم>`,
      `employee code "${code}" is not <3-digit branch><4-digit number>`,
    ),
} as const;

/** Why a PERSON who was read could still not be imported (`run.ts`). */
export const personReasons = {
  codeHeldByDeleted: (code: string) =>
    both(
      `الكود ${code} محجوز لسجل موظف محذوف ما زال شاغلًا له في الفهرس. يُرجى استعادة السجل أو حذفه نهائيًا ثم إعادة المحاولة.`,
      `code ${code} is held by a DELETED employee record, which still occupies it in the unique ` +
        'index. Restore that record or purge it, then re-run.',
    ),
  couldNotPlace: () =>
    both(
      'تعذّر تحديد موضع الشخص في الهيكل (الموقع/الإدارة/الوظيفة)',
      'could not place this person in the organization (site/department/job title)',
    ),
  /** A thrown error's message, when nothing more specific was decided. Shown as-is in both. */
  unexpected: (message: string) => both(message, message),
} as const;

/** A change the file asks for that the importer will not make (`sync.ts`, `run.ts`). */
export const refusalReasons = {
  nationalIdDiffers: () =>
    both(
      'السجل يحمل رقمًا قوميًا مختلفًا بالفعل — وتغيير هوية شخص ليس تعديلًا يُجرى من ملف',
      'the record already holds a different National ID — re-identifying a person is not an ' +
        'import edit',
    ),
  rehireNeedsDecision: () =>
    both(
      'الملف يُدرج الشخص على رأس العمل بينما السجل يُظهره منتهي الخدمة — وعودة أي شخص إلى العمل قرار «إعادة تعيين» يُسجَّل، ولا يملك الملف اتخاذه',
      'the file lists this person as serving but the registry has them exited — bringing ' +
        'somebody back is a Rehire, which records a decision an upload cannot make',
    ),
} as const;

/** Something about the org structure the reader must decide by hand (`org.ts`). */
export const orgNotes = {
  siteHasNoCode: (site: string) =>
    both(
      `الموقع «${site}» ليس له بادئة كود موظف خاصة به — لذا يتعذّر تحديد موضعه`,
      `site "${site}" has no employee-code prefix of its own — cannot place it`,
    ),
  branchCodeMismatch: (name: string, existingCode: string, sheetCode: string) =>
    both(
      `فرع «${name}» مسجَّل بكود ${existingCode}، بينما يضعه الملف على ${sheetCode}. سيُستخدم الفرع المسجَّل كما هو دون تغيير كوده؛ وأكواد الموظفين مأخوذة من الملف في الحالتين. فإذا كان الملف هو الصحيح، فيُرجى تصحيح كود الفرع يدويًا.`,
      `"${name}" already exists with code ${existingCode}, but the sheet places it at ${sheetCode}. ` +
        'The existing branch is used as it is and its code is NOT changed; employee codes come ' +
        'from the sheet either way. Correct the branch code by hand if the sheet is right.',
    ),
} as const;
