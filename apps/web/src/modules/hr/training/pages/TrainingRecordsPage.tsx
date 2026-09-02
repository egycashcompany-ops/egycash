// «مَن تعلَّم ماذا» — the answer this module exists to be able to give.
//
// READ-ONLY, apart from attaching the certificate. A record says what somebody was taught and that
// is not a thing anybody later edits: there is no edit button here because there is no edit route
// there, and both facts have the same reason (D8).
//
// AN EXPIRY IS SHOWN AND MEANS NOTHING BY ITSELF (D10). It is printed because it is on the paper.
// It is not coloured red when it passes, not sorted to the top, and nothing here counts how many
// have expired — that would be a compliance report computed from a rule nobody has given.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type TrainingRecordDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { SearchInput } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { formatDate } from '../../../../shared/lib/format';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useAttachTrainingCertificate, useTrainingRecords } from '../api/training-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'q',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** The paperwork, arriving after the fact (D9) — with the expiry the paper carries, if it has one. */
const CertificateDialog = ({
  record,
  onClose,
}: {
  record: TrainingRecordDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const attach = useAttachTrainingCertificate();
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState('');

  const submit = async (): Promise<void> => {
    if (file === null) return;
    try {
      await attach.mutateAsync({
        id: record.id,
        file,
        body: expiresAt === '' ? {} : { expiresAt: new Date(expiresAt) },
      });
      toast.success(t('training.record.certificateAttached'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('training.record.attachCertificate')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={attach.isPending} disabled={file === null} onClick={() => void submit()}>
            {t('training.record.attach')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${record.employeeName} · ${record.courseNameAr}`}
      </p>
      <div className="space-y-3">
        <Field label={t('training.record.file')} required>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </Field>
        {/* Recorded because it is on the paper. Nothing reads it (D10) — the hint says so. */}
        <Field label={t('training.record.expiresAt')} hint={t('training.record.expiresAtHint')}>
          <Input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>
    </Dialog>
  );
};

export const TrainingRecordsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [attaching, setAttaching] = useState<TrainingRecordDto | null>(null);

  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const search = sp.get('q') ?? '';
  const params = { page, pageSize: DEFAULT_PAGE_SIZE, ...(search === '' ? {} : { search }) };
  const { data, isLoading, isError, error, refetch } = useTrainingRecords(params);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next);
  };

  const columns: Column<TrainingRecordDto>[] = [
    {
      key: 'employee',
      header: t('training.nomination.employee'),
      render: (r) => (
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {r.employeeName}
          </span>
          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {r.employeeCode}
          </span>
        </div>
      ),
    },
    {
      key: 'course',
      header: t('training.session.course'),
      // The record's OWN copy of the name, not a lookup — that is the whole of D8 on screen.
      render: (r) => <span>{locale === 'ar' ? r.courseNameAr : r.courseNameEn}</span>,
    },
    {
      key: 'completedAt',
      header: t('training.record.completedAt'),
      render: (r) => <span>{formatDate(r.completedAt, locale)}</span>,
    },
    {
      key: 'expiresAt',
      header: t('training.record.expiresAt'),
      render: (r) => <span>{r.expiresAt === null ? '—' : formatDate(r.expiresAt, locale)}</span>,
    },
    {
      key: 'certificate',
      header: t('training.record.certificate'),
      render: (r) =>
        r.certificateFileName === null ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('training.record.noCertificate')}
          </span>
        ) : (
          <span className="truncate text-xs">{r.certificateFileName}</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Can permission="trainingSession.conduct">
          <Button size="sm" variant="secondary" onClick={() => setAttaching(r)}>
            {t(
              r.certificateFileName === null
                ? 'training.record.attachCertificate'
                : 'training.record.replaceCertificate',
            )}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('training.record.title')}
        description={t('training.record.subtitle')}
        breadcrumbs={[{ label: t('training.title') }, { label: t('training.record.title') }]}
      />

      <div className="space-y-4">
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value === '' ? null : value, page: null })}
          placeholder={t('training.record.searchPlaceholder')}
        />
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
        )}
      </div>

      {attaching !== null && (
        <CertificateDialog record={attaching} onClose={() => setAttaching(null)} />
      )}
    </PageContainer>
  );
};
