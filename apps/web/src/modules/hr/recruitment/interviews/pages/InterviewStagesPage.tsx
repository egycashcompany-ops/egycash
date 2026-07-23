// Interview-stage settings: the admin-configurable round catalog (OQ-31). List every stage
// (incl. disabled), add a new round (3rd / 4th interview…), edit names, reorder by changing the
// order number, and enable/disable — all from the UI, gated by `interviewStage.manage`. The
// pipeline (progression, awaiting queue, board columns) derives from the ACTIVE stages in order.
import { useState } from 'react';
import { type InterviewStageDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Checkbox } from '../../../../../shared/ui/form';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import {
  useAllInterviewStages,
  useCreateInterviewStage,
  useUpdateInterviewStage,
} from '../api/interview-queries';

type Editing = { mode: 'create' } | { mode: 'edit'; stage: InterviewStageDto } | null;

const StageDialog = ({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }): JSX.Element => {
  const t = useT();
  const create = useCreateInterviewStage();
  const update = useUpdateInterviewStage();
  const stage = editing.mode === 'edit' ? editing.stage : null;
  const [key, setKey] = useState('');
  const [nameEn, setNameEn] = useState(stage?.name.en ?? '');
  const [nameAr, setNameAr] = useState(stage?.name.ar ?? '');
  const [order, setOrder] = useState(String(stage?.order ?? ''));
  const [active, setActive] = useState(stage?.active ?? true);
  const pending = create.isPending || update.isPending;

  const valid =
    nameEn.trim() !== '' &&
    nameAr.trim() !== '' &&
    Number(order) >= 1 &&
    (stage !== null || /^[a-z][a-zA-Z0-9.]{1,49}$/.test(key));

  const submit = async (): Promise<void> => {
    try {
      if (stage === null) {
        await create.mutateAsync({ key, name: { en: nameEn.trim(), ar: nameAr.trim() }, order: Number(order) });
        toast.success(t('interviews.stages.created'));
      } else {
        await update.mutateAsync({
          id: stage.id,
          body: { name: { en: nameEn.trim(), ar: nameAr.trim() }, order: Number(order), active, version: stage.version },
        });
        toast.success(t('interviews.stages.updated'));
      }
      onClose();
    } catch {
      // surfaced globally (order clashes arrive as 409s)
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={stage === null ? t('interviews.stages.add') : t('interviews.stages.edit')}
      description={t('interviews.stages.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={pending} disabled={!valid} onClick={() => void submit()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {stage === null && (
          <Field label={t('interviews.stages.key')} required hint={t('interviews.stages.keyHint')}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" maxLength={50} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('interviews.stages.nameEn')} required>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('interviews.stages.nameAr')} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
          </Field>
        </div>
        <Field label={t('interviews.stages.order')} required hint={t('interviews.stages.orderHint')}>
          <Input type="number" min={1} max={20} value={order} onChange={(e) => setOrder(e.target.value)} dir="ltr" />
        </Field>
        {stage !== null && (
          <Checkbox label={t('interviews.stages.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        )}
      </div>
    </Dialog>
  );
};

export const InterviewStagesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: stages, isLoading, isError, error, refetch } = useAllInterviewStages();
  const [editing, setEditing] = useState<Editing>(null);

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || stages === undefined) {
    return <PageContainer><ErrorState error={error} onRetry={() => void refetch()} /></PageContainer>;
  }

  const sorted = [...stages].sort((a, b) => a.order - b.order);

  return (
    <PageContainer>
      <PageHeader
        title={t('interviews.stages.title')}
        description={t('interviews.stages.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.interviews'), to: '/interviews' },
          { label: t('interviews.stages.title') },
        ]}
        actions={
          <Can permission="interviewStage.manage">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing({ mode: 'create' })}>
              {t('interviews.stages.add')}
            </Button>
          </Can>
        }
      />

      <Card>
        <CardBody>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {s.order}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {localized(s.name, locale)}
                    </p>
                    <p className="truncate font-mono text-xs text-slate-400" dir="ltr">{s.key}</p>
                  </div>
                  {!s.active && <StatusBadge tone="neutral" label={t('interviews.stages.disabled')} />}
                </div>
                <Can permission="interviewStage.manage">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: 'edit', stage: s })}>
                    {t('common.edit')}
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {editing !== null && <StageDialog editing={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
