// One ticket, end to end (design §2.6, §4.4, §4.5).
//
// **Which action is offered is the state machine, said out loud.** `TICKET_TRANSITIONS` on the
// server decides what is legal; this page shows only the buttons that could be accepted from the
// ticket's CURRENT status, and each behind its own §7 grant. The server still decides — offering a
// button that can only ever 422 is worse than not offering it.
//
// One deliberate exception, and it is FR-14: the requester's own Cancel is offered on ownership,
// not on a grant, because "withdraw my own request" is not a privilege. The server enforces the
// same rule (own ticket, still `open`); this only puts the button where the rule already is.
//
// Everything shown is a SERVER fact. The SLA panel reads the snapshot and the breach STAMPS —
// never a recomputed clock — so a ticket resolved late still reads as breached (FR-6).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import {
  CheckIcon,
  CloseIcon,
  EditIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  UsersIcon,
} from '../../../shared/ui/icons';
import { formatDateTime, localized } from '../../../shared/lib/format';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useChangeItTicketStatus,
  useItAsset,
  useItCatalog,
  useItTicket,
  useItTicketComments,
  useItTicketPriorities,
} from '../api/it-queries';
import { TicketStatusBadge } from '../components/TicketStatusBadge';
import { SlaIndicator } from '../components/SlaIndicator';
import { TicketStream } from '../components/TicketStream';
import { TicketCommentForm } from '../components/TicketCommentForm';
import { ItUserName } from '../components/ItUserName';
import {
  AssignTicketDialog,
  CancelTicketDialog,
  CloseTicketDialog,
  EditTicketDialog,
  HoldTicketDialog,
  ReopenTicketDialog,
  ResolveTicketDialog,
} from '../components/TicketDialogs';

type ActionKey = 'assign' | 'hold' | 'resolve' | 'close' | 'reopen' | 'cancel' | 'edit';

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

const Node = ({ label, value }: { label: string; value: JSX.Element }): JSX.Element => (
  <div className="py-2">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">{value}</dd>
  </div>
);

export const TicketDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const me = useAppSelector((state) => state.auth.me);
  const { id = '' } = useParams();
  const { data: ticket, isPending, isError, error, refetch } = useItTicket(id);
  const [action, setAction] = useState<ActionKey | null>(null);
  const start = useChangeItTicketStatus();

  const stream = useItTicketComments(id, { pageSize: 100 }, id !== '');
  const categories = useItCatalog('ticketCategory');
  const priorities = useItTicketPriorities();
  // The optional asset link. Gated on `itAsset.view` so a requester without the registry grant
  // still reads their ticket — they just see the reference rather than the asset's name.
  const canAssets = can('itAsset.view');
  const asset = useItAsset(canAssets ? (ticket?.assetId ?? '') : '');

  if (isPending) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (isError || ticket === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const isOwner = me !== null && me.id === ticket.requesterUserId;
  const canWork = can('itTicket.edit');
  const canAssign = can('itTicket.assign');
  const canClose = can('itTicket.close');
  const terminal = ticket.status === 'closed' || ticket.status === 'cancelled';

  // The state machine, expressed as which button is even rendered (§4.4).
  const showAssign = canAssign && (ticket.status === 'open' || ticket.status === 'inProgress' || ticket.status === 'onHold');
  const showStart = canWork && (ticket.status === 'open' || ticket.status === 'onHold');
  const showHold = canWork && ticket.status === 'inProgress';
  const showResolve = canWork && ticket.status === 'inProgress';
  const showClose = canClose && ticket.status === 'resolved';
  const showReopen = canClose && (ticket.status === 'resolved' || ticket.status === 'closed');
  // FR-14: ownership, not a grant — and only while the ticket is still open. A holder of
  // `itTicket.close` may cancel any live ticket.
  const showCancel =
    (isOwner && ticket.status === 'open') ||
    (canClose && ['open', 'inProgress', 'onHold'].includes(ticket.status));
  const showEdit = canWork && !terminal;

  const startWork = async (): Promise<void> => {
    try {
      await start.mutateAsync({ id: ticket.id, body: { to: 'inProgress' } });
      toast.success(t('it.tickets.started'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const categoryName =
    (categories.data?.items ?? []).find((c) => c.id === ticket.categoryId)?.name ?? null;
  const priority = (priorities.data?.items ?? []).find((p) => p.id === ticket.priorityId) ?? null;

  // Minutes → a readable duration, from the SNAPSHOT the ticket carries — not from the priority
  // row, which may have been edited since (§2.6).
  const minutes = (value: number): string =>
    value >= 60
      ? t('it.priorities.hoursShort', { hours: String(Math.round((value / 60) * 10) / 10) })
      : t('it.priorities.minutesShort', { minutes: String(value) });

  const commentDisabled = ticket.status === 'cancelled';

  return (
    <PageContainer>
      <PageHeader
        title={ticket.title}
        description={ticket.ticketCode}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.tickets'), to: '/it/tickets' },
          { label: ticket.ticketCode },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {showEdit && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<EditIcon className="h-4 w-4" />}
                onClick={() => setAction('edit')}
              >
                {t('common.edit')}
              </Button>
            )}
            {showAssign && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<UsersIcon className="h-4 w-4" />}
                onClick={() => setAction('assign')}
              >
                {t('it.tickets.assign')}
              </Button>
            )}
            {showStart && (
              <Button
                size="sm"
                leftIcon={<PlayIcon className="h-4 w-4" />}
                loading={start.isPending}
                onClick={() => void startWork()}
              >
                {ticket.status === 'onHold' ? t('it.tickets.resume') : t('it.tickets.start')}
              </Button>
            )}
            {showHold && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<PauseIcon className="h-4 w-4" />}
                onClick={() => setAction('hold')}
              >
                {t('it.tickets.hold')}
              </Button>
            )}
            {showResolve && (
              <Button
                size="sm"
                leftIcon={<CheckIcon className="h-4 w-4" />}
                onClick={() => setAction('resolve')}
              >
                {t('it.tickets.resolve')}
              </Button>
            )}
            {showClose && (
              <Button
                size="sm"
                leftIcon={<CheckIcon className="h-4 w-4" />}
                onClick={() => setAction('close')}
              >
                {t('it.tickets.close')}
              </Button>
            )}
            {showReopen && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<ResetIcon className="h-4 w-4" />}
                onClick={() => setAction('reopen')}
              >
                {t('it.tickets.reopen')}
              </Button>
            )}
            {showCancel && (
              <Button
                size="sm"
                variant="ghost-danger"
                leftIcon={<CloseIcon className="h-4 w-4" />}
                onClick={() => setAction('cancel')}
              >
                {t('it.tickets.cancel')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('it.tickets.sections.request')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label={t('it.tickets.columns.code')} value={ticket.ticketCode} mono />
              <Node
                label={t('it.tickets.columns.status')}
                value={<TicketStatusBadge status={ticket.status} />}
              />
              <Node
                label={t('it.tickets.columns.requester')}
                value={<ItUserName id={ticket.requesterUserId} />}
              />
              <Node
                label={t('it.tickets.columns.technician')}
                value={
                  ticket.assignedTechnicianUserId === null ? (
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('it.tickets.unassigned')}
                    </span>
                  ) : (
                    <ItUserName id={ticket.assignedTechnicianUserId} />
                  )
                }
              />
              <Fact
                label={t('it.tickets.columns.category')}
                value={categoryName === null ? null : localized(categoryName, locale)}
              />
              <Fact
                label={t('it.tickets.columns.priority')}
                value={priority === null ? null : localized(priority.name, locale)}
              />
              <Fact
                label={t('it.tickets.openedAt')}
                value={formatDateTime(ticket.createdAt, locale)}
              />
              <Fact
                label={t('it.tickets.reopenCount')}
                value={ticket.reopenCount === 0 ? null : String(ticket.reopenCount)}
              />
              {ticket.assetId !== null && (
                <div className="sm:col-span-2">
                  <Node
                    label={t('it.tickets.linkedAsset')}
                    value={
                      canAssets && asset.data !== undefined ? (
                        <Link
                          to={`/it/assets/${ticket.assetId}`}
                          className="text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {`${asset.data.assetCode} — ${asset.data.name}`}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {ticket.assetId}
                        </span>
                      )
                    }
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.tickets.fields.description')}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                  {ticket.description}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.tickets.sections.sla')} description={t('it.tickets.slaHint')} />
          <CardBody>
            <dl>
              <Node
                label={t('it.tickets.sla.responsePhase')}
                value={<SlaIndicator ticket={ticket} phase="response" />}
              />
              <Node
                label={t('it.tickets.sla.resolutionPhase')}
                value={<SlaIndicator ticket={ticket} phase="resolution" />}
              />
              <Fact
                label={t('it.tickets.sla.firstResponseAt')}
                value={
                  ticket.sla.firstResponseAt === null
                    ? null
                    : formatDateTime(ticket.sla.firstResponseAt, locale)
                }
              />
              <Fact
                label={t('it.tickets.sla.target')}
                value={`${minutes(ticket.sla.policy.responseMinutes)} / ${minutes(ticket.sla.policy.resolutionMinutes)}`}
              />
              {ticket.sla.pausedMs > 0 && (
                <Fact
                  label={t('it.tickets.sla.paused')}
                  value={minutes(Math.round(ticket.sla.pausedMs / 60_000))}
                />
              )}
            </dl>
            {ticket.status === 'onHold' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                {t('it.tickets.sla.onHoldNote')}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('it.tickets.sla.snapshotNote')}
            </p>
          </CardBody>
        </Card>

        {ticket.resolution !== null && (
          <Card className="lg:col-span-3">
            <CardHeader title={t('it.tickets.sections.resolution')} />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                {ticket.resolution.summary}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Badge tone="success">{t('it.tickets.status.resolved')}</Badge>
                <ItUserName id={ticket.resolution.resolvedByUserId} />
                <span className="tabular-nums">
                  {formatDateTime(ticket.resolution.resolvedAt, locale)}
                </span>
                {ticket.closedAt !== null && (
                  <span className="tabular-nums">
                    {`${t('it.tickets.closedAt')}: ${formatDateTime(ticket.closedAt, locale)}`}
                  </span>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        <Card className="lg:col-span-3">
          <CardHeader
            title={t('it.tickets.sections.stream')}
            description={t('it.tickets.streamHint')}
          />
          <CardBody>
            <div className="space-y-5">
              <TicketCommentForm
                ticketId={ticket.id}
                disabled={commentDisabled}
                {...(commentDisabled ? { disabledReason: t('it.tickets.commentCancelled') } : {})}
              />
              <TicketStream
                entries={stream.data?.items ?? []}
                isPending={stream.isPending}
                isError={stream.isError}
                error={stream.error}
                onRetry={() => void stream.refetch()}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <EditTicketDialog
        open={action === 'edit'}
        onClose={() => setAction(null)}
        ticket={ticket}
      />
      <AssignTicketDialog
        open={action === 'assign'}
        onClose={() => setAction(null)}
        ticket={ticket}
      />
      <HoldTicketDialog open={action === 'hold'} onClose={() => setAction(null)} ticket={ticket} />
      <ResolveTicketDialog
        open={action === 'resolve'}
        onClose={() => setAction(null)}
        ticket={ticket}
      />
      <CloseTicketDialog open={action === 'close'} onClose={() => setAction(null)} ticket={ticket} />
      <ReopenTicketDialog
        open={action === 'reopen'}
        onClose={() => setAction(null)}
        ticket={ticket}
      />
      <CancelTicketDialog
        open={action === 'cancel'}
        onClose={() => setAction(null)}
        ticket={ticket}
      />
    </PageContainer>
  );
};
