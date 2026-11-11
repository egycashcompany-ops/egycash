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
    // «اعملى ايقون اقدر اجيب منه اللى اتمسح»: a restore of a shipment someone else already brought
    // back. Nothing is lost — it is on its day again — and the deleted list refreshes behind it.
    OPERATIONS_SHIPMENT_NOT_DELETED:
      'This shipment is no longer deleted — it is already back on its day.',
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
    OPERATIONS_SHIPMENT_NOT_DELETED: 'هذه الشحنة لم تعد محذوفة — فقد عادت إلى يومها بالفعل.',
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
