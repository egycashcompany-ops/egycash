// Standard page frame every screen reuses: a max-width, padded container plus a unified page header
// (breadcrumbs + title + subtitle + actions slot). Refining these two primitives standardizes the
// header and spacing across every page at once — the single source of truth for page layout.
import { type ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

export const PageContainer = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
);

export const PageHeader = ({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
}): JSX.Element => (
  <div className="mb-6 border-b border-slate-200/80 pb-5 dark:border-slate-800">
    {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
      <div className="mb-3">
        <Breadcrumbs items={breadcrumbs} />
      </div>
    )}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  </div>
);
