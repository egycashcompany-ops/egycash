// Standard page frame every screen reuses: a padded, full-width container plus a unified page header
// (breadcrumbs + title + subtitle + actions slot). Refining these two primitives standardizes the
// header and spacing across every page at once — the single source of truth for page layout.
//
// Owner decision: every screen spans the full available width, the way the interviews board always
// did. There is no max-width cap and therefore no per-page opt-out — padding is unchanged.
import { type ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

export const PageContainer = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
);

export const PageHeader = ({
  title,
  description,
  breadcrumbs,
  actions,
  aside,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /**
   * Sits on the breadcrumb row, opposite the trail — for status about the record rather than about
   * navigation. Wraps below on narrow screens rather than squeezing the breadcrumb.
   */
  aside?: ReactNode;
}): JSX.Element => (
  <div className="mb-6 border-b border-slate-200/80 pb-5 dark:border-slate-800">
    {(breadcrumbs !== undefined && breadcrumbs.length > 0) || aside !== undefined ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {breadcrumbs !== undefined && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : <span />}
        {aside !== undefined && <div className="min-w-0">{aside}</div>}
      </div>
    ) : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  </div>
);
