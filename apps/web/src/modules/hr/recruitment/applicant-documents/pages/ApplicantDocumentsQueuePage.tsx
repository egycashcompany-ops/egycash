// The reviewer's worklist: candidates whose handed-in documents are waiting on a decision.
//
// TWO TABS, AND THE DEFAULT IS THE ONE WITH WORK IN IT. «Waiting» is what somebody opens this
// screen to do; «all» is for looking a specific person up afterwards. Defaulting to the full list
// would make the common case start with a filter.
//
// Each candidate expands in place rather than opening a detail route. A reviewer's unit of work is
// one PERSON's four or five documents — accept, accept, refuse this one with a reason — and pushing
// a route between each of those makes a two-minute job into navigation.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { EmptyState, LoadingState, Pagination, SearchInput } from '../../../../../shared/ui';
import { ApplicantDocumentReview } from '../components/ApplicantDocumentReview';
import { useApplicantDocumentSets } from '../api/applicant-document-queries';
import { useRememberedFilters } from '../../../../../shared/lib/useRememberedFilters';

/**
 * Remembered across visits, PER TAB: the waiting queue and the full list are different views
 * that share a URL, so each keeps its own search. `tab` says which one to open and is never
 * itself remembered; `page` is derived and never kept.
 */
const REMEMBERED_FILTERS = ['q'] as const;

const TABS = ['waiting', 'all'] as const;
type Tab = (typeof TABS)[number];

const PAGE_SIZE = 20;

export const ApplicantDocumentsQueuePage = (): JSX.Element => {
  const t = useT();
  // The search lives in the URL so the screen is shareable and survives a reload — and so the
  // remembered-filters hook has something to remember. Written with `replace`, because narrowing a
  // queue is a view of this screen rather than a place to go Back to.
  const [sp, setSp] = useSearchParams();
  const tabParam = sp.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'waiting';
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS, '', tab);
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next, { replace: true });
  };

  const setTab = (value: Tab): void => patch({ tab: value === 'waiting' ? null : value });
  const search = sp.get('q') ?? '';
  const setSearch = (value: string): void => patch({ q: value });
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);
  const [open, setOpen] = useState<string | null>(null);

  const query = useApplicantDocumentSets({
    page,
    pageSize: PAGE_SIZE,
    ...(tab === 'waiting' ? { pendingOnly: true } : {}),
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  });

  const switchTab = (next: Tab): void => {
    setTab(next);
    setPage(1);
    setOpen(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('hr.applicantDocuments.title')}
        description={t('hr.applicantDocuments.description')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('hr.applicantDocuments.title') },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === name
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
              onClick={() => {
                switchTab(name);
              }}
            >
              {t(`hr.applicantDocuments.tab.${name}`)}
            </button>
          ))}
        </div>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder={t('hr.applicantDocuments.searchPlaceholder')}
        />
      </div>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError || query.data === undefined ? (
        <EmptyState title={t('hr.applicantDocuments.loadFailed')} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title={
            tab === 'waiting'
              ? t('hr.applicantDocuments.emptyWaiting')
              : t('hr.applicantDocuments.emptyAll')
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {query.data.items.map((set) => {
              const expanded = open === set.applicantId;
              return (
                <li
                  key={set.id}
                  className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-start"
                    onClick={() => {
                      setOpen(expanded ? null : set.applicantId);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {set.applicantName}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {set.applicantCode}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {set.pendingReview > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          {t('hr.applicantDocuments.pendingCount', {
                            n: String(set.pendingReview),
                          })}
                        </span>
                      )}
                      {set.complete && set.pendingReview === 0 && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          {t('hr.applicantDocuments.settled')}
                        </span>
                      )}
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-slate-200 px-4 pb-4 pt-2 dark:border-slate-800">
                      <ApplicantDocumentReview set={set} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}
    </PageContainer>
  );
};
