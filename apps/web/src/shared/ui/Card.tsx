// Surface container for detail panels and grouped content, with an optional titled header and
// footer.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

export const Card = ({ className, children }: { className?: string; children: ReactNode }): JSX.Element => (
  <div
    className={cn(
      'rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900',
      className,
    )}
  >
    {children}
  </div>
);

export const CardHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
    <div className="min-w-0">
      <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {description !== undefined && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </div>
    {actions !== undefined && <div className="shrink-0">{actions}</div>}
  </div>
);

export const CardBody = ({
  className,
  padded = true,
  children,
}: {
  className?: string;
  /**
   * Turn off the default gutter to set your own. Needed, not cosmetic: `cn` joins classes without
   * resolving Tailwind conflicts, so a `py-2.5` passed in `className` sits beside `py-4` and the
   * winner is decided by stylesheet order — which a call site cannot see. This makes the intent
   * explicit instead of hoping.
   */
  padded?: boolean;
  children: ReactNode;
}): JSX.Element => <div className={cn(padded && 'px-5 py-4', className)}>{children}</div>;
