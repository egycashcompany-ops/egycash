// Turn a thrown value into a user-facing message. Server error messages are already
// human-readable; we override the common codes with friendlier bilingual copy and fall back
// to the server message, then to a generic string. Kept React-free so the global Query/Mutation
// error handler (outside the component tree) can use it via the store's current locale.
import { type Locale } from '@ecms/contracts';
import { ApiError } from './api-client';

const FRIENDLY: Record<Locale, Record<string, string>> = {
  en: {
    VALIDATION_FAILED: 'Some fields need your attention.',
    FORBIDDEN: 'You do not have permission to do that.',
    NOT_FOUND: 'That item could not be found.',
    CONFLICT: 'That action conflicts with the current state.',
    STALE_DOCUMENT: 'This record changed since you loaded it — please refresh and try again.',
    BUSINESS_RULE: 'That action is not allowed right now.',
    // An accident's transfer from other cars, refused inside the save (nothing written). The
    // form words both with their figures (`details`); these are the same refusals without them.
    FLEET_ACCIDENT_TRANSFER_SHORT:
      'The selected cars no longer have enough left for this amount — their figures changed since they were shown.',
    FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT:
      'The amount taken is more than this accident’s negative remaining.',
    // The shipments history refuses a range holding too many shipments rather than cutting it
    // short; the page says so in place, and this is the same refusal for a background refetch.
    OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE:
      'This range holds too many shipments to show at once — narrow the dates.',
    // A shipment's dates have a floor: «مينفعش لما يجى يضيف شحنه يختار تاريخ فات», and on an edit
    // «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة». The shipment form words both itself
    // (`operations.shipment.errors.*`); these are the same refusals anywhere else they surface.
    OPERATIONS_SHIPMENT_DATE_IN_PAST:
      'A shipment cannot be dated on a day that has passed — choose today or a later day.',
    OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL:
      'A shipment’s date cannot move earlier than the day it was on — keep it, or choose a later day.',
    // «تاريخ التسليم تانى يوم الاستلام افتراضى وممكن يغير»: a محصنة may be delivered the day it is
    // collected or later, never before. The shipment form words it on its own box too.
    OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION:
      'The delivery date cannot come before the collection date — choose the same day or a later one.',
    // «اعملى ايقون اقدر اجيب منه اللى اتمسح»: a restore of a shipment someone else already brought
    // back. Nothing is lost — it is on its day again — and the deleted list refreshes behind it.
    OPERATIONS_SHIPMENT_NOT_DELETED:
      'This shipment is no longer deleted — it is already back on its day.',
    // Round 10, the secured shipment's acts. «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من
    // القادة او العمليات او الخزنه يعدل عليها»: once the vault has received it, an edit, a delete, a
    // receipt photo or a pickup undo is refused — the screens offer none of them, so these reach a
    // reader whose screen was read before the vault's ✓ (or a colleague's ✓, for the pickup).
    OPERATIONS_SECURED_LOCKED:
      'The vault has received this secured shipment — it can no longer be changed.',
    // Since Round 13 the vault receives without a pickup («والخزنه تستلم عادي»), so this reaches only
    // the desk's undo of a pickup ✓ that is no longer there — a colleague's undo got there first.
    OPERATIONS_SECURED_NOT_PICKED_UP:
      'There is no confirmed pickup on this secured shipment to take back — nobody has confirmed collecting it from the bank.',
    OPERATIONS_SECURED_ALREADY_PICKED_UP:
      'The pickup of this secured shipment is already confirmed — by its captain or by Operations.',
    // A cancelled receipt asked for a shipment no longer in the vault (dispatched since, or never in).
    OPERATIONS_SECURED_NOT_IN_VAULT:
      'This secured shipment is not in the vault — its receipt can no longer be cancelled.',
    // «صرف الخزينة» (Round 10): a delivery crew is planned on the shipment's own delivery day, and a
    // release takes the shipments a vehicle was assigned. The screen offers only what fits; these
    // reach a reader whose crew plan or list changed under the open dialog.
    OPERATIONS_CREW_DAY_MISMATCH:
      'That crew is not planned on this shipment’s delivery day — choose one of that day’s crews.',
    OPERATIONS_CREW_CAPTAIN_MISMATCH: 'That captain is no longer on the chosen vehicle’s crew.',
    OPERATIONS_DELIVERY_LEG_REQUIRED:
      'A shipment has no delivery crew yet — assign its crew before releasing it.',
    // «توزيع المحصنات» (Round 12): the save is all or nothing, and each refusal names the shipment
    // (the screen marks its card). These reach a desk whose screen was read before a colleague, the
    // vault or the captain acted — or that was left open past midnight.
    OPERATIONS_DISTRIBUTION_DAY_IN_PAST:
      'That day has passed — its vans have left. Distribute today or a later day.',
    OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED:
      'A secured shipment on this screen has already left the vault — it can no longer be placed on a van.',
    OPERATIONS_DISTRIBUTION_NOT_ON_DAY:
      'A secured shipment is not due on this day — it cannot be placed on this day’s vans.',
    OPERATIONS_DISTRIBUTION_LEG_STARTED:
      'Its captain has already started this delivery in the app — it can no longer be moved or taken off his van.',
    ATM_MAIL_POLL_BUSY:
      'A reading of the mailbox is already running — its result appears under «Last reading» in a moment.',
    RATE_LIMITED: 'Too many requests — please slow down.',
    FILE_TOO_LARGE: 'That file is too large.',
    PAYLOAD_TOO_LARGE: 'What was sent is too large to save at once.',
    FILE_BLOCKED: 'The virus scanner blocked this file.',
    FILE_SCAN_PENDING: 'This file is still being scanned for viruses — try again in a moment.',
    // The 500 code. Without it a server fault fell through to the server's own
    // untranslated `Unexpected error`, which is what an Arabic user then read.
    INTERNAL: 'The server could not complete that request.',
    AUTH_TOKEN_EXPIRED: 'Your session expired — please sign in again.',
    AUTH_TOKEN_INVALID: 'Your session is no longer valid — please sign in again.',
    UNAUTHENTICATED: 'Your session has ended — please sign in again.',
    AUTH_SESSION_REVOKED: 'This session was signed out — please sign in again.',
    NETWORK: 'Network error — please check your connection.',
    UNKNOWN: 'Something went wrong. Please try again.',
  },
  ar: {
    VALIDATION_FAILED: 'بعض الحقول تحتاج إلى مراجعة.',
    FORBIDDEN: 'ليس لديك صلاحية للقيام بذلك.',
    NOT_FOUND: 'تعذّر العثور على هذا العنصر.',
    CONFLICT: 'هذا الإجراء يتعارض مع الحالة الحالية.',
    STALE_DOCUMENT: 'تم تعديل هذا السجل بعد تحميله — يُرجى التحديث والمحاولة مجددًا.',
    BUSINESS_RULE: 'هذا الإجراء غير مسموح حاليًا.',
    FLEET_ACCIDENT_TRANSFER_SHORT:
      'لم يعد في السيارات المحددة ما يكفي لهذا المبلغ، فقد تغيّرت أرقامها منذ عرضها.',
    FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT: 'المبلغ المأخوذ أكبر من سالب هذا الحادث.',
    OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE:
      'هذه المدة تضم شحنات أكثر مما يمكن عرضه مرة واحدة — يُرجى تضييق التاريخ.',
    OPERATIONS_SHIPMENT_DATE_IN_PAST:
      'لا يمكن تسجيل الشحنة بتاريخ يوم مضى — اختر اليوم أو يومًا بعده.',
    OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL:
      'لا يمكن تقديم تاريخ الشحنة عن اليوم الذي كانت عليه — أبقِه كما هو أو اختر يومًا بعده.',
    OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION:
      'لا يمكن أن يسبق تاريخ التسليم تاريخ الاستلام — اختر اليوم نفسه أو يومًا بعده.',
    OPERATIONS_SHIPMENT_NOT_DELETED: 'هذه الشحنة لم تعد محذوفة — فقد عادت إلى يومها بالفعل.',
    OPERATIONS_SECURED_LOCKED: 'استلمت الخزينة هذه المحصنة، فلم يعد تغييرها ممكنًا.',
    OPERATIONS_SECURED_NOT_PICKED_UP:
      'لا يوجد تأكيد استلام لهذه المحصنة لإلغائه — لم يؤكد أحد استلامها من البنك.',
    OPERATIONS_SECURED_ALREADY_PICKED_UP:
      'استلام هذه المحصنة مؤكَّد بالفعل — من قائدها أو من العمليات.',
    OPERATIONS_SECURED_NOT_IN_VAULT: 'هذه المحصنة ليست بالخزينة، فلم يعد إلغاء استلامها ممكنًا.',
    OPERATIONS_CREW_DAY_MISMATCH:
      'هذا الطاقم ليس مخططًا في يوم تسليم هذه الشحنة — اختر أحد أطقم ذلك اليوم.',
    OPERATIONS_CREW_CAPTAIN_MISMATCH: 'لم يعد هذا القائد ضمن طاقم المركبة المختارة.',
    OPERATIONS_DELIVERY_LEG_REQUIRED: 'إحدى الشحنات بلا طاقم تسليم بعد — عيّن طاقمها قبل صرفها.',
    OPERATIONS_DISTRIBUTION_DAY_IN_PAST:
      'هذا اليوم قد مضى وغادرت سياراته — وزّع على اليوم أو على يوم بعده.',
    OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED:
      'إحدى المحصنات في هذه الشاشة غادرت الخزينة بالفعل، فلم يعد وضعها على سيارة ممكنًا.',
    OPERATIONS_DISTRIBUTION_NOT_ON_DAY:
      'إحدى المحصنات ليست مستحقة التسليم في هذا اليوم، فلا يمكن وضعها على سيارات هذا اليوم.',
    OPERATIONS_DISTRIBUTION_LEG_STARTED:
      'بدأ قائدها هذا التسليم من التطبيق، فلم يعد نقلها أو إزالتها من سيارته ممكنًا.',
    ATM_MAIL_POLL_BUSY: 'تجري الآن قراءة للبريد — ستظهر نتيجتها في «آخر قراءة» بعد لحظات.',
    RATE_LIMITED: 'طلبات كثيرة جدًا — يُرجى التمهّل.',
    FILE_TOO_LARGE: 'هذا الملف كبير جدًا.',
    PAYLOAD_TOO_LARGE: 'حجم البيانات المُرسَلة أكبر من أن تُحفظ دفعة واحدة.',
    FILE_BLOCKED: 'حظر فاحص الفيروسات هذا الملف.',
    FILE_SCAN_PENDING: 'ما زال هذا الملف قيد فحص الفيروسات — حاول مجددًا بعد لحظات.',
    INTERNAL: 'تعذّر على الخادم إتمام هذا الطلب.',
    AUTH_TOKEN_EXPIRED: 'انتهت جلستك — يُرجى تسجيل الدخول مجددًا.',
    AUTH_TOKEN_INVALID: 'لم تعد جلستك صالحة — يُرجى تسجيل الدخول مجددًا.',
    UNAUTHENTICATED: 'انتهت جلستك — يُرجى تسجيل الدخول مجددًا.',
    AUTH_SESSION_REVOKED: 'تم إنهاء هذه الجلسة — يُرجى تسجيل الدخول مجددًا.',
    NETWORK: 'خطأ في الشبكة — تحقق من اتصالك.',
    UNKNOWN: 'حدث خطأ ما. يُرجى المحاولة مجددًا.',
  },
};

/**
 * Is there actually a thrown value here?
 *
 * TanStack Query reports "this query has not failed" as `error: null`, never `undefined`. A
 * presence test written as `error !== undefined` therefore calls every SUCCESSFUL query a
 * failure. That is not hypothetical: it is why eleven Operations screens drew the generic
 * "something went wrong" panel on top of a perfectly good — and in the reported case, empty —
 * result set, while the requests behind them all returned 200.
 *
 * Both absent forms mean the same thing. This is the one place that says so, so that passing a
 * query's `error` straight into a component is correct rather than a trap the caller has to know
 * to work around.
 */
export const hasError = (error: unknown): boolean => error !== undefined && error !== null;

export const errorMessage = (error: unknown, locale: Locale): string => {
  const table = FRIENDLY[locale];
  if (error instanceof ApiError) {
    return table[error.code] ?? (error.message !== '' ? error.message : (table.UNKNOWN ?? 'Error'));
  }
  if (error instanceof TypeError) return table.NETWORK ?? 'Network error';
  if (error instanceof Error && error.message !== '') return error.message;
  return table.UNKNOWN ?? 'Error';
};

/** Field-level validation details, when the server returned a VALIDATION_ERROR envelope. */
export const validationDetails = (error: unknown): { field?: string; message: string }[] =>
  error instanceof ApiError && error.details !== undefined ? error.details : [];

/**
 * The technical identity of a failure: the server's error code and the id it filed the request
 * under (`ApiFailure.requestId`, also on the `X-Request-Id` header).
 *
 * Friendly copy is for the person; this is for whoever has to find out what happened. A failure a
 * user can only describe as "something went wrong" is a failure nobody can look up, and the API
 * has been minting a correlation id for every one of them that the client never read.
 *
 * Returns `null` when the value carries no server identity — a network drop or a client-side
 * throw has nothing to correlate, and an empty reference is worse than none.
 */
export const errorDiagnostic = (error: unknown): { code: string; requestId?: string } | null => {
  if (!(error instanceof ApiError)) return null;
  const { code, requestId } = error;
  return requestId === undefined || requestId === '' ? { code } : { code, requestId };
};
