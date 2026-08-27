// «من نُرشّحه للتدريب» — the queue somebody works, and the decision it exists for.
//
// TWO KEYS, AND THE SCREEN SHOWS BOTH SIDES OF THEM. `trainingNomination.create` nominates;
// `.decide` answers. A person holding only the first sees the queue and their own requests and no
// decision buttons; a person holding the second sees the buttons. That is the two-person rule (D3)
// as the screen renders it — and the server enforces one more thing this cannot: the NOMINATOR may
// not decide their own nomination, whatever keys they hold.
//
// THE DEFAULT VIEW IS WHAT IS WAITING. A queue that opened on everything ever decided would make
// somebody filter before they could work, and the thing they came here to do is the pending list.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type TrainingNominationDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { SearchInput } from '../../../../shared/ui';
import { Field, Select, Textarea } from '../../../../shared/ui/form';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { NominationStatusBadge } from '../components/NominationStatusBadge';
import { NominateDialog } from '../components/NominateDialog';
import { useDecideTrainingNomination, useTrainingNominations } from '../api/training-queries';

const DEFAULT_PAGE_SIZE = 25;

/** Refusing asks why; approving needs no words — the server refuses a reasonless refusal too. */
const DecideDialog = ({
  nomination,
  decision,
  onClose,
}: {
  nomination: TrainingNominationDto;
  decision: 'approved' | 'rejected';
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const decide = useDecideTrainingNomination();
  const [note, setNote] = useState('');
  const refusing = decision === 'rejected';

  const submit = async (): Promise<void> => {
    try {
      await decide.mutateAsync({
        id: nomination.id,
        body: {
          decision,
          ...(refusing ? { note: note.trim() } : {}),
          version: nomination.version,
        },
      });
      toast.success(t(`training.nomination.done.${decision}`));
      onClose();
    } catch {
      // surfaced globally — including «this session is full» and the two-person rule
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`training.nomination.action.${decision}`)}
      description={t(`training.nomination.confirm.${decision}`)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={refusing ? 'danger' : 'primary'}
            loading={decide.isPending}
            disabled={refusing && note.trim() === ''}
            onClick={() => void submit()}
          >
            {t(`training.nomination.action.${decision}`)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${nomination.employeeName} · ${nomination.sessionCode}`}
      </p>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{nomination.reason}</p>
      {refusing && (
        <Field label={t('training.nomination.rejectReason')} required>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </Dialog>
  );
};

export const TrainingNominationsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const [nominating, setNominating] = useState(false);
  const [deciding, setDeciding] = useState<{
    nomination: TrainingNominationDto;
    decision: 'approved' | 'rejected';
  } | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  // Absent means the queue. `all` is the explicit opt-out, so a bookmark of the queue stays the
  // queue rather than becoming «everything» the day somebody changes the default.
  const view = sp.get('view') ?? 'pending';
  const params = {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    ...(search === '' ? {} : { search }),
    ...(view === 'pending' ? { pendingOnly: 'true' } : {}),
  };
  const { data, isLoading, isError, error, refetch } = useTrainingNominations(params);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<TrainingNominationDto>[] = [
    {
      key: 'employee',
      header: t('training.nomination.employee'),
      render: (n) => (
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {n.employeeName}
          </span>
          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {n.employeeCode}
          </span>
        </div>
      ),
    },
    {
      key: 'course',
      header: t('training.session.course'),
      render: (n) => <span>{locale === 'ar' ? n.courseNameAr : n.courseNameEn}</span>,
    },
    {
      key: 'when',
      header: t('training.session.when'),
      render: (n) => <span>{formatDate(n.sessionStartsAt, locale)}</span>,
    },
    {
      key: 'reason',
      header: t('training.nomination.reason'),
      render: (n) => <span className="line-clamp-2 text-sm">{n.reason}</span>,
    },
    {
      key: 'status',
      header: t('training.statusColumn'),
      render: (n) => <NominationStatusBadge status={n.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (n) =>
        n.status === 'pendingApproval' ? (
          <Can permission="trainingNomination.decide">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeciding({ nomination: n, decision: 'rejected' })}
              >
                {t('training.nomination.action.rejected')}
              </Button>
              <Button
                size="sm"
                onClick={() => setDeciding({ nomination: n, decision: 'approved' })}
              >
                {t('training.nomination.action.approved')}
              </Button>
            </div>
          </Can>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('training.nomination.title')}
        description={t('training.nomination.subtitle')}
        breadcrumbs={[{ label: t('training.title') }, { label: t('training.nomination.title') }]}
        actions={
          <Can permission="trainingNomination.create">
            <Button onClick={() => setNominating(true)}>{t('training.nomination.new')}</Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
            placeholder={t('training.nomination.searchPlaceholder')}
          />
          <Select
            value={view}
            onChange={(e) => patch({ view: e.target.value, page: null })}
            className="w-full sm:w-48"
          >
            <option value="pending">{t('training.nomination.viewPending')}</option>
            <option value="all">{t('training.nomination.viewAll')}</option>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(n) => n.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {nominating && <NominateDialog onClose={() => setNominating(false)} />}
      {deciding !== null && (
        <DecideDialog
          nomination={deciding.nomination}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
        />
      )}
    </PageContainer>
  );
};
