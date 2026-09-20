// Request detail (frozen design §11): approval-chain stepper + status-aware actions —
// approve/reject (current manager or HR — the server authorizes by relationship, R9),
// cancel, early return, attachments. Visibility itself is server-enforced.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { ApprovalChainPanel } from '../../../../platform/approvals/ApprovalChainPanel';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Button,
  Card,
  CardBody,
  Dialog,
  ErrorState,
  LoadingState,
} from '../../../../shared/ui';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { formatDate } from '../../../../shared/lib/format';
import {
  useAttachToLeaveRequest,
  useCancelLeaveRequest,
  useDecideLeaveRequest,
  useLeaveRequest,
  useReturnLeaveRequest,
} from '../api/leave-queries';
import { LeaveStatusBadge } from '../components/LeaveStatusBadge';
import { typeLabel } from '../components/typeLabel';

type Act = 'approve' | 'reject' | 'cancel' | 'return' | null;

export const LeaveRequestDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: request, isLoading, isError, refetch } = useLeaveRequest(id);
  const [act, setAct] = useState<Act>(null);
  const [comment, setComment] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const decide = useDecideLeaveRequest();
  const cancel = useCancelLeaveRequest();
  const doReturn = useReturnLeaveRequest();
  const attach = useAttachToLeaveRequest();

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || request === undefined) {
    return <PageContainer><ErrorState onRetry={() => void refetch()} /></PageContainer>;
  }

  // The engine's own status counts as pending here: the page's «may I act» gates are about the
  // request being open, and WHO may act is answered separately — by the chain for an engine
  // request, and by the two-desk rules for an older one.
  const pending =
    request.status === 'pendingManager' ||
    request.status === 'pendingHr' ||
    request.status === 'pendingApproval';
  /**
   * Whether to offer the decision at all.
   *
   * On a request the ENGINE runs the chain has already answered this, against the reader's own
   * roles and delegations — so the screen offers exactly what the save would accept, instead of a
   * button that turns into a 403. On an older request the two-desk rules still decide, and they
   * are enforced on the server against a relationship the screen cannot see; there the button
   * stays offered to anybody who can open a pending request, as it always was.
   */
  const mayDecide =
    request.approvalTrail === null
      ? pending
      : request.approvalTrail.viewerMayDecide || request.approvalTrail.viewerMayOverride;
  const busy = decide.isPending || cancel.isPending || doReturn.isPending;
  const activeError =
    (decide.isError ? decide.error : null) ??
    (cancel.isError ? cancel.error : null) ??
    (doReturn.isError ? doReturn.error : null) ??
    (attach.isError ? attach.error : null);

  const close = (): void => {
    setAct(null);
    setComment('');
    setReturnDate('');
  };
  const run = (): void => {
    if (act === 'approve' || act === 'reject') {
      decide.mutate(
        {
          id,
          verdict: act,
          body: { ...(comment.trim() === '' ? {} : { comment: comment.trim() }), version: request.version },
        },
        { onSuccess: close },
      );
    } else if (act === 'cancel') {
      cancel.mutate(
        { id, body: { ...(comment.trim() === '' ? {} : { reason: comment.trim() }), version: request.version } },
        { onSuccess: close },
      );
    } else if (act === 'return' && returnDate !== '') {
      doReturn.mutate(
        { id, body: { actualReturnDate: new Date(returnDate), version: request.version } },
        { onSuccess: close },
      );
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={`${typeLabel(t, request.typeCode)} — ${request.employeeName}`}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.detail.title') }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {mayDecide && (
              <>
                <Button size="sm" onClick={() => setAct('approve')}>{t('leave.actions.approve')}</Button>
                <Button size="sm" variant="danger" onClick={() => setAct('reject')}>{t('leave.actions.reject')}</Button>
              </>
            )}
            {(pending || request.status === 'approved') && (
              <Button size="sm" variant="secondary" onClick={() => setAct('cancel')}>{t('leave.actions.cancel')}</Button>
            )}
            {request.status === 'active' && (
              <Button size="sm" variant="secondary" onClick={() => setAct('return')}>{t('leave.actions.return')}</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <dt className="text-slate-500">{t('leave.columns.status')}</dt>
              <dd><LeaveStatusBadge status={request.status} /></dd>
              <dt className="text-slate-500">{t('leave.columns.span')}</dt>
              <dd dir="ltr">
                {formatDate(request.startDate, locale)} → {formatDate(request.endDate, locale)}
                {request.halfDayStart ? ` · ${t('leave.request.halfDayStart')}` : ''}
                {request.halfDayEnd ? ` · ${t('leave.request.halfDayEnd')}` : ''}
              </dd>
              <dt className="text-slate-500">{t('leave.columns.days')}</dt>
              <dd><strong>{request.days}</strong></dd>
              {request.reason !== null && (
                <>
                  <dt className="text-slate-500">{t('leave.detail.reason')}</dt>
                  <dd>{request.reason}</dd>
                </>
              )}
              {request.actualReturnDate !== null && (
                <>
                  <dt className="text-slate-500">{t('leave.detail.actualReturn')}</dt>
                  <dd>{formatDate(request.actualReturnDate, locale)}</dd>
                </>
              )}
              {request.cancelReason !== null && (
                <>
                  <dt className="text-slate-500">{t('leave.detail.cancelReason')}</dt>
                  <dd>{request.cancelReason}</dd>
                </>
              )}
              {request.statusDriveOutcome === 'failed' && (
                <>
                  <dt className="text-slate-500">{t('leave.detail.statusDrive')}</dt>
                  <dd className="text-red-600">{t('leave.detail.statusDriveFailed')}</dd>
                </>
              )}
            </dl>
            {pending && (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-600">
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file !== undefined) attach.mutate({ id, file });
                    }}
                  />
                  {attach.isPending ? t('common.loading') : t('leave.actions.attach')}
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  {t('leave.detail.attachments')}: {request.attachments.length}
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* A request the engine runs shows its configured chain instead of the two-desk list —
            the two describe different machines and drawing both would invite the reader to read
            one as a summary of the other. */}
        <ApprovalChainPanel trail={request.approvalTrail} />

        {request.approvalTrail === null && (
        <Card>
          <CardBody>
            <h3 className="mb-3 text-sm font-semibold">{t('leave.detail.approvals')}</h3>
            {request.approvals.length === 0 && request.pendingStep === null && (
              <p className="text-sm text-slate-500">—</p>
            )}
            <ol className="space-y-3">
              {request.approvals.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={a.decision === 'approved' ? 'text-emerald-600' : 'text-red-600'}>
                    {a.decision === 'approved' ? '✓' : '✕'}
                  </span>
                  <div>
                    <div>
                      {t(`leave.step.${a.step}`)} — {t(`leave.decision.${a.decision}`)}
                    </div>
                    {a.comment !== null && <div className="text-xs text-slate-500">{a.comment}</div>}
                    <div className="text-xs text-slate-400">{formatDate(a.at, locale)}</div>
                  </div>
                </li>
              ))}
              {request.pendingStep !== null && (
                <li className="flex items-start gap-2 text-sm text-amber-600">
                  <span>…</span>
                  <span>{t(`leave.step.${request.pendingStep}`)} — {t('leave.detail.awaiting')}</span>
                </li>
              )}
            </ol>
          </CardBody>
        </Card>
        )}
      </div>

      {activeError !== null && <p className="mt-3 text-sm text-red-600">{(activeError as Error).message}</p>}

      <Dialog
        open={act !== null}
        onClose={close}
        title={act === null ? '' : t(`leave.confirm.${act}`)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
            <Button
              onClick={run}
              loading={busy}
              variant={act === 'reject' || act === 'cancel' ? 'danger' : 'primary'}
              disabled={act === 'return' && returnDate === ''}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {act === 'return' ? (
            <Field label={t('leave.detail.actualReturn')}>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </Field>
          ) : (
            <Field label={t('leave.detail.comment')}>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
        </div>
      </Dialog>
    </PageContainer>
  );
};
