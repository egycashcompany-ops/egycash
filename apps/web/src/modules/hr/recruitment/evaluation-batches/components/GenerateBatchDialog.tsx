// "Generate batch" (RW8) — the one bulk action that CREATES. It opens over a phase's waiting
// queue, offers exactly the applicants the server considers eligible, and hands the selection back
// as a draft batch. Eligibility is never re-derived here: the candidates endpoint is the authority.
import { useMemo, useState } from 'react';
import { type BatchCandidateDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { formatDate } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useBatchCandidates, useCreateEvaluationBatch } from '../api/evaluation-batch-queries';

export const GenerateBatchDialog = ({
  phaseId,
  open,
  onClose,
  onCreated,
}: {
  phaseId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (batchId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [title, setTitle] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');

  const { data, isLoading, isError, error, refetch } = useBatchCandidates(phaseId, open);
  const rows = useMemo(() => data ?? [], [data]);
  const rowIds = useMemo(() => rows.map((c) => c.applicantId), [rows]);
  const selection = useTableSelection(rowIds);
  const create = useCreateEvaluationBatch();

  const columns: Column<BatchCandidateDto>[] = [
    {
      key: 'applicant',
      header: t('batches.columns.applicant'),
      render: (c) => (
        <span>
          {c.applicantName}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {c.applicantCode}
          </span>
        </span>
      ),
    },
    {
      key: 'position',
      header: t('batches.columns.position'),
      render: (c) => c.placementLabel.position ?? '—',
    },
    { key: 'branch', header: t('batches.columns.branch'), render: (c) => c.placementLabel.branch ?? '—' },
    {
      key: 'since',
      header: t('batches.columns.waitingSince'),
      render: (c) => (c.eligibleSince === null ? '—' : formatDate(c.eligibleSince, locale)),
    },
  ];

  const submit = async (): Promise<void> => {
    try {
      const batch = await create.mutateAsync({
        phaseId,
        applicantIds: selection.ids,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        ...(scheduledFor === '' ? {} : { scheduledFor: new Date(scheduledFor) }),
      });
      toast.success(t('batches.created').replace('{code}', batch.code));
      selection.clear();
      setTitle('');
      setScheduledFor('');
      onCreated(batch.id);
    } catch {
      toast.error(t('batches.createFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('batches.generate.title')}
      description={t('batches.generate.subtitle')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={create.isPending}
            disabled={selection.count === 0}
            onClick={() => void submit()}
          >
            {t('batches.generate.confirm').replace('{n}', String(selection.count))}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('batches.fields.title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('batches.fields.scheduledFor')}>
            <Input
              type="date"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </Field>
        </div>
        <DataTable
          selection={selection}
          columns={columns}
          rows={rows}
          rowKey={(c) => c.applicantId}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          empty={t('batches.generate.noCandidates')}
        />
      </div>
    </Dialog>
  );
};
