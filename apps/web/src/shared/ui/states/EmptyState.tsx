// Empty result placeholder. Pass a title/description or fall back to generic copy, plus an
// optional action (e.g. a "create" button gated by permission at the call site).
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { InboxIcon } from '../icons';

export const EmptyState = ({
  title,
  description,
  icon,
  action,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <div className="text-slate-300 dark:text-slate-600">{icon ?? <InboxIcon className="h-10 w-10" />}</div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title ?? t('common.empty.title')}</p>
      {description !== undefined && (
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
};
