// The rounds: what has been planned, what is running, what is finished (P-HR-PRF D1, D2, D3, D8).
//
// OPENING IS THE ONE BUTTON THAT MATTERS, and it is deliberately not quiet. It writes a row for
// every employee in scope, so it confirms first and then shows the RECEIPT — matched, created,
// unassigned. A round that opened and said nothing would leave «did that work?» to be answered by
// navigating to another screen and counting.
//
// NO PROGRESS BAR, NO COMPLETION PERCENTAGE, AND NO AVERAGE. The list shows how many rows a round
// carries, and that is a count of people rather than a measure of anybody. A «73% complete» here
// would be the first number this module invented, which is the one thing §2 of the design is about.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type PerformanceCycleDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { SearchInput } from '../../../../shared/ui';
import { StatusBadge, type Tone } from '../../../../shared/ui/Badge';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import {
  useClosePerformanceCycle,
  useOpenPerformanceCycle,
  usePerformanceCycles,
} from '../api/performance-queries';

const DEFAULT_PAGE_SIZE = 25;

const STATUS_TONE: Record<PerformanceCycleDto['status'], Tone> = {
  draft: 'neutral',
  open: 'info',
  closed: 'success',
};

/**
 * Opening, with what it is about to do said out loud first.
 *
 * The confirmation names the SCOPE rather than only asking «are you sure», because the mistake this
 * guards is not a stray click — it is a cycle whose scope says «everyone» when somebody meant one
 * branch, and the only moment that is still cheap to notice is before the rows exist.
 */
const OpenDialog = ({
  cycle,
  onClose,
}: {
  cycle: PerformanceCycleDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const open = useOpenPerformanceCycle();

  const submit = async (): Promise<void> => {
    try {
      const { result } = await open.mutateAsync({
        id: cycle.id,
        body: { version: cycle.version },
      });
      toast.success(
        `${t('performance.cycle.opened')} · ${String(result.created)}/${String(result.matched)}` +
          (result.unassigned > 0
            ? ` · ${t('performance.cycle.unassigned')}: ${String(result.unassigned)}`
            : ''),
      );
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('performance.cycle.open')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={open.isPending} onClick={() => void submit()}>
            {t('performance.cycle.open')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('performance.cycle.openWarning')}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
        {cycle.scope.kind === 'everyone'
          ? t('performance.cycle.scopeEveryone')
          : t('performance.cycle.scopeFiltered')}
      </p>
    </Dialog>
  );
};

/** Closing, refused by the server while any review is still open — the message names how many. */
const CloseDialog = ({
  cycle,
  onClose,
}: {
  cycle: PerformanceCycleDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const close = useClosePerformanceCycle();

  const submit = async (): Promise<void> => {
    try {
      await close.mutateAsync({ id: cycle.id, body: { version: cycle.version } });
      toast.success(t('performance.cycle.closed'));
      onClose();
    } catch {
      // surfaced globally — including «17 reviews are still open», which is the useful case
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('performance.cycle.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={close.isPending} onClick={() => void submit()}>
            {t('performance.cycle.close')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('performance.cycle.closeWarning')}
      </p>
    </Dialog>
  );
};

export const PerformanceCyclesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const [opening, setOpening] = useState<PerformanceCycleDto | null>(null);
  const [closing, setClosing] = useState<PerformanceCycleDto | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const params = { page, pageSize: DEFAULT_PAGE_SIZE, ...(search === '' ? {} : { search }) };
  const { data, isLoading, isError, error, refetch } = usePerformanceCycles(params);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<PerformanceCycleDto>[] = [
    {
      key: 'name',
      header: t('performance.cycle.name'),
      render: (c) => (
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {locale === 'ar' ? c.name.ar : c.name.en}
        </span>
      ),
    },
    {
      key: 'period',
      header: t('performance.cycle.period'),
      render: (c) => (
        <span dir="ltr">
          {`${formatDate(c.periodStart, locale)} — ${formatDate(c.periodEnd, locale)}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (c) => (
        <StatusBadge
          tone={STATUS_TONE[c.status]}
          label={t(`performance.cycle.status.${c.status}`)}
        />
      ),
    },
    {
      key: 'scope',
      header: t('performance.cycle.scope'),
      render: (c) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {c.scope.kind === 'everyone'
            ? t('performance.cycle.scopeEveryone')
            : t('performance.cycle.scopeFiltered')}
        </span>
      ),
    },
    {
      // A COUNT OF PEOPLE, not a measure of them. Zero until the round is opened, which is what
      // makes «open» visibly the act that creates the work rather than a status somebody sets.
      key: 'reviewCount',
      header: t('performance.cycle.reviewCount'),
      render: (c) => <span dir="ltr">{c.reviewCount}</span>,
    },
    {
      // The scale the round is rated on (D8), shown because a list of rounds on different scales is
      // exactly the thing §8 Q5 warns about — and a column is how somebody notices.
      key: 'scale',
      header: t('performance.cycle.scale'),
      render: (c) => <span dir="ltr">{`${c.scale.min}–${c.scale.max}`}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <Can permission="performanceCycle.conduct">
          {c.status === 'draft' && (
            <Button size="sm" onClick={() => setOpening(c)}>
              {t('performance.cycle.open')}
            </Button>
          )}
          {c.status === 'open' && (
            <Button size="sm" variant="secondary" onClick={() => setClosing(c)}>
              {t('performance.cycle.close')}
            </Button>
          )}
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('performance.cycle.title')}
        description={t('performance.cycle.subtitle')}
        breadcrumbs={[{ label: t('performance.title') }, { label: t('performance.cycle.title') }]}
      />

      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
          placeholder={t('performance.cycle.searchPlaceholder')}
        />
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {opening !== null && <OpenDialog cycle={opening} onClose={() => setOpening(null)} />}
      {closing !== null && <CloseDialog cycle={closing} onClose={() => setClosing(null)} />}
    </PageContainer>
  );
};
