// A KPI / stat tile for module home pages. With a `value` it shows a metric; without one it renders
// an honest placeholder (a muted dash + caption) so a dashboard's shape is visible before any metric
// is wired — it never fabricates numbers.
import { type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Card, CardBody } from './Card';
import { Skeleton } from './Skeleton';

/**
 * The icon tile's colour. `neutral` is every home page's tile; the others are for a row of tiles
 * that are the PARTS of one whole — the IT dashboard's in stock / handed over / under maintenance —
 * where each wears the colour its part wears on the bars below it.
 */
export type StatCardTone = 'neutral' | 'brand' | 'success' | 'warning';

const ICON_TONE: Record<StatCardTone, string> = {
  neutral: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};

export const StatCard = ({
  label,
  icon: Icon,
  value,
  caption,
  onClick,
  to,
  tone = 'neutral',
  active = false,
  loading = false,
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
  /**
   * Makes the tile a LINK — for a metric that is a count of another screen's list, which opens it
   * («إجمالي الأصول» → the asset register under the same filters). A link rather than a button
   * with `navigate()`, so it opens in a new tab and says where it goes.
   */
  to?: string;
  tone?: StatCardTone;
  /** Draw it as the view currently applied. */
  active?: boolean;
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
        (onClick !== undefined || to !== undefined) &&
          'transition-colors hover:border-brand-300 dark:hover:border-brand-700',
        active && 'border-brand-400 ring-1 ring-brand-400/40 dark:border-brand-600',
      )}
    >
      <CardBody className="flex items-center gap-4">
        <span
          className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-lg', ICON_TONE[tone])}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
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
          {caption !== undefined && (
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{caption}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );

  if (to !== undefined) {
    return (
      <Link
        to={to}
        className="block h-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
      >
        {tile}
      </Link>
    );
  }

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
