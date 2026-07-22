// A KPI / stat tile for module home pages. With a `value` it shows a metric; without one it renders
// an honest placeholder (a muted dash + caption) so a dashboard's shape is visible before any metric
// is wired — it never fabricates numbers.
import { type ComponentType, type SVGProps } from 'react';
import { cn } from '../lib/cn';
import { Card, CardBody } from './Card';

export const StatCard = ({
  label,
  icon: Icon,
  value,
  caption,
}: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Omit to render the placeholder dash. */
  value?: string;
  /** Muted helper line (e.g. "Not available yet" for a placeholder). */
  caption?: string;
}): JSX.Element => {
  const isPlaceholder = value === undefined;
  return (
    <Card className="h-full">
      <CardBody className="flex items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{label}</p>
          <p
            className={cn(
              'mt-0.5 text-2xl font-semibold tabular-nums',
              isPlaceholder ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-white',
            )}
          >
            {value ?? '—'}
          </p>
          {caption !== undefined && (
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{caption}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
};
