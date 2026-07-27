// The toolbar that appears when a table has a selection (RW17). One component for every table, so
// bulk actions look and behave identically wherever they are offered.
import { type ReactNode } from 'react';
import { useT } from '../../platform/localization/useT';
import { Button } from './Button';
import { cn } from '../lib/cn';

export const BulkActionBar = ({
  count,
  onClear,
  children,
  className,
}: {
  count: number;
  onClear: () => void;
  /** The actions themselves — permission-gated by the caller. */
  children: ReactNode;
  className?: string;
}): JSX.Element | null => {
  const t = useT();
  if (count === 0) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2',
        'dark:border-brand-900/60 dark:bg-brand-950/40',
        className,
      )}
      role="toolbar"
      aria-label={t('bulk.selected').replace('{n}', String(count))}
    >
      <span className="text-sm font-medium text-brand-800 dark:text-brand-200">
        {t('bulk.selected').replace('{n}', String(count))}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" size="sm" className="ms-auto" onClick={onClear}>
        {t('bulk.clear')}
      </Button>
    </div>
  );
};
