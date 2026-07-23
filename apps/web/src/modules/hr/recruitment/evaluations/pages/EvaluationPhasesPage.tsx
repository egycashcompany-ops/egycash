// Evaluation-phase settings: the admin-configurable, sequential post-interview catalog. List
// every phase (incl. disabled), add a new phase, edit names, reorder by changing the order
// number, toggle drivers-only, and enable/disable — all from the UI, gated by
// `evaluationPhase.manage`. The pipeline (sequential gating, board columns) derives from the
// ACTIVE phases in order; new phases need no code change.
import { useState } from 'react';
import { type EvaluationPhaseDto, type Locale } from '@ecms/contracts';
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
  useAllEvaluationPhases,
  useCreateEvaluationPhase,
  useUpdateEvaluationPhase,
} from '../api/evaluation-queries';

type Editing = { mode: 'create' } | { mode: 'edit'; phase: EvaluationPhaseDto } | null;

const PhaseDialog = ({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }): JSX.Element => {
  const t = useT();
  const create = useCreateEvaluationPhase();
  const update = useUpdateEvaluationPhase();
  const phase = editing.mode === 'edit' ? editing.phase : null;
  const [key, setKey] = useState('');
  const [nameEn, setNameEn] = useState(phase?.name.en ?? '');
  const [nameAr, setNameAr] = useState(phase?.name.ar ?? '');
  const [order, setOrder] = useState(String(phase?.order ?? ''));
  const [driversOnly, setDriversOnly] = useState(phase?.driversOnly ?? false);
  const [active, setActive] = useState(phase?.active ?? true);
  const pending = create.isPending || update.isPending;

  const valid =
    nameEn.trim() !== '' &&
    nameAr.trim() !== '' &&
    Number(order) >= 1 &&
    (phase !== null || /^[a-z][a-zA-Z0-9.]{1,49}$/.test(key));

  const submit = async (): Promise<void> => {
    try {
      if (phase === null) {
        await create.mutateAsync({
          key,
          name: { en: nameEn.trim(), ar: nameAr.trim() },
          order: Number(order),
          driversOnly,
        });
        toast.success(t('evaluations.phases.created'));
      } else {
        await update.mutateAsync({
          id: phase.id,
          body: {
            name: { en: nameEn.trim(), ar: nameAr.trim() },
            order: Number(order),
            driversOnly,
            active,
            version: phase.version,
          },
        });
        toast.success(t('evaluations.phases.updated'));
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
      title={phase === null ? t('evaluations.phases.add') : t('evaluations.phases.edit')}
      description={t('evaluations.phases.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={pending} disabled={!valid} onClick={() => void submit()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {phase === null && (
          <Field label={t('evaluations.phases.key')} required hint={t('evaluations.phases.keyHint')}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" maxLength={50} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('evaluations.phases.nameEn')} required>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('evaluations.phases.nameAr')} required>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
          </Field>
        </div>
        <Field label={t('evaluations.phases.order')} required hint={t('evaluations.phases.orderHint')}>
          <Input type="number" min={1} max={50} value={order} onChange={(e) => setOrder(e.target.value)} dir="ltr" />
        </Field>
        <Checkbox
          label={t('evaluations.phase.driversOnly')}
          checked={driversOnly}
          onChange={(e) => setDriversOnly(e.target.checked)}
        />
        {phase !== null && (
          <Checkbox label={t('evaluations.phases.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        )}
      </div>
    </Dialog>
  );
};

export const EvaluationPhasesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: phases, isLoading, isError, error, refetch } = useAllEvaluationPhases();
  const [editing, setEditing] = useState<Editing>(null);

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || phases === undefined) {
    return <PageContainer><ErrorState error={error} onRetry={() => void refetch()} /></PageContainer>;
  }

  const sorted = [...phases].sort((a, b) => a.order - b.order);

  return (
    <PageContainer>
      <PageHeader
        title={t('evaluations.phases.title')}
        description={t('evaluations.phases.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.evaluations'), to: '/evaluations' },
          { label: t('evaluations.phases.title') },
        ]}
        actions={
          <Can permission="evaluationPhase.manage">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditing({ mode: 'create' })}>
              {t('evaluations.phases.add')}
            </Button>
          </Can>
        }
      />

      <Card>
        <CardBody>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {p.order}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {localized(p.name, locale)}
                    </p>
                    <p className="truncate font-mono text-xs text-slate-400" dir="ltr">{p.key}</p>
                  </div>
                  {p.driversOnly && <StatusBadge tone="info" label={t('evaluations.phase.driversOnly')} />}
                  {!p.active && <StatusBadge tone="neutral" label={t('evaluations.phases.disabled')} />}
                </div>
                <Can permission="evaluationPhase.manage">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: 'edit', phase: p })}>
                    {t('common.edit')}
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {editing !== null && <PhaseDialog editing={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
