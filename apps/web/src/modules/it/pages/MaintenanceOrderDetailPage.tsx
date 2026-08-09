// One maintenance order, end to end (design §2.7, §4.7).
//
// **Which action is offered is the state machine, said out loud.** `MAINTENANCE_ORDER_TRANSITIONS`
// on the server decides what is legal; this page shows only the buttons that could be accepted from
// the order's CURRENT status, each behind its own §7 grant. Offering a button that can only ever
// 422 is worse than not offering it.
//
// **The parts panel reads the LEDGER, not the order** (ADR-024). An order carries no embedded parts
// list, so "what did this repair consume" is answered by the movements keyed to it — one source of
// truth, and no drift between a copy and the record.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { CheckIcon, CloseIcon, PlayIcon } from '../../../shared/ui/icons';
import { formatDate, formatDateTime, formatNumber } from '../../../shared/lib/format';
import { useItAsset, useItMaintenanceOrder, useItMaintenanceOrderParts } from '../api/it-queries';
import { MaintenanceStatusBadge } from '../components/MaintenanceStatusBadge';
import { AssetStatusBadge } from '../components/AssetStatusBadge';
import { ItUserName } from '../components/ItUserName';
import { ItSparePartName } from '../components/ItSparePartName';
import {
  CancelMaintenanceOrderDialog,
  CompleteMaintenanceOrderDialog,
  StartMaintenanceOrderDialog,
} from '../components/MaintenanceOrderDialogs';

type ActionKey = 'start' | 'complete' | 'cancel';

/** One label/value row. `value` is already formatted — this only lays it out. */
const Fact = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): JSX.Element => (
  <div className="py-2">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd
      className={`mt-0.5 text-sm text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}
      {...(mono ? { dir: 'ltr' as const } : {})}
    >
      {value === null || value === '' ? '—' : value}
    </dd>
  </div>
);

export const MaintenanceOrderDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const [action, setAction] = useState<ActionKey | null>(null);

  const { data: order, isLoading, isError, error, refetch } = useItMaintenanceOrder(id);
  const asset = useItAsset(order?.assetId ?? '');
  const parts = useItMaintenanceOrderParts(id, order !== undefined);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || order === undefined) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  // The transitions the server would accept from here. Kept in the same order as the table.
  const canStart = order.status === 'open' && can('itMaintenance.edit');
  const canComplete = order.status === 'inProgress' && can('itMaintenance.complete');
  const canCancel =
    (order.status === 'open' || order.status === 'inProgress') && can('itMaintenance.complete');

  return (
    <PageContainer>
      <PageHeader
        title={order.orderCode}
        description={t(`it.maintenance.kind.${order.kind}`)}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.maintenance'), to: '/it/maintenance' },
          { label: order.orderCode },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canStart && (
              <Button
                size="sm"
                leftIcon={<PlayIcon className="h-4 w-4" />}
                onClick={() => setAction('start')}
              >
                {t('it.maintenance.start')}
              </Button>
            )}
            {canComplete && (
              <Button
                size="sm"
                leftIcon={<CheckIcon className="h-4 w-4" />}
                onClick={() => setAction('complete')}
              >
                {t('it.maintenance.complete')}
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="ghost-danger"
                leftIcon={<CloseIcon className="h-4 w-4" />}
                onClick={() => setAction('cancel')}
              >
                {t('it.maintenance.cancel')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('it.maintenance.sections.order')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label={t('it.maintenance.columns.code')} value={order.orderCode} mono />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.maintenance.columns.status')}
                </dt>
                <dd className="mt-0.5">
                  <MaintenanceStatusBadge status={order.status} />
                </dd>
              </div>
              <Fact
                label={t('it.maintenance.columns.kind')}
                value={t(`it.maintenance.kind.${order.kind}`)}
              />
              <Fact
                label={t('it.maintenance.columns.scheduledFor')}
                value={order.scheduledFor === null ? null : formatDate(order.scheduledFor, locale)}
              />
              <Fact
                label={t('it.maintenance.fields.startedAt')}
                value={order.startedAt === null ? null : formatDateTime(order.startedAt, locale)}
              />
              <Fact
                label={t('it.maintenance.columns.completedAt')}
                value={order.completedAt === null ? null : formatDateTime(order.completedAt, locale)}
              />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.maintenance.fields.performedBy')}
                </dt>
                <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">
                  {order.performedByUserId === null ? (
                    '—'
                  ) : (
                    <ItUserName id={order.performedByUserId} />
                  )}
                </dd>
              </div>
              <Fact
                label={t('it.maintenance.fields.cost')}
                value={order.cost === null ? null : formatNumber(order.cost, locale)}
              />
              {/* Corrective orders born from a ticket link back to it — the repair and the
                  request are one story, and the reader should not have to search for the half
                  they are not looking at. */}
              {order.ticketId !== null && (
                <div className="py-2">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    {t('it.maintenance.fields.ticket')}
                  </dt>
                  <dd className="mt-0.5 text-sm">
                    <Link
                      to={`/it/tickets/${order.ticketId}`}
                      className="text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {t('it.maintenance.openTicket')}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <Fact label={t('it.maintenance.fields.summary')} value={order.summary} />
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.maintenance.sections.asset')} />
          <CardBody>
            {asset.data === undefined ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {asset.isError ? t('it.assets.pickedUnresolved') : t('common.loading')}
              </p>
            ) : (
              <dl>
                <div className="py-2">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    {t('it.maintenance.fields.asset')}
                  </dt>
                  <dd className="mt-0.5 text-sm">
                    <Link
                      to={`/it/assets/${asset.data.id}`}
                      className="text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {asset.data.assetCode} — {asset.data.name}
                    </Link>
                  </dd>
                </div>
                <div className="py-2">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    {t('it.assets.columns.status')}
                  </dt>
                  <dd className="mt-0.5">
                    <AssetStatusBadge status={asset.data.status} />
                  </dd>
                </div>
                {/* What completion will restore. Shown because it is the one field a technician
                    cannot infer, and the one the design's custody rule turns on. */}
                <Fact
                  label={t('it.maintenance.fields.assetStatusBefore')}
                  value={
                    order.assetStatusBefore === null
                      ? null
                      : t(`it.assets.status.${order.assetStatusBefore}`)
                  }
                />
              </dl>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title={t('it.maintenance.partsUsed')}
            description={t('it.maintenance.partsLedgerHint')}
          />
          <CardBody>
            {!can('itSparePart.view') ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('it.parts.noAccess')}
              </p>
            ) : parts.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (parts.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('it.maintenance.noPartsUsed')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {(parts.data ?? []).map((movement) => (
                  <li key={movement.id} className="flex items-center justify-between gap-3 py-2">
                    <ItSparePartName id={movement.partId} />
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-sm text-slate-700 dark:text-slate-200" dir="ltr">
                        {formatNumber(Math.abs(movement.qty), locale)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(movement.at, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <StartMaintenanceOrderDialog
        open={action === 'start'}
        onClose={() => setAction(null)}
        order={order}
      />
      <CompleteMaintenanceOrderDialog
        open={action === 'complete'}
        onClose={() => setAction(null)}
        order={order}
      />
      <CancelMaintenanceOrderDialog
        open={action === 'cancel'}
        onClose={() => setAction(null)}
        order={order}
      />
    </PageContainer>
  );
};
