// Inline error panel with a retry action. Derives a friendly, localized message from a thrown
// value when `error` is supplied; otherwise uses the given title/description.
//
// `error` accepts a TanStack Query `error` verbatim. Its "no failure" value is `null`, not
// `undefined`, so presence is decided by `hasError` — a `!== undefined` test here reported every
// successful query as a failed one and printed the generic UNKNOWN copy, since `null` matches none
// of `errorMessage`'s branches.
//
// NO ENGLISH ON AN ARABIC PANEL. The owner asked, 2026-11-22, about «رسالة الغلط اللي بتطلع فيها
// كلمة إنجليزي» and answered «صلحها». So:
// - The server's error CODE is never printed, in either language. It is an English word
//   («INTERNAL», «BUSINESS_RULE» …); the friendly message was already chosen BY it, and the API log
//   line the reference finds holds it.
// - In Arabic, a message with no Arabic letter in it — the server's own English sentence for a
//   code the friendly table does not word yet, or a client-side `Error` — is not shown; the
//   general Arabic line is (`UNKNOWN`). Only this panel: the toasts read `errorMessage` as before.
// - The request's reference, when the server gave one, stays — for support — but in Arabic only
//   its name is drawn, «الرقم المرجعي», with the shared copy button (`CopyIdButton`, «نسخ الرقم
//   المرجعي»): the id is on the clipboard on a click, in the button's tooltip on hover, and on the
//   line as `data-request-id`, never in the text. English still prints the id beside its name.
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { errorDiagnostic, errorMessage, hasError } from '../../lib/errors';
import { CopyIdButton } from '../CopyIdButton';
import { AlertIcon } from '../icons';

/** Any Arabic letter — what an Arabic reader can read at all. */
const ARABIC_LETTER = /\p{Script=Arabic}/u;

/**
 * The message this panel shows for a thrown value: the friendly one, except that an Arabic reader
 * never gets a sentence with no Arabic in it — the general Arabic line takes its place.
 */
const panelMessage = (error: unknown, locale: Locale): string => {
  const message = errorMessage(error, locale);
  return locale === 'ar' && !ARABIC_LETTER.test(message) ? errorMessage(undefined, 'ar') : message;
};

export const ErrorState = ({
  error,
  title,
  description,
  onRetry,
}: {
  error?: unknown;
  title?: string;
  description?: string;
  onRetry?: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const message = description ?? (hasError(error) ? panelMessage(error, locale) : undefined);
  // What the message deliberately does not say: the server's id for this exact request. Shown
  // quietly and only when the server gave one, so support can find the request in the API log.
  // English prints the id as the log holds it — Latin letters, left to right, isolated in a `bdi`
  // so it never reorders the label, kept on one line. Its `font-mono` is the hook the Fleet boards'
  // dark table sets in their figures' face (`ERROR_ID_AS_FIGURES`, which sizes the whole line).
  const requestId = hasError(error) ? errorDiagnostic(error)?.requestId : undefined;
  const reference = t('common.error.reference');
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <AlertIcon className="h-10 w-10 text-red-400" />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {title ?? t('common.error.title')}
      </p>
      {message !== undefined && (
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>
      )}
      {requestId !== undefined && (
        <p
          className="flex flex-wrap items-center justify-center gap-x-1 text-xs text-slate-400 dark:text-slate-500"
          data-error-reference="true"
          data-request-id={requestId}
        >
          {locale === 'ar' ? (
            <span>{reference}</span>
          ) : (
            <>
              <span>{reference}:</span>
              <bdi dir="ltr" className="whitespace-nowrap font-mono">
                {requestId}
              </bdi>
            </>
          )}
          <CopyIdButton code={requestId} />
        </p>
      )}
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  );
};
