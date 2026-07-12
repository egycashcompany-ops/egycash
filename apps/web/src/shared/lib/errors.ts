// Turn a thrown value into a user-facing message. Server error messages are already
// human-readable; we override the common codes with friendlier bilingual copy and fall back
// to the server message, then to a generic string. Kept React-free so the global Query/Mutation
// error handler (outside the component tree) can use it via the store's current locale.
import { type Locale } from '@ecms/contracts';
import { ApiError } from './api-client';

const FRIENDLY: Record<Locale, Record<string, string>> = {
  en: {
    VALIDATION_ERROR: 'Some fields need your attention.',
    FORBIDDEN: 'You do not have permission to do that.',
    NOT_FOUND: 'That item could not be found.',
    CONFLICT: 'That action conflicts with the current state.',
    STALE_DOCUMENT: 'This record changed since you loaded it — please refresh and try again.',
    BUSINESS_RULE: 'That action is not allowed right now.',
    RATE_LIMITED: 'Too many requests — please slow down.',
    FILE_TOO_LARGE: 'That file is too large.',
    AUTH_TOKEN_EXPIRED: 'Your session expired — please sign in again.',
    AUTH_TOKEN_INVALID: 'Your session is no longer valid — please sign in again.',
    NETWORK: 'Network error — please check your connection.',
    UNKNOWN: 'Something went wrong. Please try again.',
  },
  ar: {
    VALIDATION_ERROR: 'بعض الحقول تحتاج إلى مراجعة.',
    FORBIDDEN: 'ليس لديك صلاحية للقيام بذلك.',
    NOT_FOUND: 'تعذّر العثور على هذا العنصر.',
    CONFLICT: 'هذا الإجراء يتعارض مع الحالة الحالية.',
    STALE_DOCUMENT: 'تم تعديل هذا السجل بعد تحميله — يُرجى التحديث والمحاولة مجددًا.',
    BUSINESS_RULE: 'هذا الإجراء غير مسموح حاليًا.',
    RATE_LIMITED: 'طلبات كثيرة جدًا — يُرجى التمهّل.',
    FILE_TOO_LARGE: 'هذا الملف كبير جدًا.',
    AUTH_TOKEN_EXPIRED: 'انتهت جلستك — يُرجى تسجيل الدخول مجددًا.',
    AUTH_TOKEN_INVALID: 'لم تعد جلستك صالحة — يُرجى تسجيل الدخول مجددًا.',
    NETWORK: 'خطأ في الشبكة — تحقق من اتصالك.',
    UNKNOWN: 'حدث خطأ ما. يُرجى المحاولة مجددًا.',
  },
};

export const errorMessage = (error: unknown, locale: Locale): string => {
  const table = FRIENDLY[locale];
  if (error instanceof ApiError) {
    return table[error.code] ?? (error.message !== '' ? error.message : table.UNKNOWN ?? 'Error');
  }
  if (error instanceof TypeError) return table.NETWORK ?? 'Network error';
  if (error instanceof Error && error.message !== '') return error.message;
  return table.UNKNOWN ?? 'Error';
};

/** Field-level validation details, when the server returned a VALIDATION_ERROR envelope. */
export const validationDetails = (error: unknown): { field?: string; message: string }[] =>
  error instanceof ApiError && error.details !== undefined ? error.details : [];
