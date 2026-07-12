// Standard page frame every screen reuses: a max-width, padded container plus an optional
// header (breadcrumbs + title + description + actions slot). Keeps every recruitment screen
// visually consistent.
import { type ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

export const PageContainer = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
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
  <div className="mb-6">
    {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
      <div className="mb-3">
        <Breadcrumbs items={breadcrumbs} />
      </div>
    )}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  </div>
);
