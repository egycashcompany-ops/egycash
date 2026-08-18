// What went wrong when an execution act was refused — in the captain's words, not the API's.
//
// The generic "something went wrong" is the wrong answer to every one of these. Each has a
// different cause and a different thing for the captain to DO about it, and the server already
// distinguishes them with its own codes (`ErrorCodes.OPERATIONS_*`, contracts/errors). This maps
// them; it does not invent a second classification.
import { type Locale } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';

/**
 * The state moved underneath this screen.
 *
 * A 409 is the server's compare-and-swap losing a race — another device, or the back office,
 * changed this stop between the read and the act. A 422 `ALREADY_SETTLED` is the same story with
 * the race already finished. Both mean "your copy is stale", which is not an error the captain
 * made and must not be reported as one: the fix is a refetch, which the caller performs either way.
 */
export const isStateConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.status === 409 ||
    error.code === 'OPERATIONS_EXECUTION_CONFLICT' ||
    error.code === 'OPERATIONS_EXECUTION_ALREADY_SETTLED');

const BY_CODE: Record<string, string> = {
  OPERATIONS_EXECUTION_CONFLICT: 'operations.mobile.error.conflict',
  OPERATIONS_EXECUTION_ALREADY_SETTLED: 'operations.mobile.error.settled',
  OPERATIONS_INVALID_EXECUTION_TRANSITION: 'operations.mobile.error.transition',
  OPERATIONS_EXECUTION_OUT_OF_SEQUENCE: 'operations.mobile.error.sequence',
};

const BY_STATUS: Record<number, string> = {
  // Not this captain's stop, or no longer a captain on this day. The route can be reassigned
  // mid-shift; a captain who has been taken off it must be told that, not shown "forbidden".
  403: 'operations.mobile.error.notYours',
  404: 'operations.mobile.error.missing',
};

/**
 * The message key for a refused act, or null when this is not one of ours — an ordinary network
 * failure or an expired session belongs to the app-wide handler, which already says the right
 * thing about both.
 */
export const executionErrorKey = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  return BY_CODE[error.code] ?? BY_STATUS[error.status] ?? null;
};

/**
 * The full message. Falls back to the shared `errorMessage`, which handles auth, network and the
 * platform codes — so nothing here has to restate what the app already says well.
 */
export const executionErrorMessage = (error: unknown, locale: Locale): string => {
  const key = executionErrorKey(error);
  if (key === null) return errorMessage(error, locale);
  return EXECUTION_COPY[locale][key] ?? errorMessage(error, locale);
};

/**
 * Kept beside the mapping rather than in the global table on purpose: these are the only strings
 * in the system that describe a captain's refused act, and they are read on a phone by somebody
 * who needs to know what to do next, not what the server called it.
 */
const EXECUTION_COPY: Record<Locale, Record<string, string>> = {
  ar: {
    'operations.mobile.error.conflict': 'تغيّرت حالة المهمة، جارٍ تحديث البيانات…',
    'operations.mobile.error.settled': 'تم إنهاء هذه المهمة بالفعل، جارٍ تحديث البيانات…',
    'operations.mobile.error.transition': 'لا يمكن تنفيذ هذه الخطوة الآن — راجع الحالة المحدَّثة.',
    'operations.mobile.error.sequence': 'يجب إتمام المحطة السابقة أولًا.',
    'operations.mobile.error.notYours': 'لم تعد هذه المهمة ضمن مسارك اليوم.',
    'operations.mobile.error.missing': 'لم يعد لهذه المحطة وجود في مسار اليوم.',
  },
  en: {
    'operations.mobile.error.conflict': 'This task changed — refreshing…',
    'operations.mobile.error.settled': 'This task is already finished — refreshing…',
    'operations.mobile.error.transition': 'That step is not available now — check the updated state.',
    'operations.mobile.error.sequence': 'The previous stop has to be finished first.',
    'operations.mobile.error.notYours': 'This task is no longer on your route today.',
    'operations.mobile.error.missing': 'This stop is no longer on today’s route.',
  },
};
