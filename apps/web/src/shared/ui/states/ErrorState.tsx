// Inline error panel with a retry action. Derives a friendly, localized message from a thrown
// value when `error` is supplied; otherwise uses the given title/description.
//
// `error` accepts a TanStack Query `error` verbatim. Its "no failure" value is `null`, not
// `undefined`, so presence is decided by `hasError` — a `!== undefined` test here reported every
// successful query as a failed one and printed the generic UNKNOWN copy, since `null` matches none
// of `errorMessage`'s branches.
//
// The server's error CODE is never printed, in either language. It is an English word
// («INTERNAL», «BUSINESS_RULE» …) and the owner asked, 2026-11-22 («صلحها»), that an Arabic reader
// never meet one; the friendly message above was already chosen BY it, and the API log line the
// reference finds holds it. What stays is the request's reference, when the server gave one.
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { errorDiagnostic, errorMessage, hasError } from '../../lib/errors';
import { AlertIcon } from '../icons';

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
  const message = description ?? (hasError(error) ? errorMessage(error, locale) : undefined);
  // What the message deliberately does not say: the server's id for this exact request. Shown
  // quietly and only when the server gave one, so a screenshot is enough to find the request in
  // the API log. The id itself stays as the log holds it — Latin letters, left to right, isolated
  // in a `bdi` so it never reorders the label beside it. Its `font-mono` is the hook the Fleet
  // boards' dark table restyles (`ERROR_ID_AS_FIGURES`).
  const requestId = hasError(error) ? errorDiagnostic(error)?.requestId : undefined;
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
        <p className="text-xs text-slate-400 dark:text-slate-500" data-error-reference="true">
          {t('common.error.reference')}:{' '}
          <bdi dir="ltr" className="font-mono">
            {requestId}
          </bdi>
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
