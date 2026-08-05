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
  onClick,
  active = false,
}: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Omit to render the placeholder dash. */
  value?: string;
  /** Muted helper line (e.g. "Not available yet" for a placeholder). */
  caption?: string;
  /**
   * Makes the tile a button — for a metric that is also a view of the list below it ("active
   * sources" → filter to active). Without it the tile stays a plain readout, which is what most
   * dashboards want: a number that is not a filter should not look pressable.
   */
  onClick?: () => void;
  /** Draw it as the view currently applied. */
  active?: boolean;
}): JSX.Element => {
  const isPlaceholder = value === undefined;
  const tile = (
    <Card
      className={cn(
        'h-full',
        onClick !== undefined && 'transition-colors hover:border-brand-300 dark:hover:border-brand-700',
        active && 'border-brand-400 ring-1 ring-brand-400/40 dark:border-brand-600',
      )}
    >
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

  // A real <button> rather than a div with a click handler: keyboard focus, Enter/Space and the
  // pressed announcement all come free, and the shared Card keeps its own simple contract.
  return onClick === undefined ? (
    tile
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="block w-full rounded-lg text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
    >
      {tile}
    </button>
  );
};
