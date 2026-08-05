// A KPI / stat tile for module home pages. With a `value` it shows a metric; without one it renders
// an honest placeholder (a muted dash + caption) so a dashboard's shape is visible before any metric
// is wired — it never fabricates numbers.
import { type ComponentType, type SVGProps } from 'react';
import { cn } from '../lib/cn';
import { Card, CardBody } from './Card';
import { Skeleton } from './Skeleton';

export const StatCard = ({
  label,
  icon: Icon,
  value,
  caption,
  onClick,
  active = false,
  loading = false,
  dense = false,
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
  /**
   * A tighter tile for a screen that shows several above a table: the number leads, the icon steps
   * back to a supporting mark, and the label reads as its caption. The default stays as it is for
   * the module home pages already built on it.
   */
  dense?: boolean;
  /**
   * While the metric is in flight, hold its space with a skeleton instead of a dash. Both avoid a
   * layout shift — the tile is the same height either way — but a skeleton says "coming" where a
   * dash says "nothing", and a number that arrives a moment later contradicts the dash.
   */
  loading?: boolean;
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
      <CardBody
        padded={!dense}
        className={cn('flex items-center', dense ? 'gap-3 px-3.5 py-2.5' : 'gap-4')}
      >
        <span
          className={cn(
            'grid shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
            dense ? 'h-8 w-8' : 'h-11 w-11',
          )}
        >
          <Icon className={dense ? 'h-4 w-4' : 'h-6 w-6'} />
        </span>
        <div className="min-w-0">
          {/* Dense puts the NUMBER first: several tiles read as a row of metrics, and the eye should
              land on the figures, not on four labels it has to read past. */}
          {dense ? (
            <>
              {loading ? (
                <Skeleton className="h-6 w-12" />
              ) : (
                <p
                  className={cn(
                    'text-xl font-semibold leading-tight tabular-nums',
                    isPlaceholder ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-white',
                  )}
                >
                  {value ?? '—'}
                </p>
              )}
              <p className="truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                {label}
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{label}</p>
              {loading ? (
                <Skeleton className="mt-1.5 h-7 w-16" />
              ) : (
                <p
                  className={cn(
                    'mt-0.5 text-2xl font-semibold tabular-nums',
                    isPlaceholder ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-white',
                  )}
                >
                  {value ?? '—'}
                </p>
              )}
            </>
          )}
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
      // A press that is felt: the tile dips a hair on pointer-down, which is what makes a card
      // read as a control rather than as a panel that happens to react.
      className="block w-full rounded-lg text-start transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 active:scale-[0.99]"
    >
      {tile}
    </button>
  );
};
