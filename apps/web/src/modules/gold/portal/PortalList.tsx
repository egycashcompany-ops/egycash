// One paginated table, shared by the six list tabs.
//
// The portal's lists are the same shape as gold's were: a page of rows, no filters, no actions —
// a customer is reading a statement, not working a queue. Factoring it here keeps each tab down to
// its columns, which is the only thing that actually differs between them.
import { type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Paginated } from '@ecms/contracts';
import { type UseQueryResult } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';

export const PORTAL_PAGE_SIZE = 15;

/** The page number, read from and written to the address bar so a reload keeps your place. */
export const usePortalPage = (): [number, (next: number) => void] => {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  return [
    page,
    (next: number): void => {
      const params = new URLSearchParams(sp);
      if (next <= 1) params.delete('page');
      else params.set('page', String(next));
      setSp(params);
    },
  ];
};

export const PortalSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}): JSX.Element => (
  <section className="space-y-4">
    <header>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      {description !== undefined && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </header>
    {children}
  </section>
);

export const PortalList = <T,>({
  title,
  description,
  query,
  columns,
  rowKey,
  emptyText,
  onPage,
}: {
  title: string;
  description?: string;
  query: UseQueryResult<Paginated<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyText: string;
  onPage: (next: number) => void;
}): JSX.Element => {
  const t = useT();
  const meta = query.data?.meta;
  return (
    <PortalSection title={title} {...(description === undefined ? {} : { description })}>
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={rowKey}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        onRetry={() => {
          void query.refetch();
        }}
        empty={<p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>}
      />
      {meta !== undefined && meta.totalPages > 1 && (
        <Pagination meta={meta} onPageChange={onPage} />
      )}
      {meta !== undefined && meta.totalItems > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('gold.portal.rowCount', { count: meta.totalItems })}
        </p>
      )}
    </PortalSection>
  );
};
