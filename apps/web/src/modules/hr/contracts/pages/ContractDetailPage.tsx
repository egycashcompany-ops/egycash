// Contract detail (frozen design §4): snapshot viewer (the STORED render, A20), the
// lifecycle actions gated by state × permission, the frozen variable snapshot with
// provenance (A3), approval steps (A7), signature blocks (A5), attachments (A6) and
// the amendment/renewal chain (D9). Generation progress polls live (A13).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CONTRACT_ATTACHMENT_CATEGORIES,
  type ContractDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Textarea,
  toast,
} from '../../../../shared/ui';
import { formatDate, formatDateTime, localized } from '../../../../shared/lib/format';
import { contractDocumentHtml } from '../api/contract-api';
import {
  useContract,
  useContracts,
  useContractTemplate,
  useContractVariables,
  useDecideContractApproval,
  useDeleteContractDraft,
  useGenerateContract,
  useRemoveContractAttachment,
  useRetryContractPdf,
  useSignContractBlock,
  useSubmitContract,
  useUpdateContractDraft,
  useUploadContractAttachment,
} from '../api/contract-queries';
import { ContractStatusBadge } from '../components/ContractStatusBadge';
import { GenerationStatus } from '../components/GenerationStatus';
import { AmendRenewDialog, TerminateDialog } from '../components/ContractActionDialogs';
import { downloadContractPdf, printContract } from '../components/contract-doc-actions';
import { useArchiveContract } from '../api/contract-queries';

const Item = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm">{children}</dd>
  </div>
);

const EditDraftDialog = ({
  contract,
  open,
  onClose,
}: {
  contract: ContractDto;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const update = useUpdateContractDraft();
  const { data: template } = useContractTemplate(contract.templateId);
  const { data: catalog } = useContractVariables();
  const [startDate, setStartDate] = useState(contract.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(contract.endDate === null ? '' : contract.endDate.slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState(contract.referenceNumber ?? '');
  const [overrides, setOverrides] = useState<Record<string, string>>(contract.overrides);

  const labelOf = (key: string): string => {
    const entry = (catalog ?? []).find((v) => v.key === key);
    return entry === undefined ? key : `${entry.label[locale]}${entry.required ? ' *' : ''}`;
  };

  const submit = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        id: contract.id,
        body: {
          startDate,
          endDate: endDate === '' ? null : endDate,
          referenceNumber: referenceNumber.trim() === '' ? null : referenceNumber.trim(),
          overrides,
          version: contract.version,
        },
      });
      toast.success(t('contracts.detail.draftSaved'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('contracts.detail.editDraft')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} loading={update.isPending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t('contracts.fields.startDate')} required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t('contracts.fields.endDate')}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t('contracts.fields.referenceNumber')}>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
          </Field>
        </div>
        {template !== undefined && template.placeholders.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">{t('contracts.create.overrides')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {template.placeholders.map((key) => (
                <Field key={key} label={labelOf(key)}>
                  <Input
                    value={overrides[key] ?? ''}
                    placeholder={t('contracts.create.autoResolved')}
                    onChange={(e) => {
                      const next = { ...overrides };
                      if (e.target.value === '') delete next[key];
                      else next[key] = e.target.value;
                      setOverrides(next);
                    }}
                  />
                </Field>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};

const AttachmentsCard = ({ contract }: { contract: ContractDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const uploadMutation = useUploadContractAttachment();
  const removeMutation = useRemoveContractAttachment();
  const [category, setCategory] = useState('other');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const immutable = contract.status === 'signed' || contract.status === 'archived';

  const doUpload = async (): Promise<void> => {
    if (file === null || label.trim() === '') return;
    try {
      await uploadMutation.mutateAsync({
        id: contract.id,
        fields: { category, label: label.trim(), version: contract.version },
        file,
      });
      toast.success(t('contracts.attachments.added'));
      setLabel('');
      setFile(null);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader title={t('contracts.attachments.title')} />
      <CardBody>
        {contract.attachments.length === 0 ? (
          <p className="text-sm text-slate-400">{t('contracts.attachments.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {contract.attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="me-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                    {t(`contracts.attachments.category.${a.category}`)}
                  </span>
                  {a.label}
                </span>
                {can('contract.terminate') && !immutable && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() =>
                      void removeMutation
                        .mutateAsync({ id: contract.id, attachmentId: a.id, version: contract.version })
                        .then(() => toast.success(t('contracts.attachments.removed')))
                        .catch(() => undefined)
                    }
                  >
                    {t('common.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {can('contract.create') && (
          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-4">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CONTRACT_ATTACHMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`contracts.attachments.category.${c}`)}</option>
              ))}
            </Select>
            <Input
              placeholder={t('contracts.attachments.label')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="secondary"
              disabled={file === null || label.trim() === ''}
              loading={uploadMutation.isPending}
              onClick={() => void doUpload()}
            >
              {t('contracts.attachments.add')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export const ContractDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: c, isLoading, isError, error, refetch } = useContract(id);

  const submit = useSubmitContract();
  const decide = useDecideContractApproval();
  const generate = useGenerateContract();
  const retryPdf = useRetryContractPdf();
  const sign = useSignContractBlock();
  const archive = useArchiveContract();
  const deleteDraft = useDeleteContractDraft();

  const [dialog, setDialog] = useState<'edit' | 'amend' | 'renew' | 'terminate' | 'reject' | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);

  // The amendment chain (D9): all versions sharing the code, via the A12 search surface.
  const { data: chain } = useContracts({ search: c?.code ?? '', pageSize: 50 });
  const chainItems = useMemo(
    () =>
      (chain?.items ?? [])
        .filter((x) => x.code === c?.code)
        .sort((a, b) => a.contractVersion - b.contractVersion),
    [chain, c],
  );

  useEffect(() => {
    setDocumentHtml(null);
  }, [id]);

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || c === undefined) {
    return <PageContainer><ErrorState error={error} onRetry={() => void refetch()} /></PageContainer>;
  }

  const run = (fn: Promise<unknown>, doneKey?: string): void => {
    void fn
      .then(() => {
        if (doneKey !== undefined) toast.success(t(doneKey));
      })
      .catch(() => undefined);
  };

  const actionable = c.status === 'active' || c.status === 'signed';
  const showDocument = (): void => {
    contractDocumentHtml(c.id)
      .then(setDocumentHtml)
      .catch(() => toast.error(t('contracts.actions.printFailed')));
  };

  return (
    <PageContainer wide>
      <PageHeader
        title={c.code}
        description={`${c.employeeName} · v${c.contractVersion}`}
        breadcrumbs={[{ label: t('contracts.module.title'), to: '/contracts' }, { label: c.code }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GenerationStatus generation={c.generation} />
            <ContractStatusBadge status={c.status} />
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {c.status === 'draft' && can('contract.create') && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>
              {t('contracts.detail.editDraft')}
            </Button>
            {c.approval?.required === true && (
              <Button
                size="sm"
                loading={submit.isPending}
                onClick={() => run(submit.mutateAsync({ id: c.id, version: c.version }), 'contracts.detail.submitted')}
              >
                {t('contracts.detail.submit')}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              loading={deleteDraft.isPending}
              onClick={() =>
                void deleteDraft.mutateAsync(c.id).then(() => {
                  toast.success(t('contracts.detail.deleted'));
                  navigate('/contracts');
                }).catch(() => undefined)
              }
            >
              {t('common.delete')}
            </Button>
          </>
        )}
        {(c.status === 'approved' || (c.status === 'draft' && c.approval?.required !== true)) &&
          can('contract.generate') && (
            <Button
              size="sm"
              loading={generate.isPending}
              onClick={() => run(generate.mutateAsync({ id: c.id, version: c.version }), 'contracts.detail.generateQueued')}
            >
              {t('contracts.detail.generate')}
            </Button>
          )}
        {c.status === 'pendingApproval' && can('contract.approve') && (
          <>
            <Button
              size="sm"
              loading={decide.isPending}
              onClick={() =>
                run(
                  decide.mutateAsync({ id: c.id, body: { decision: 'approved', version: c.version } }),
                  'contracts.detail.approved',
                )
              }
            >
              {t('common.approve')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDialog('reject')}>
              {t('common.reject')}
            </Button>
          </>
        )}
        {c.generation.status === 'failed' && can('contract.generate') && (
          <Button
            size="sm"
            variant="secondary"
            loading={retryPdf.isPending}
            onClick={() => run(retryPdf.mutateAsync({ id: c.id, version: c.version }), 'contracts.detail.retryQueued')}
          >
            {t('contracts.detail.retryPdf')}
          </Button>
        )}
        {c.hasSnapshot && can('contract.print') && (
          <>
            <Button size="sm" variant="secondary" onClick={showDocument}>
              {t('contracts.detail.viewDocument')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void printContract(c.id).catch(() => toast.error(t('contracts.actions.printFailed')))}
            >
              {t('contracts.actions.print')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void downloadContractPdf(c.id)
                  .then((ready) => { if (!ready) toast.info(t('contracts.actions.pdfNotReady')); })
                  .catch(() => toast.error(t('contracts.actions.pdfFailed')))
              }
            >
              {t('contracts.actions.pdf')}
            </Button>
          </>
        )}
        {actionable && can('contract.amend') && (
          <Button size="sm" variant="secondary" onClick={() => setDialog('amend')}>{t('contracts.actions.amend')}</Button>
        )}
        {actionable && can('contract.renew') && (
          <Button size="sm" variant="secondary" onClick={() => setDialog('renew')}>{t('contracts.actions.renew')}</Button>
        )}
        {actionable && can('contract.terminate') && (
          <Button size="sm" variant="danger" onClick={() => setDialog('terminate')}>
            {t('contracts.actions.terminate')}
          </Button>
        )}
        {['amended', 'renewed', 'terminated', 'expired'].includes(c.status) && can('contract.terminate') && (
          <Button
            size="sm"
            variant="secondary"
            loading={archive.isPending}
            onClick={() => run(archive.mutateAsync({ id: c.id, version: c.version }), 'contracts.detail.archived')}
          >
            {t('contracts.detail.archive')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title={t('contracts.detail.summary')} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Item label={t('contracts.columns.employee')}>
                  <Link to={`/employees/${c.employeeId}?tab=contracts`} className="text-brand-700 hover:underline dark:text-brand-300">
                    {c.employeeName}
                  </Link>
                </Item>
                <Item label={t('contracts.columns.type')}>{localized(c.typeName, locale)}</Item>
                <Item label={t('contracts.fields.referenceNumber')}>{c.referenceNumber ?? '—'}</Item>
                <Item label={t('contracts.fields.startDate')}>{formatDate(c.startDate, locale)}</Item>
                <Item label={t('contracts.fields.endDate')}>
                  {c.endDate === null ? t('contracts.detail.openEnded') : formatDate(c.endDate, locale)}
                </Item>
                <Item label={t('contracts.detail.templateVersion')}>
                  {c.pinnedTemplateVersion === null
                    ? t('contracts.detail.notPinned')
                    : `v${c.pinnedTemplateVersion} (${c.templateLanguage === 'ar' ? t('contracts.language.ar') : t('contracts.language.en')})`}
                </Item>
                {c.terminationReason !== null && (
                  <Item label={t('contracts.actions.terminateReason')}>{c.terminationReason}</Item>
                )}
                {c.generation.integrity !== null && (
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-xs text-slate-400">{t('contracts.detail.integrity')}</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-slate-500" dir="ltr">
                      SHA-256 {c.generation.integrity.sha256} · {c.generation.integrity.generatorVersion} ·{' '}
                      {formatDateTime(c.generation.integrity.generatedAt, locale)}
                    </dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>

          {documentHtml !== null && (
            <Card>
              <CardHeader title={t('contracts.detail.document')} description={t('contracts.detail.documentHint')} />
              <CardBody>
                <iframe
                  title={t('contracts.detail.document')}
                  sandbox=""
                  srcDoc={documentHtml}
                  className="h-[75vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
                />
              </CardBody>
            </Card>
          )}

          {c.variables.length > 0 && (
            <Card>
              <CardHeader title={t('contracts.detail.variables')} description={t('contracts.detail.variablesHint')} />
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-start text-xs text-slate-400 dark:border-slate-700">
                        <th className="py-1.5 text-start">{t('contracts.detail.variableKey')}</th>
                        <th className="py-1.5 text-start">{t('contracts.detail.variableValue')}</th>
                        <th className="py-1.5 text-start">{t('contracts.detail.variableSource')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {c.variables.map((v) => (
                        <tr key={v.key}>
                          <td className="py-1.5 font-mono text-xs" dir="ltr">{v.key}</td>
                          <td className="py-1.5">{v.value === '' ? '—' : v.value}</td>
                          <td className="py-1.5 text-xs text-slate-500">{t(`contracts.source.${v.source}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          <AttachmentsCard contract={c} />
        </div>

        <div className="space-y-4">
          {c.approval !== null && (
            <Card>
              <CardHeader title={t('contracts.detail.approval')} />
              <CardBody>
                {c.approval.steps.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {c.status === 'pendingApproval'
                      ? t('contracts.detail.approvalPending')
                      : t('contracts.detail.approvalNone')}
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {c.approval.steps.map((s) => (
                      <li key={`${s.step}-${s.at}`} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <span className="font-medium">
                          {s.decision === 'approved' ? t('common.approve') : t('common.reject')}
                        </span>
                        <span className="ms-2 text-xs text-slate-400">{formatDateTime(s.at, locale)}</span>
                        {s.note !== null && <p className="mt-1 text-xs text-slate-500">{s.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}

          {c.signers.length > 0 && (
            <Card>
              <CardHeader title={t('contracts.detail.signers')} />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {c.signers.map((s) => (
                    <li key={s.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <span>
                        {s.label}
                        {s.signedAt !== null && (
                          <span className="ms-2 text-xs text-slate-400">{formatDateTime(s.signedAt, locale)}</span>
                        )}
                      </span>
                      {s.status === 'signed' ? (
                        <span className="text-xs font-medium text-emerald-600">{t('contracts.detail.signed')}</span>
                      ) : c.status === 'active' && can('contract.generate') ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={sign.isPending}
                          onClick={() =>
                            run(
                              sign.mutateAsync({ id: c.id, body: { key: s.key, version: c.version } }),
                              'contracts.detail.signRecorded',
                            )
                          }
                        >
                          {t('contracts.detail.recordSignature')}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">{t('contracts.detail.pendingSignature')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={t('contracts.detail.chain')} />
            <CardBody>
              {chainItems.length <= 1 && c.parentContractId === null ? (
                <EmptyState title={t('contracts.detail.chainEmpty')} />
              ) : (
                <ul className="space-y-1 text-sm">
                  {c.parentContractId !== null && (
                    <li>
                      <Link to={`/contracts/${c.parentContractId}`} className="text-brand-700 hover:underline dark:text-brand-300">
                        {t('contracts.detail.parentContract')}
                      </Link>
                    </li>
                  )}
                  {chainItems.map((x) => (
                    <li key={x.id} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      {x.id === c.id ? (
                        <span className="font-medium">v{x.contractVersion} — {t('contracts.detail.thisVersion')}</span>
                      ) : (
                        <Link to={`/contracts/${x.id}`} className="text-brand-700 hover:underline dark:text-brand-300">
                          v{x.contractVersion}
                        </Link>
                      )}
                      <ContractStatusBadge status={x.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <EditDraftDialog contract={c} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <AmendRenewDialog contract={c} mode="amend" open={dialog === 'amend'} onClose={() => setDialog(null)} />
      <AmendRenewDialog contract={c} mode="renew" open={dialog === 'renew'} onClose={() => setDialog(null)} />
      <TerminateDialog contract={c} open={dialog === 'terminate'} onClose={() => setDialog(null)} />
      <Dialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('contracts.detail.rejectTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={decide.isPending}
              onClick={() =>
                void decide
                  .mutateAsync({
                    id: c.id,
                    body: {
                      decision: 'rejected',
                      ...(rejectNote.trim() === '' ? {} : { note: rejectNote.trim() }),
                      version: c.version,
                    },
                  })
                  .then(() => {
                    toast.success(t('contracts.detail.rejected'));
                    setDialog(null);
                  })
                  .catch(() => undefined)
              }
            >
              {t('common.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('contracts.detail.rejectNote')}>
          <Textarea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </Field>
      </Dialog>
    </PageContainer>
  );
};
