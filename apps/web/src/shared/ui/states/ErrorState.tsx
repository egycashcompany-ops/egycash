// Inline error panel with a retry action. Derives a friendly, localized message from a thrown
// value when `error` is supplied; otherwise uses the given title/description.
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { errorMessage } from '../../lib/errors';
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
  const message = description ?? (error !== undefined ? errorMessage(error, locale) : undefined);
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <AlertIcon className="h-10 w-10 text-red-400" />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title ?? t('common.error.title')}</p>
      {message !== undefined && (
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>
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
