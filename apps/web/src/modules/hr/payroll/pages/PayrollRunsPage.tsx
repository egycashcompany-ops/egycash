// Payroll runs (PY-6) — the periods, and which of them have stopped moving.
//
// The whole screen exists for one button, and that button is irreversible: freezing a period
// stamps every attendance day in it forever and pins the leave consumptions that touch it. So it
// asks first, in words that say what cannot be undone, and it shows the receipt afterwards —
// how many rows were frozen, how many were recomputed on the way, how many leave slices were
// pinned. A number nobody can check is not a receipt.
//
// What this screen is NOT: a calculation. No line, no total, no payslip, no tax. A run makes the
// facts stand still; pricing them belongs to the phases that are given those rules.
import { useState } from 'react';
import { type Locale, type PayrollRunDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../shared/ui/form';
import { PlusIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatDate, formatDateTime, formatNumber } from '../../../../shared/lib/format';
import {
  useCancelPayrollRun,
  useCreatePayrollRun,
  useFreezePayrollRun,
  usePayrollRuns,
} from '../api/payroll-queries';

const PAGE_SIZE = 25;

/** `YYYY-MM` of the month before this one — the first period that CAN be frozen. */
const lastPeriod = (): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};

const TONE: Record<PayrollRunDto['status'], 'neutral' | 'success' | 'warning'> = {
  draft: 'warning',
  frozen: 'success',
  cancelled: 'neutral',
};

export const PayrollRunsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [freezing, setFreezing] = useState<PayrollRunDto | null>(null);
  const [cancelling, setCancelling] = useState<PayrollRunDto | null>(null);

  const runs = usePayrollRuns({ page, pageSize: PAGE_SIZE, sortBy: 'period', sortDir: 'desc' });

  const columns: Column<PayrollRunDto>[] = [
    {
      key: 'period',
      header: t('payroll.runs.period'),
      render: (r) => (
        <span className="flex flex-col">
          <span className="font-mono" dir="ltr">
            {r.period}
          </span>
          <span className="text-xs text-slate-400">
            {`${formatDate(r.from, locale)} — ${formatDate(r.to, locale)}`}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('payroll.runs.status'),
      render: (r) => <Badge tone={TONE[r.status]}>{t(`payroll.runs.status.${r.status}`)}</Badge>,
    },
    {
      key: 'frozenAt',
      header: t('payroll.runs.frozenAt'),
      render: (r) =>
        r.frozenAt === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          formatDateTime(r.frozenAt, locale)
        ),
    },
    {
      // The receipt: what the freeze actually pinned. Without it "frozen" is a word.
      key: 'receipt',
      header: t('payroll.runs.receipt'),
      render: (r) =>
        r.status === 'frozen' ? (
          <span className="flex flex-col text-xs text-slate-500">
            <span>
              {t('payroll.runs.attendanceRows', { rows: formatNumber(r.attendanceFrozenRows, locale) })}
            </span>
            <span>
              {t('payroll.runs.leaveRows', { rows: formatNumber(r.leaveSnapshotRows, locale) })}
            </span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: 'actions',
      header: t('payroll.runs.actions'),
      render: (r) => (
        <Can permission="payrollRun.manage" fallback={<span className="text-slate-300">—</span>}>
          <span className="flex gap-2">
            {r.status === 'draft' && (
              <Button size="sm" onClick={() => setFreezing(r)}>
                {t('payroll.runs.freeze')}
              </Button>
            )}
            {r.status !== 'cancelled' && (
              <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>
                {t('payroll.runs.cancel')}
              </Button>
            )}
          </span>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('payroll.runs.title')}
        description={t('payroll.runs.subtitle')}
        breadcrumbs={[{ label: t('payroll.module.title') }, { label: t('payroll.runs.title') }]}
        actions={
          <Can permission="payrollRun.manage">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setAdding(true)}>
              {t('payroll.runs.add')}
            </Button>
          </Can>
        }
      />

      <DataTable
        columns={columns}
        rows={runs.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={runs.isLoading}
        error={runs.isError ? runs.error : undefined}
        onRetry={() => void runs.refetch()}
        empty={
          <EmptyState title={t('payroll.runs.empty')} description={t('payroll.runs.emptyHint')} />
        }
      />
      {runs.data !== undefined && <Pagination meta={runs.data.meta} onPageChange={setPage} />}

      {adding && <NewRunDialog onClose={() => setAdding(false)} />}
      {freezing !== null && <FreezeDialog run={freezing} onClose={() => setFreezing(null)} />}
      {cancelling !== null && <CancelDialog run={cancelling} onClose={() => setCancelling(null)} />}
    </PageContainer>
  );
};

const NewRunDialog = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const create = useCreatePayrollRun();
  const [period, setPeriod] = useState(lastPeriod);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.runs.add')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { period },
                {
                  onSuccess: () => {
                    toast.success(t('payroll.runs.created'));
                    onClose();
                  },
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t('payroll.runs.period')} hint={t('payroll.runs.periodHint')}>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label={t('payroll.runs.period')}
          />
        </Field>
        <MutationError error={create.error} />
      </div>
    </Dialog>
  );
};

/**
 * The irreversible one, and the dialog says so in the words that matter.
 *
 * There is no unfreeze anywhere in this system: once a period is frozen, its attendance days can
 * never be recomputed, and a correction filed afterwards reaches pay as a forward adjustment
 * instead. That is worth a sentence and a deliberate second click.
 */
const FreezeDialog = ({ run, onClose }: { run: PayrollRunDto; onClose: () => void }): JSX.Element => {
  const t = useT();
  const freeze = useFreezePayrollRun();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.runs.freezeTitle', { period: run.period })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={freeze.isPending}
            onClick={() =>
              freeze.mutate(
                { id: run.id, version: run.version },
                {
                  onSuccess: () => {
                    toast.success(t('payroll.runs.frozen'));
                    onClose();
                  },
                },
              )
            }
          >
            {t('payroll.runs.freeze')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {t('payroll.runs.freezeWarning')}
        </p>
        <p className="text-sm text-slate-500">{t('payroll.runs.freezeExplains')}</p>
        <MutationError error={freeze.error} />
      </div>
    </Dialog>
  );
};

const CancelDialog = ({ run, onClose }: { run: PayrollRunDto; onClose: () => void }): JSX.Element => {
  const t = useT();
  const cancel = useCancelPayrollRun();
  const [reason, setReason] = useState('');

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('payroll.runs.cancelTitle', { period: run.period })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < 3}
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(
                { id: run.id, reason: reason.trim(), version: run.version },
                {
                  onSuccess: () => {
                    toast.success(t('payroll.runs.cancelled'));
                    onClose();
                  },
                },
              )
            }
          >
            {t('payroll.runs.cancel')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {run.status === 'frozen' && (
          <p className="text-sm text-slate-500">{t('payroll.runs.cancelFrozenHint')}</p>
        )}
        <Field label={t('payroll.runs.cancelReason')}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t('payroll.runs.cancelReason')}
          />
        </Field>
        <MutationError error={cancel.error} />
      </div>
    </Dialog>
  );
};

const MutationError = ({ error }: { error: unknown }): JSX.Element | null =>
  error === null || error === undefined ? null : (
    <p role="alert" className="text-sm text-red-600">
      {(error as Error).message}
    </p>
  );
