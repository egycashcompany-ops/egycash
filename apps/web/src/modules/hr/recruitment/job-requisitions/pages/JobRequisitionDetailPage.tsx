// One requisition: where it stands, who decided what, and how much of it is still open.
//
// THE ACTIONS ARE THE SERVER'S RULES, SHOWN. A button appears only where the requisition's own
// status allows the act — submit on a draft, decide while a step is open, close while it is hiring
// — because a screen that offers an action the API will refuse teaches people to distrust it. What
// this page does NOT do is decide authority: the decision buttons are shown to anyone who can read
// the requisition, since step one belongs to the department's MANAGER by relationship rather than
// to a permission (D-REQ-11), and only the server knows who that is. A refusal comes back as a
// message rather than as a hidden button.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type JobRequisitionDto, type Locale, type OrgUnitOptionDto } from '@ecms/contracts';
import { useQuery } from '@tanstack/react-query';
import { Can } from '../../../../../platform/rbac/Can';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  LoadingState,
} from '../../../../../shared/ui';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { get } from '../../../../../shared/lib/api-client';
import { formatDate, formatDateTime, localized } from '../../../../../shared/lib/format';
import {
  useCancelJobRequisition,
  useCloseJobRequisition,
  useDecideJobRequisition,
  useJobRequisition,
  useJobRequisitionFills,
  useSubmitJobRequisition,
  useUpdateJobRequisition,
} from '../api/job-requisition-queries';
import { RequisitionStatusBadge } from '../components/RequisitionStatusBadge';
import {
  RequisitionForm,
  draftFrom,
  isComplete,
  toCreate,
  type RequisitionDraft,
} from '../components/RequisitionForm';

const orgOptions = (path: string): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>(`/platform/${path}/options`);

/** `open` and `partiallyFilled` — the two states in which a requisition is hiring. */
const isLive = (status: JobRequisitionDto['status']): boolean =>
  status === 'open' || status === 'partiallyFilled';

const isTerminal = (status: JobRequisitionDto['status']): boolean =>
  status === 'filled' || status === 'rejected' || status === 'cancelled' || status === 'closed';

export const JobRequisitionDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams<{ id: string }>();
  const requisition = useJobRequisition(id);
  const fills = useJobRequisitionFills(id);

  const [editing, setEditing] = useState<RequisitionDraft | null>(null);
  const [ending, setEnding] = useState<{ mode: 'close' | 'cancel'; reason: string } | null>(null);
  const [comment, setComment] = useState('');

  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgOptions('departments'),
  });
  const branches = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgOptions('branches') });

  const submit = useSubmitJobRequisition();
  const decide = useDecideJobRequisition();
  const update = useUpdateJobRequisition();
  const close = useCloseJobRequisition();
  const cancel = useCancelJobRequisition();

  if (requisition.isLoading) return <LoadingState />;
  const dto = requisition.data;
  if (dto === undefined) {
    return (
      <PageContainer>
        <EmptyState title={t('hr.requisitions.notFound')} />
      </PageContainer>
    );
  }

  const unitName = (list: OrgUnitOptionDto[] | undefined, unitId: string): string => {
    const unit = (list ?? []).find((option) => option.id === unitId);
    return unit === undefined ? '—' : localized(unit.name, locale);
  };

  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      await action();
      toast.success(t(success));
    } catch (error) {
      // The server's sentence, not a generic one: "only the department manager may decide this
      // step" is the whole answer, and replacing it with "something went wrong" throws it away.
      toast.error(error instanceof Error ? error.message : t('hr.requisitions.actionFailed'));
    }
  };

  const decision = (verdict: 'approve' | 'reject'): void => {
    void run(
      () =>
        decide.mutateAsync({
          id: dto.id,
          body: {
            verdict,
            comment: comment.trim() === '' ? null : comment.trim(),
            version: dto.version,
          },
        }),
      verdict === 'approve' ? 'hr.requisitions.approved' : 'hr.requisitions.rejected',
    );
    setComment('');
  };

  const saveEdit = async (): Promise<void> => {
    if (editing === null || !isComplete(editing)) return;
    await run(
      () =>
        update.mutateAsync({
          id: dto.id,
          body: { ...toCreate(editing), version: dto.version },
        }),
      'hr.requisitions.saved',
    );
    setEditing(null);
  };

  const end = async (): Promise<void> => {
    if (ending === null || ending.reason.trim() === '') return;
    const body = { reason: ending.reason.trim(), version: dto.version };
    await run(
      () =>
        ending.mode === 'close'
          ? close.mutateAsync({ id: dto.id, body })
          : cancel.mutateAsync({ id: dto.id, body }),
      ending.mode === 'close' ? 'hr.requisitions.closed' : 'hr.requisitions.cancelled',
    );
    setEnding(null);
  };

  const field = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
  const fact = (label: string, value: string): JSX.Element => (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title={dto.code}
        description={dto.reason}
        aside={<RequisitionStatusBadge status={dto.status} />}
        actions={
          <div className="flex flex-wrap gap-2">
            {dto.status === 'draft' ? (
              <Can permission="jobRequisition.create">
                <Button
                  onClick={() =>
                    void run(
                      () => submit.mutateAsync({ id: dto.id, version: dto.version }),
                      'hr.requisitions.submitted',
                    )
                  }
                >
                  {t('hr.requisitions.submit')}
                </Button>
              </Can>
            ) : null}
            {isTerminal(dto.status) ? null : (
              <Can permission="jobRequisition.edit">
                <Button variant="secondary" onClick={() => setEditing(draftFrom(dto))}>
                  {t('common.edit')}
                </Button>
              </Can>
            )}
            {isLive(dto.status) ? (
              <Can permission="jobRequisition.approve">
                <Button
                  variant="secondary"
                  onClick={() => setEnding({ mode: 'close', reason: '' })}
                >
                  {t('hr.requisitions.close')}
                </Button>
              </Can>
            ) : null}
            {isTerminal(dto.status) ? null : (
              <Can permission="jobRequisition.approve">
                <Button
                  variant="ghost-danger"
                  onClick={() => setEnding({ mode: 'cancel', reason: '' })}
                >
                  {t('hr.requisitions.cancel')}
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader title={t('hr.requisitions.placement')} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fact(t('hr.requisitions.columns.department'), unitName(departments.data, dto.departmentId))}
            {fact(t('hr.requisitions.form.branch'), unitName(branches.data, dto.branchId))}
            {fact(
              t('hr.requisitions.columns.filled'),
              `${String(dto.filledCount)} / ${String(dto.quantity)}`,
            )}
            {fact(
              t('hr.requisitions.columns.neededBy'),
              dto.neededBy === null ? '—' : formatDate(dto.neededBy, locale),
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('hr.requisitions.approvals')} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            {fact(
              t('hr.requisitions.managerStep'),
              dto.managerDecidedAt === null
                ? t('hr.requisitions.notDecided')
                : formatDateTime(dto.managerDecidedAt, locale),
            )}
            {fact(
              t('hr.requisitions.hrStep'),
              dto.hrDecidedAt === null
                ? t('hr.requisitions.notDecided')
                : formatDateTime(dto.hrDecidedAt, locale),
            )}
          </dl>

          {dto.status === 'pendingManager' || dto.status === 'pendingHr' ? (
            <div className="mt-4 grid gap-2">
              <textarea
                className={field}
                rows={2}
                placeholder={t('hr.requisitions.commentPlaceholder')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={() => decision('approve')} disabled={decide.isPending}>
                  {t('hr.requisitions.approve')}
                </Button>
                <Button
                  variant="ghost-danger"
                  onClick={() => decision('reject')}
                  disabled={decide.isPending}
                >
                  {t('hr.requisitions.reject')}
                </Button>
              </div>
            </div>
          ) : null}

          {dto.closeReason === null ? null : (
            <p className="mt-4 text-sm text-slate-600">
              {t('hr.requisitions.endedReason')}: {dto.closeReason}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('hr.requisitions.hires')} />
        <CardBody>
          {(fills.data ?? []).length === 0 ? (
            <EmptyState description={t('hr.requisitions.noHires')} />
          ) : (
            <ul className="grid gap-2 text-sm">
              {(fills.data ?? []).map((fill) => (
                <li key={fill.id} className="flex justify-between border-b border-slate-100 pb-2">
                  <span>{fill.applicantId}</span>
                  <span className="text-slate-500">{formatDateTime(fill.filledAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('common.edit')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={editing === null || !isComplete(editing) || update.isPending}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      >
        {editing === null ? null : (
          <RequisitionForm draft={editing} onChange={setEditing} existing={dto} />
        )}
      </Dialog>

      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={
          ending?.mode === 'close' ? t('hr.requisitions.close') : t('hr.requisitions.cancel')
        }
        description={t('hr.requisitions.endHint')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnding(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void end()}
              disabled={ending === null || ending.reason.trim() === ''}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <textarea
          className={field}
          rows={3}
          value={ending?.reason ?? ''}
          onChange={(e) =>
            setEnding((prev) => (prev === null ? prev : { ...prev, reason: e.target.value }))
          }
        />
      </Dialog>
    </PageContainer>
  );
};
