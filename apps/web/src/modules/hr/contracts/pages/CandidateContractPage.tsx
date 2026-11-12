// «عقد جديد» for a CANDIDATE (A28) — reached from «جاهزون للتعيين» by «طباعة العقد والمستندات».
//
// «اول مندخل عل عقد جديد … فيها الform و شكل العقد اللي هيطلع للشخص علي حسب وظيفتو و اسمو … toggle
// buttoms للنمازج … و بعد ميختار هيبقا فيه 2 زرار بقا ف اخر الصفحه واحد للطباعه … و زرار جمبو علطول
// اللي هو التعيين … الزرار ميبقاش active الا لما يطبع اول». Then: «عاوز المستندات كلها تظهر ك line
// واحد بنفس ال toggle دا جمب كلمه عقد جديد فوق … و عاوز فالمساحه اللي انت عامل فيها ال المستندات
// دي دلوقت … تبقي علي اساس انها form ساعت ميدوس علي اي نموزج فيهم كتعديل وريني».
//
//   · THE PAPERS are ONE ROW beside the title — the candidate's own, in print order: those of their
//     department and job, as «مستندات الوظائف» sets them («النمازج المخصصه بس للاداره او الوظائف هي
//     اللي هتكون موجوده») — each a tile to tick for printing, with «تعديل» and «طباعة» (that paper
//     alone) under it.
//   · THE FORM below is the contract's term and the hiring date, then the paper opened by its
//     «تعديل»: every value it prints, changeable for this candidate. Beside it, that paper as it
//     prints — the contract until another paper is opened.
//   · «طباعة المحدد» prints the ticked papers; «تعيين» stays off until something was printed, then
//     hires the candidate and records the contract.
//   · Every change is saved to the server as it is made — a closed tab or an expired session loses
//     nothing («يتعملو ريكورد»).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  type CandidateDraftDto,
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
import { PaperValuesForm } from '../components/PaperValuesForm';

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
  const [opened, setOpened] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const chain = useRef<Promise<void>>(Promise.resolve());

  /**
   * Save one change. Changes are queued — each one carries the version the previous one returned,
   * so quick ticks never race each other into a conflict.
   */
  const save = (
    change: Omit<UpdateCandidateDraft, 'version'>,
    optimistic?: (d: CandidateDraftDto) => CandidateDraftDto,
  ): Promise<void> => {
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

  // The candidate's papers, in print order as the server lists them; the one in the form is the one
  // opened, else the first — the contract.
  const papers = draft?.papers ?? [];
  const active = papers.find((p) => p.key === opened) ?? papers[0] ?? null;

  // That paper as it prints, re-drawn whenever what it prints changed.
  const shapeOf = draft === undefined ? '' : `${draft.version}:${draft.startDate}:${draft.endDate ?? ''}:${draft.hiringDate}`;
  useEffect(() => {
    if (active === null) return;
    const id = window.setTimeout(() => {
      render
        .mutateAsync({ keys: [active.key], print: false })
        .then((out) => setPreview(out.html))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(id);
  }, [active?.key, shapeOf]);

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

  const selected = papers.filter((p) => p.selected);
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
    setSelected(papers.filter((p) => (p.key === key ? on : p.selected)).map((p) => p.key));

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

  /** One value typed in for this candidate ('' gives the record's own back). */
  const saveValue = (change: { key: string; value: string }): void => {
    const kept = new Map(draft.values.filter((v) => v.overridden).map((v) => [v.key, v.value]));
    kept.set(change.key, change.value);
    void save({ overrides: [...kept].map(([key, value]) => ({ key, value })) });
  };

  // ── The papers, ONE row beside the title ──────────────────────────────────────────────────
  const row = (
    <div className="flex min-w-0 items-start gap-3" data-papers-row>
      <div className="flex shrink-0 flex-col gap-1 pt-1">
        <Button size="sm" variant="ghost" onClick={() => setSelected(papers.map((p) => p.key))}>
          {t('contracts.candidate.selectAll')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
          {t('contracts.candidate.selectNone')}
        </Button>
      </div>
      {papers.length === 0 ? (
        <p className="self-center text-sm text-slate-500">{t('contracts.candidate.noPapers')}</p>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-2 pb-1">
          {papers.map((p) => (
            <PaperTile
              key={p.key}
              paperKey={p.key}
              name={localized(p.name, locale)}
              kind={p.kind}
              checked={p.selected}
              active={active?.key === p.key}
              onToggle={(on) => toggle(p.key, on)}
              onEdit={() => setOpened(p.key)}
              onPrint={() => void print([p.key])}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.create.title')}
        breadcrumbs={[
          { label: t('employees.ready.title'), to: '/employees/ready' },
          { label: t('contracts.create.title') },
        ]}
        toolbar={row}
      />

      {hired && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {t('contracts.candidate.alreadyHired')}{' '}
          <button type="button" className="font-medium underline" onClick={() => navigate(`/employees/${draft.employeeId ?? ''}`)}>
            {t('contracts.candidate.openEmployee')}
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('contracts.candidate.details')} description={t('contracts.candidate.subtitle')} />
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

            {active !== null && (
              <section className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700" data-paper-form-of={active.key}>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {t('contracts.candidate.formTitle', { name: localized(active.name, locale) })}
                </h3>
                <p className="mb-3 mt-0.5 text-xs text-slate-500">{t('contracts.candidate.formHint')}</p>
                <PaperValuesForm paper={active} values={draft.values} disabled={hired} onSave={saveValue} />
              </section>
            )}

            <p className="mt-4 text-xs text-slate-500" data-save-state={saveState}>
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
            title={
              active === null
                ? t('contracts.candidate.noContract')
                : t('contracts.candidate.previewOf', { name: localized(active.name, locale) })
            }
            description={t('contracts.candidate.previewHint')}
          />
          <CardBody>
            {active === null ? (
              <div className="grid min-h-96 place-items-center text-sm text-slate-400">{t('contracts.candidate.noPapers')}</div>
            ) : preview === '' ? (
              <div className="grid min-h-96 place-items-center text-sm text-slate-400">{t('common.loading')}</div>
            ) : (
              <iframe
                title={localized(active.name, locale)}
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
    </PageContainer>
  );
};
