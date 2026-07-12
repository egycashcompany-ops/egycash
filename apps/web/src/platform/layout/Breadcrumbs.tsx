// Breadcrumb trail, RTL-safe (the chevron separator flips under RTL). Pages pass already
// localized labels; the last crumb is the current page and is not a link.
import { Link } from 'react-router-dom';
import { ChevronEndIcon } from '../../shared/ui/icons';

export interface Crumb {
  label: string;
  to?: string;
}

export const Breadcrumbs = ({ items }: { items: Crumb[] }): JSX.Element | null => {
  if (items.length === 0) return null;
  return (
    <nav aria-label="breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
              {crumb.to !== undefined && !last ? (
                <Link to={crumb.to} className="hover:text-slate-700 dark:hover:text-slate-200">
                  {crumb.label}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-slate-700 dark:text-slate-200' : undefined} aria-current={last ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
              {!last && <ChevronEndIcon className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
