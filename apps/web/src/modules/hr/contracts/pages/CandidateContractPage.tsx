// «عقد جديد» for a CANDIDATE (A28) — reached from «جاهزون للتعيين» by «طباعة العقد والمستندات».
//
// «اول مندخل عل عقد جديد … فيها الform و شكل العقد اللي هيطلع للشخص علي حسب وظيفتو و اسمو … toggle
// buttoms للنمازج … و بعد ميختار هيبقا فيه 2 زرار بقا ف اخر الصفحه واحد للطباعه … و زرار جمبو علطول
// اللي هو التعيين … الزرار ميبقاش active الا لما يطبع اول».
//
//   · THE FORM is the contract's term and the hiring date, from the offer; the contract's shape is
//     beside it, as it will print for this person.
//   · THE PAPERS are the job's, grouped — the contract, every job's forms, this job's — each a tile
//     to tick, with «تعديل» (this candidate's values) and «طباعة» (that paper alone).
//   · «طباعة المحدد» prints the ticked papers; «تعيين» stays off until something was printed, then
//     hires the candidate and records the contract.
//   · Every change is saved to the server as it is made — a closed tab or an expired session loses
//     nothing («يتعملو ريكورد»).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  type CandidateDraftDto,
  type CandidatePaperDto,
  type CandidatePaperGroup,
  type Locale,
  type UpdateCandidateDraft,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can, useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, CardHeader, toast } from '../../../../shared/ui';
import { Field, Input } from '../../../../shared/ui/form';
import { formatDateTime, localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import { useOpenHiringDocs } from '../../recruitment/hiring-documents/api/hiring-documents-queries';
import {
  useCandidateDraft,
  useHireCandidate,
  useRenderCandidate,
  useUpdateCandidate,
} from '../api/contract-queries';
import { PaperTile } from '../components/PaperTile';
import { EditPaperValuesDialog } from '../components/EditPaperValuesDialog';

const GROUPS: CandidatePaperGroup[] = ['contract', 'everyJob', 'thisJob'];

/** One year from an ISO start, the day before its anniversary — as the server makes it. */
export const oneYearFromIso = (start: string): string => {
  const [y, m, d] = start.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return start;
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
};

export const CandidateContractPage = ({ offerId }: { offerId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const client = useQueryClient();
  const can = useCan();
  const queryKey = ['hr', 'contracts', 'candidate', offerId];
  const { data: draft, isLoading, isError } = useCandidateDraft(offerId);
  const update = useUpdateCandidate(offerId);
  const render = useRenderCandidate(offerId);
  const hire = useHireCandidate(offerId);
  const openDocs = useOpenHiringDocs();
  const [preview, setPreview] = useState('');
  const [editing, setEditing] = useState<CandidatePaperDto | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const chain = useRef<Promise<void>>(Promise.resolve());

  /**
   * Save one change. Changes are queued — each one carries the version the previous one returned,
   * so quick ticks never race each other into a conflict.
   */
  const save = (change: Omit<UpdateCandidateDraft, 'version'>, optimistic?: (d: CandidateDraftDto) => CandidateDraftDto): Promise<void> => {
    if (optimistic !== undefined) {
      client.setQueryData<CandidateDraftDto>(queryKey, (d) => (d === undefined ? d : optimistic(d)));
    }
    chain.current = chain.current.then(async () => {
      const current = client.getQueryData<CandidateDraftDto>(queryKey);
      if (current === undefined) return;
      setSaveState('saving');
      try {
        await update.mutateAsync({ ...change, version: current.version });
        setSaveState('saved');
      } catch {
        setSaveState('error');
        await client.invalidateQueries({ queryKey });
      }
    });
    return chain.current;
  };

  // The contract's shape, re-drawn whenever what it prints changed.
  const contractKey = draft?.papers.find((p) => p.group === 'contract')?.key ?? null;
  const shapeOf = draft === undefined ? '' : `${draft.version}:${draft.startDate}:${draft.endDate ?? ''}:${draft.hiringDate}`;
  useEffect(() => {
    if (contractKey === null || draft === undefined) return;
    const id = window.setTimeout(() => {
      render
        .mutateAsync({ keys: [contractKey], print: false })
        .then((out) => setPreview(out.html))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(id);
  }, [contractKey, shapeOf]);

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title={t('contracts.create.title')} />
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </PageContainer>
    );
  }
  if (isError || draft === undefined) {
    return (
      <PageContainer>
        <PageHeader title={t('contracts.create.title')} />
        <p className="text-sm text-red-600">{t('contracts.candidate.loadFailed')}</p>
      </PageContainer>
    );
  }

  const selected = draft.papers.filter((p) => p.selected);
  const hired = draft.employeeId !== null;
  const printed = draft.printedAt !== null;

  const setSelected = (keys: string[]): void => {
    const wanted = new Set(keys);
    void save({ selected: keys }, (d) => ({
      ...d,
      papers: d.papers.map((p) => ({ ...p, selected: wanted.has(p.key) })),
    }));
  };
  const toggle = (key: string, on: boolean): void =>
    setSelected(draft.papers.filter((p) => (p.key === key ? on : p.selected)).map((p) => p.key));

  const print = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      await chain.current; // what was just changed prints as changed
      const out = await render.mutateAsync({ keys, print: true });
      writePrintWindow(win, out.html);
    } catch {
      win.close(); // the error itself is surfaced globally
    }
  };

  const doHire = async (): Promise<void> => {
    try {
      await chain.current;
      const current = client.getQueryData<CandidateDraftDto>(queryKey) ?? draft;
      const done = await hire.mutateAsync(current.version);
      toast.success(t('contracts.candidate.hired', { code: done.employeeCode }));
      if (done.contractNote !== null) toast.warning(t(`hiringPack.note.${done.contractNote}`));
      // The signed papers are uploaded next, on the employee's «مستندات التعيين».
      if (can('hiringDocuments.create')) {
        const docs = await openDocs.mutateAsync(done.employeeId).catch(() => null);
        if (docs !== null) {
          navigate(`/hiring-documents/${docs.id}?hired=1`);
          return;
        }
      }
      navigate(`/employees/${done.employeeId}`);
    } catch {
      // surfaced globally
    }
  };

  const saveValues = async (changed: { key: string; value: string }[]): Promise<void> => {
    const kept = new Map(draft.values.filter((v) => v.overridden).map((v) => [v.key, v.value]));
    for (const c of changed) kept.set(c.key, c.value);
    await save({ overrides: [...kept].map(([key, value]) => ({ key, value })) });
    setEditing(null);
  };

  const groupTitle: Record<CandidatePaperGroup, string> = {
    contract: t('contracts.candidate.groups.contract'),
    everyJob: t('contracts.candidate.groups.everyJob'),
    thisJob: t('contracts.candidate.groups.thisJob'),
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.create.title')}
        breadcrumbs={[
          { label: t('employees.ready.title'), to: '/employees/ready' },
          { label: t('contracts.create.title') },
        ]}
      />
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('contracts.candidate.subtitle')}</p>

      {hired && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {t('contracts.candidate.alreadyHired')}{' '}
          <button type="button" className="font-medium underline" onClick={() => navigate(`/employees/${draft.employeeId ?? ''}`)}>
            {t('contracts.candidate.openEmployee')}
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('contracts.candidate.details')} />
            <CardBody>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">{t('contracts.candidate.name')}</dt>
                  <dd className="font-medium">{draft.applicantName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('contracts.candidate.job')}</dt>
                  <dd className="font-medium">{draft.jobTitle === null ? '—' : localized(draft.jobTitle, locale)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('contracts.candidate.offer')}</dt>
                  <dd className="font-mono text-xs" dir="ltr">{draft.offerCode ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('contracts.candidate.employeeCode')}</dt>
                  <dd className="font-mono text-xs" dir="ltr">{draft.employeeCode ?? t('contracts.candidate.codeAtPrint')}</dd>
                </div>
              </dl>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('contracts.fields.startDate')} required>
                  <Input
                    type="date"
                    value={draft.startDate}
                    disabled={hired}
                    onChange={(e) => {
                      const startDate = e.target.value;
                      if (startDate === '') return;
                      const endDate = draft.allowsEndDate ? oneYearFromIso(startDate) : null;
                      void save({ startDate, endDate }, (d) => ({ ...d, startDate, endDate }));
                    }}
                  />
                </Field>
                {draft.allowsEndDate && (
                  <Field label={t('contracts.fields.endDate')}>
                    <Input
                      type="date"
                      value={draft.endDate ?? ''}
                      disabled={hired}
                      onChange={(e) => {
                        const endDate = e.target.value === '' ? null : e.target.value;
                        void save({ endDate }, (d) => ({ ...d, endDate }));
                      }}
                    />
                  </Field>
                )}
                <Field label={t('contracts.candidate.hiringDate')}>
                  <Input
                    type="date"
                    value={draft.hiringDate}
                    disabled={hired}
                    onChange={(e) => {
                      const hiringDate = e.target.value;
                      if (hiringDate === '') return;
                      void save({ hiringDate }, (d) => ({ ...d, hiringDate }));
                    }}
                  />
                </Field>
              </div>
              <p className="mt-3 text-xs text-slate-500" data-save-state={saveState}>
                {saveState === 'saving'
                  ? t('contracts.candidate.saving')
                  : saveState === 'error'
                    ? t('contracts.candidate.saveFailed')
                    : t('contracts.candidate.savedAuto', { at: formatDateTime(draft.updatedAt, locale) })}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('contracts.candidate.papers')}
              description={t('contracts.candidate.papersHint')}
              actions={
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(draft.papers.map((p) => p.key))}>
                    {t('contracts.candidate.selectAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                    {t('contracts.candidate.selectNone')}
                  </Button>
                </div>
              }
            />
            <CardBody>
              {draft.papers.length === 0 ? (
                <p className="text-sm text-slate-500">{t('contracts.candidate.noPapers')}</p>
              ) : (
                <div className="space-y-5">
                  {GROUPS.map((group) => {
                    const papers = draft.papers.filter((p) => p.group === group);
                    if (papers.length === 0) return null;
                    return (
                      <section key={group} data-paper-group={group}>
                        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{groupTitle[group]}</h3>
                        <div className="flex flex-wrap gap-3">
                          {papers.map((p) => (
                            <PaperTile
                              key={p.key}
                              paperKey={p.key}
                              name={localized(p.name, locale)}
                              kind={p.kind}
                              checked={p.selected}
                              onToggle={(on) => toggle(p.key, on)}
                              onEdit={() => setEditing(p)}
                              onPrint={() => void print([p.key])}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title={t('contracts.candidate.shape')} description={t('contracts.candidate.shapeHint')} />
          <CardBody>
            {contractKey === null ? (
              <div className="grid min-h-96 place-items-center text-sm text-slate-400">{t('contracts.candidate.noContract')}</div>
            ) : preview === '' ? (
              <div className="grid min-h-96 place-items-center text-sm text-slate-400">{t('common.loading')}</div>
            ) : (
              <iframe
                title={t('contracts.candidate.shape')}
                sandbox=""
                srcDoc={preview}
                className="h-[75vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
              />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 py-3 dark:border-slate-700 dark:bg-slate-900/95">
        <span className="me-auto text-xs text-slate-500">
          {printed
            ? t('contracts.candidate.printedAt', { at: formatDateTime(draft.printedAt ?? '', locale), count: draft.printCount })
            : t('contracts.candidate.printFirst')}
        </span>
        <Button
          variant="secondary"
          disabled={selected.length === 0}
          loading={render.isPending && render.variables?.print === true}
          onClick={() => void print(selected.map((p) => p.key))}
          data-print-selected
        >
          {t('contracts.candidate.printSelected', { count: selected.length })}
        </Button>
        {!hired && (
          <Can permission="employee.create">
            <Button disabled={!printed} loading={hire.isPending} onClick={() => void doHire()} data-hire>
              {t('employees.ready.hire')}
            </Button>
          </Can>
        )}
      </div>

      <EditPaperValuesDialog
        paper={editing}
        values={draft.values}
        saving={update.isPending}
        onClose={() => setEditing(null)}
        onSave={(changed) => void saveValues(changed)}
      />
    </PageContainer>
  );
};
