// One batch, end to end (RW8/RW8b/RW8c): its identity and dates, the generated package, the
// returned result documents, and the member list with per-item and bulk decisions.
//
// The page mirrors the server's rules rather than re-deriving them: membership is only editable
// while the batch is a draft, an issued batch's items are decided or voided (never removed), and
// closing waits until nothing is pending.
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  citiesOfGovernorate,
  DRIVING_TEST_GRADES,
  EGYPT_GOVERNORATES,
  isQuadrupleName,
  type BatchItemDto,
  type DrivingTestGrade,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Can } from '../../../../../platform/rbac/Can';
import { Combobox } from '../../../../../shared/ui/Combobox';

/** The governorates as the applicant form offers them. */
const GOVERNORATE_NAMES = EGYPT_GOVERNORATES.map((g) => g.ar);

/** The catalog list, plus a place HR typed that the catalog does not hold, so it stays shown. */
const withTyped = (options: readonly string[], value: string): string[] =>
  value.trim() === '' || options.includes(value) ? [...options] : [value, ...options];
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { EditIcon } from '../../../../../shared/ui/icons';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDate, formatDateTime, localized } from '../../../../../shared/lib/format';
import { fileDownloadTicket } from '../../applicants/api/applicant-api';
import { IdCardHoverIcon } from '../../applicants/components/IdCardHoverIcon';
import { BatchItemBadge, BatchPackageBadge, BatchStatusBadge } from '../components/BatchStatusBadge';
import {
  useBulkBatchItems,
  useCancelEvaluationBatch,
  useCloseEvaluationBatch,
  useDecideBatchItem,
  useEvaluationBatch,
  useIssueEvaluationBatch,
  useRemoveBatchItem,
  useRetryBatchPackage,
  useSetBatchItemAddress,
  useSetBatchItemMotherName,
  useUploadBatchResult,
} from '../api/evaluation-batch-queries';

type ReasonAction = 'reject' | 'void' | 'cancel';

export const EvaluationBatchDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: batch, isLoading, isError, error, refetch } = useEvaluationBatch(id);

  const issue = useIssueEvaluationBatch(id);
  const retry = useRetryBatchPackage(id);
  const uploadResult = useUploadBatchResult(id);
  const removeItem = useRemoveBatchItem(id);
  const close = useCloseEvaluationBatch(id);
  const cancel = useCancelEvaluationBatch(id);
  const fileInput = useRef<HTMLInputElement>(null);

  const [reasonFor, setReasonFor] = useState<{ action: ReasonAction; applicantId?: string } | null>(null);
  // A GRADE ARRIVES WITH A DECISION, never on its own: the examiner's mark and the approval are
  // one act. Only the driving test has a scale, so only that phase is asked for one.
  const isDrivingTest = batch?.phaseKey === 'drivingTest';
  // ISSUING IS THE LAST CHEAP MOMENT TO FIX A NAME. Every one of these forms is filled in with the
  // quadruple name, and a sheet that leaves with two parts comes back refused — after the batch
  // has frozen its membership and the paper is on somebody else's desk. Advisory, never blocking:
  // a three-part name is somebody's real name, and this screen is not the place to adjudicate it.
  const shortNames = (batch?.items ?? [])
    .filter((i) => i.result !== 'voided' && !isQuadrupleName(i.applicantName))
    .map((i) => i.applicantName || i.applicantCode);
  const [gradeFor, setGradeFor] = useState<string | null>(null);
  const [grade, setGrade] = useState<DrivingTestGrade>('good');
  const decideItem = useDecideBatchItem(id);
  const [reason, setReason] = useState('');
  // The security-check form asks for the mother's name. The item starts with the applicant's own
  // value; HR types it here when there is none, or corrects it for this form only.
  const isSecurityCheck = batch?.phaseKey === 'securityCheck';
  const saveMotherName = useSetBatchItemMotherName(id);
  const [motherNameFor, setMotherNameFor] = useState<BatchItemDto | null>(null);
  const [motherName, setMotherName] = useState('');
  // «بيانات ناقصة» — the address is filled from here too, onto the applicant file.
  const saveAddress = useSetBatchItemAddress(id);
  const [addressFor, setAddressFor] = useState<BatchItemDto | null>(null);
  const [address, setAddress] = useState({ line1: '', city: '', governorate: '' });

  const items = useMemo(() => batch?.items ?? [], [batch]);
  const rowIds = useMemo(() => items.filter((i) => i.result !== 'voided').map((i) => i.applicantId), [items]);
  const selection = useTableSelection(rowIds);
  const bulk = useBulkBatchItems(id, () => {
    selection.clear();
    setReasonFor(null);
    setReason('');
  });

  if (isLoading) return <LoadingState />;
  if (isError || batch === undefined) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const isDraft = batch.status === 'draft';
  const isIssued = batch.status === 'issued';
  const terminal = batch.status === 'closed' || batch.status === 'cancelled';

  const openFile = async (fileId: string): Promise<void> => {
    try {
      const ticket = await fileDownloadTicket(fileId);
      window.open(ticket.url, '_blank', 'noopener');
    } catch {
      toast.error(t('batches.package.downloadFailed'));
    }
  };

  const onPickResult = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      await uploadResult.mutateAsync({ file, version: batch.version });
      toast.success(t('batches.results.uploaded'));
    } catch {
      // surfaced globally
    } finally {
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const submitReason = async (): Promise<void> => {
    const pending = reasonFor;
    if (pending === null || reason.trim() === '') return;
    try {
      if (pending.action === 'cancel') {
        await cancel.mutateAsync({ reason: reason.trim(), version: batch.version });
        toast.success(t('batches.cancelled'));
      } else if (pending.applicantId !== undefined) {
        await bulk.mutateAsync({
          action: pending.action,
          ids: [pending.applicantId],
          reason: reason.trim(),
        });
      } else {
        await bulk.mutateAsync({ action: pending.action, ids: selection.ids, reason: reason.trim() });
      }
      setReasonFor(null);
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  const openMotherName = (item: BatchItemDto): void => {
    setMotherNameFor(item);
    setMotherName(item.motherName ?? '');
  };

  const submitMotherName = async (): Promise<void> => {
    const target = motherNameFor;
    const value = motherName.trim();
    if (target === null || value.length < 2) return;
    try {
      await saveMotherName.mutateAsync({
        applicantId: target.applicantId,
        body: { motherName: value, version: batch.version },
      });
      // An issued batch already has its list printed; the server queues it to be built again.
      toast.success(t(isIssued ? 'batches.motherName.savedRebuilding' : 'batches.motherName.saved'));
      setMotherNameFor(null);
    } catch {
      // surfaced globally
    }
  };

  /**
   * Members whose form would print with a blank the receiving body needs: no address, and — on
   * the security check — no mother's name. Shown above the list so HR fixes them before printing.
   */
  const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
  const incomplete = isSecurityCheck
    ? items
        .filter((i) => i.result !== 'voided')
        .map((i) => ({ item: i, noAddress: blank(i.address), noMother: blank(i.motherName) }))
        .filter((r) => r.noAddress || r.noMother)
    : [];

  const openAddress = (item: BatchItemDto): void => {
    setAddressFor(item);
    setAddress({ line1: '', city: '', governorate: '' });
  };
  const addressReady =
    address.line1.trim() !== '' && address.city.trim() !== '' && address.governorate.trim() !== '';
  const submitAddress = async (): Promise<void> => {
    const target = addressFor;
    if (target === null || !addressReady) return;
    try {
      await saveAddress.mutateAsync({
        applicantId: target.applicantId,
        body: {
          address: { line1: address.line1.trim(), city: address.city.trim(), governorate: address.governorate.trim() },
          version: batch.version,
        },
      });
      toast.success(t('batches.incomplete.addressSaved'));
      setAddressFor(null);
    } catch {
      // surfaced globally
    }
  };

  const columns: Column<BatchItemDto>[] = [
    {
      key: 'applicant',
      header: t('batches.columns.applicant'),
      render: (i) => (
        <Link to={`/applicants/${i.applicantId}`} className="hover:underline">
          {i.applicantName}
        </Link>
      ),
    },
    {
      key: 'nationalId',
      header: t('batches.columns.nationalId'),
      render: (i) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-xs" dir="ltr">
            {i.nationalIdMasked ?? '—'}
          </span>
          <IdCardHoverIcon applicantId={i.applicantId} name={i.applicantName || i.applicantCode} />
        </span>
      ),
    },
    ...(isSecurityCheck
      ? [
          {
            key: 'motherName',
            header: t('batches.columns.motherName'),
            render: (i: BatchItemDto) => (
              <div className="flex items-center gap-1">
                {i.motherName === null || i.motherName.trim() === '' ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {t('batches.motherName.missing')}
                  </span>
                ) : (
                  <span>{i.motherName}</span>
                )}
                {!terminal && i.result !== 'voided' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t('batches.motherName.edit')} — ${i.applicantName || i.applicantCode}`}
                    title={t('batches.motherName.edit')}
                    onClick={() => openMotherName(i)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
    { key: 'position', header: t('batches.columns.position'), render: (i) => i.placementLabel.position ?? '—' },
    { key: 'result', header: t('batches.columns.result'), render: (i) => <BatchItemBadge result={i.result} /> },
    ...(isDrivingTest
      ? [
          {
            key: 'grade',
            header: t('batches.columns.grade'),
            render: (i: BatchItemDto) => (i.grade === null ? '—' : t(`batches.grade.${i.grade}`)),
          },
        ]
      : []),
    { key: 'reason', header: t('batches.columns.reason'), render: (i) => i.reason ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (i) => (
        <div className="flex justify-end gap-1">
          {isDraft && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void removeItem.mutateAsync({ applicantId: i.applicantId, version: batch.version })}
            >
              {t('batches.actions.remove')}
            </Button>
          )}
          {isIssued && i.result !== 'voided' && (
            <>
              <Button
                size="sm"
                onClick={() =>
                  isDrivingTest
                    ? setGradeFor(i.applicantId)
                    : void bulk.mutateAsync({ action: 'approve', ids: [i.applicantId] })
                }
              >
                {t('batches.actions.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setReasonFor({ action: 'reject', applicantId: i.applicantId })}
              >
                {t('batches.actions.reject')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReasonFor({ action: 'void', applicantId: i.applicantId })}
              >
                {t('batches.actions.void')}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={batch.code}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          {
            // Back to the phase this batch belongs to, never to the mixed list: the crumb should
            // return somebody to the queue they came from.
            label: localized(batch.phaseName, locale),
            to: `/evaluation-batches/phase/${batch.phaseKey}`,
          },
          { label: batch.code },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <Button
                loading={issue.isPending}
                disabled={batch.counts.total === 0}
                onClick={() => void issue.mutateAsync({ version: batch.version })}
              >
                {t('batches.actions.issue')}
              </Button>
            )}
            {isIssued && (
              <Button
                loading={close.isPending}
                disabled={batch.counts.pending > 0}
                onClick={() => void close.mutateAsync({ version: batch.version })}
              >
                {t('batches.actions.close')}
              </Button>
            )}
            {!terminal && (
              <Button variant="danger" onClick={() => setReasonFor({ action: 'cancel' })}>
                {t('batches.actions.cancel')}
              </Button>
            )}
          </div>
        }
      />

      {isDraft && shortNames.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('batches.shortNames.warning')}
          <span className="font-medium"> {shortNames.join('، ')}</span>
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader title={t('batches.summary.title')} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">{t('batches.columns.status')}</dt>
                <dd className="mt-1">
                  <BatchStatusBadge status={batch.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('batches.fields.scheduledFor')}</dt>
                <dd className="mt-1">
                  {batch.scheduledFor === null ? '—' : formatDate(batch.scheduledFor, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('batches.columns.sentAt')}</dt>
                <dd className="mt-1">{batch.sentAt === null ? '—' : formatDate(batch.sentAt, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t('batches.columns.returnedAt')}</dt>
                <dd className="mt-1">
                  {batch.returnedAt === null ? '—' : formatDate(batch.returnedAt, locale)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              {t('batches.summary.counts', {
                total: batch.counts.total,
                pending: batch.counts.pending,
                approved: batch.counts.approved,
                rejected: batch.counts.rejected,
                voided: batch.counts.voided,
              })}
            </p>
            {batch.cancelledReason !== null && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{batch.cancelledReason}</p>
            )}
          </CardBody>
        </Card>

        {!isDraft && (
          <Card>
            <CardHeader
              title={t('batches.package.title')}
              actions={
                // «تحديث الكشف» — after editing a name, a mother's name or a card number, build the
                // list again with the data as it is now. Always offered on a live batch; it is also
                // the retry after a failure.
                batch.status === 'cancelled' ? undefined : (
                  <Button
                    size="sm"
                    variant={batch.package.status === 'failed' ? 'primary' : 'secondary'}
                    loading={retry.isPending || batch.package.status === 'queued' || batch.package.status === 'building'}
                    onClick={() =>
                      void retry.mutateAsync().then(() => toast.success(t('batches.package.refreshing')))
                    }
                  >
                    {t(batch.package.status === 'failed' ? 'batches.package.retry' : 'batches.package.refresh')}
                  </Button>
                )
              }
            />
            <CardBody>
              <div className="flex flex-wrap items-center gap-3">
                <BatchPackageBadge status={batch.package.status} />
                {batch.package.listPdfFileId !== null && (
                  <Button size="sm" variant="secondary" onClick={() => void openFile(batch.package.listPdfFileId as string)}>
                    {t('batches.package.list')}
                  </Button>
                )}
                {batch.package.archiveFileId !== null && (
                  <Button size="sm" variant="secondary" onClick={() => void openFile(batch.package.archiveFileId as string)}>
                    {t('batches.package.archive')}
                  </Button>
                )}
                <span className="text-xs text-slate-500">
                  {t('batches.package.attachments', { n: batch.package.attachmentCount })}
                </span>
              </div>
              {batch.package.error !== null && (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{batch.package.error}</p>
              )}
            </CardBody>
          </Card>
        )}

        {!isDraft && (
          <Card>
            <CardHeader
              title={t('batches.results.title')}
              actions={
                terminal ? undefined : (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      className="hidden"
                      onChange={(e) => void onPickResult(e.target.files?.[0])}
                    />
                    <Button size="sm" loading={uploadResult.isPending} onClick={() => fileInput.current?.click()}>
                      {t('batches.results.upload')}
                    </Button>
                  </>
                )
              }
            />
            <CardBody>
              {batch.returnedDocuments.length === 0 ? (
                <p className="text-sm text-slate-500">{t('batches.results.empty')}</p>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {batch.returnedDocuments.map((d) => (
                    <li key={d.fileId} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <button type="button" className="text-sm hover:underline" onClick={() => void openFile(d.fileId)}>
                          {d.fileName}
                        </button>
                        <p className="text-xs text-slate-500">{formatDateTime(d.uploadedAt, locale)}</p>
                      </div>
                      {d.note !== null && <span className="text-xs text-slate-500">{d.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}

        {incomplete.length > 0 && !terminal && (
          <Card>
            <CardHeader
              title={t('batches.incomplete.title', { n: incomplete.length })}
              description={t(isDraft ? 'batches.incomplete.hintDraft' : 'batches.incomplete.hintIssued')}
            />
            <CardBody>
              <ul className="divide-y divide-amber-200/60 rounded-xl border border-amber-300 bg-amber-50/60 dark:divide-amber-900 dark:border-amber-800 dark:bg-amber-950/30">
                {incomplete.map(({ item, noAddress, noMother }) => (
                  <li key={item.applicantId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <Link to={`/applicants/${item.applicantId}`} className="font-medium hover:underline">
                      {item.applicantName || item.applicantCode}
                    </Link>
                    {noAddress && (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                        {t('batches.incomplete.noAddress')}
                      </span>
                    )}
                    {noMother && (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                        {t('batches.incomplete.noMother')}
                      </span>
                    )}
                    <span className="ms-auto flex gap-1">
                      {noAddress && (
                        <Can permission="applicant.edit">
                          <Button size="sm" variant="secondary" onClick={() => openAddress(item)}>
                            <EditIcon className="h-4 w-4" />
                            {t('batches.incomplete.editAddress')}
                          </Button>
                        </Can>
                      )}
                      {noMother && (
                        <Button size="sm" variant="secondary" onClick={() => openMotherName(item)}>
                          <EditIcon className="h-4 w-4" />
                          {t('batches.motherName.edit')}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        {isIssued && (
          <BulkActionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              loading={bulk.isPending}
              disabled={selection.count === 0}
              onClick={() => void bulk.mutateAsync({ action: 'approve', ids: selection.ids })}
            >
              {t('batches.actions.approveSelected')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={selection.count === 0}
              onClick={() => setReasonFor({ action: 'reject' })}
            >
              {t('batches.actions.rejectSelected')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selection.count === 0}
              onClick={() => setReasonFor({ action: 'void' })}
            >
              {t('batches.actions.voidSelected')}
            </Button>
          </BulkActionBar>
        )}

        <DataTable
          {...(isIssued ? { selection } : {})}
          columns={columns}
          rows={items}
          rowKey={(i) => i.applicantId}
          empty={t('batches.items.empty')}
        />
      </div>

      <Dialog
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={t(`batches.actions.${reasonFor?.action ?? 'reject'}`)}
        description={t('bulk.reason.required')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReasonFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={bulk.isPending || cancel.isPending}
              disabled={reason.trim() === ''}
              onClick={() => void submitReason()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <Field label={t('bulk.reason.title')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={addressFor !== null}
        onClose={() => setAddressFor(null)}
        title={t('batches.incomplete.editAddress')}
        description={t('batches.incomplete.addressHint', {
          name: addressFor?.applicantName || addressFor?.applicantCode || '',
        })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddressFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saveAddress.isPending} disabled={!addressReady} onClick={() => void submitAddress()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('batches.incomplete.line1')} required>
            <Input
              value={address.line1}
              maxLength={500}
              onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
            />
          </Field>
          {/* The same pickers as the applicant form: governorate first, then its cities. Typing
              filters to the matching names; a place not on the list is added with «+ إضافة». */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('batches.incomplete.governorate')} required>
              <Combobox
                id="batch-address-governorate"
                value={address.governorate}
                options={withTyped(GOVERNORATE_NAMES, address.governorate)}
                onChange={(governorate) =>
                  setAddress((a) => (governorate === a.governorate ? a : { ...a, governorate, city: '' }))
                }
                onCreate={(typed) => setAddress((a) => ({ ...a, governorate: typed.trim(), city: '' }))}
                createLabel={(typed) => t('batches.incomplete.addPlace', { name: typed })}
                placeholder={t('applicants.form.selectGovernorate')}
                emptyText={t('common.noResults')}
                clearLabel={t('common.clear')}
              />
            </Field>
            <Field
              label={t('batches.incomplete.city')}
              required
              hint={address.governorate === '' ? t('applicants.form.cityNeedsGovernorate') : undefined}
            >
              <Combobox
                id="batch-address-city"
                value={address.city}
                options={withTyped(citiesOfGovernorate(address.governorate), address.city)}
                onChange={(city) => setAddress((a) => ({ ...a, city }))}
                onCreate={(typed) => setAddress((a) => ({ ...a, city: typed.trim() }))}
                createLabel={(typed) => t('batches.incomplete.addPlace', { name: typed })}
                disabled={address.governorate === ''}
                placeholder={t('applicants.form.selectCity')}
                emptyText={t('common.noResults')}
                clearLabel={t('common.clear')}
              />
            </Field>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={motherNameFor !== null}
        onClose={() => setMotherNameFor(null)}
        title={t('batches.motherName.edit')}
        description={t(isIssued ? 'batches.motherName.hintIssued' : 'batches.motherName.hint', {
          name: motherNameFor?.applicantName || motherNameFor?.applicantCode || '',
        })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMotherNameFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={saveMotherName.isPending}
              disabled={motherName.trim().length < 2}
              onClick={() => void submitMotherName()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('batches.columns.motherName')}>
          <Input value={motherName} maxLength={200} onChange={(e) => setMotherName(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={gradeFor !== null}
        onClose={() => setGradeFor(null)}
        title={t('batches.actions.approve')}
        description={t('batches.grade.prompt')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGradeFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={decideItem.isPending}
              onClick={() => {
                const applicantId = gradeFor;
                if (applicantId === null || batch === undefined) return;
                void decideItem
                  .mutateAsync({
                    applicantId,
                    body: { result: 'approved', grade, version: batch.version },
                  })
                  .then(() => setGradeFor(null));
              }}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <Field label={t('batches.columns.grade')}>
          <Select value={grade} onChange={(e) => setGrade(e.target.value as DrivingTestGrade)}>
            {DRIVING_TEST_GRADES.map((g) => (
              <option key={g} value={g}>
                {t(`batches.grade.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
    </PageContainer>
  );
};
