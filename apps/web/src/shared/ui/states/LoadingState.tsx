// Centered loading indicator for a panel/page region.
import { useT } from '../../../platform/localization/useT';
import { Spinner } from '../Spinner';

export const LoadingState = ({ label }: { label?: string }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500 dark:text-slate-400">
      <Spinner className="h-6 w-6 text-brand-600" />
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  );
};
