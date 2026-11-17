// «طباعة العقد والمستندات» on the EMPLOYEE's profile (A28) — «لما ادخل علي موظف مثلا و عاوز اجدد
// عقد او اطبع نمازج او عقود تكون موجوده فال toggle اللي فوق … علي اساس لو عاوز اجددلو عقد او عاوز
// اطبعها لاي سبب كان يبقا فيه امكانيه سريعه ان اطبعلو».
//
//   · THE CONTRACT the employee holds, with «تجديد العقد»: a renewal from the day after it ends, for
//     one year, through the contract's own renewal (approval and generation as always).
//   · THE PAPERS of their job — the contract, every job's forms, their job's own — as the same tiles
//     as «عقد جديد»: tick, «طباعة» one alone, or «طباعة المحدد». The contract prints as generated;
//     an employee who holds none has one made, as «مستندات التعيين» makes it.
//   · «تعديل» under a paper — «زي معملنا قبل كدا تحت الtoggle تعديل و طباعه و تحت يظهر البيانات عشان
//     التعديل و النص التاني الفورم»: below, on one half, every value the paper prints, changeable for
//     this employee; on the other, the paper as it prints, redrawn with each change. What is typed is
//     saved as a box is left, kept for the employee — their file never changes — and printed by every
//     paper of theirs that prints it, here and in «المعينون». The contract they hold shows what it
//     carries and prints as issued: its values change only by renewing or amending it.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type CandidatePaperGroup, type EmployeeDto, type EmployeePapersDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, Card, CardBody, CardHeader, toast } from '../../../../shared/ui';
import { formatDate, formatDateTime, localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import {
  useEmployeePapers,
  usePreviewEmployeePaper,
  usePrintEmployeePapers,
  useSaveEmployeePaperValues,
} from '../api/contract-queries';
import { AmendRenewDialog } from './ContractActionDialogs';
import { ContractStatusBadge } from './ContractStatusBadge';
import { PaperTile } from './PaperTile';
import { PaperValuesForm } from './PaperValuesForm';

/** Shown on the employee's tab, never typed in there: their code, the contract's number and term. */
export const EMPLOYEE_READ_ONLY = new Set(['employee.employeeCode', 'contract.code', 'contract.startDate', 'contract.endDate']);

const GROUPS: CandidatePaperGroup[] = ['contract', 'everyJob', 'thisJob'];

/** The renewal's term: from the day after the contract ends (today, if it has no end), one year. */
export const renewalTerm = (endDate: string | null, today: string): { startDate: string; endDate: string } => {
  const start = new Date(`${endDate ?? today}T00:00:00Z`);
  if (endDate !== null) start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
};

const RENEWABLE = new Set(['active', 'signed']);

const EmployeePapersTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const client = useQueryClient();
  const queryKey = ['hr', 'contracts', 'employeePapers', employee.id];
  const { data, isLoading, isError } = useEmployeePapers(employee.id);
  const print = usePrintEmployeePapers();
  const saveValues = useSaveEmployeePaperValues(employee.id);
  const preview = usePreviewEmployeePaper(employee.id);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [renewing, setRenewing] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const chain = useRef<Promise<void>>(Promise.resolve());

  const papers = data === undefined ? [] : GROUPS.flatMap((g) => data.papers.filter((p) => p.group === g));
  // Every paper ticked to start with, each time the list of papers arrives — but one the job is only
  // offered unticked (the cash-in-transit specialist's weapon declaration). A save leaves the ticks be.
  const papersKey = data === undefined ? '' : data.papers.map((p) => `${p.key}:${String(p.optional)}`).join('|');
  useEffect(() => {
    if (data !== undefined) setChosen(new Set(data.papers.filter((p) => !p.optional).map((p) => p.key)));
  }, [papersKey]);

  // The paper «تعديل» opened, else the first — the contract.
  const active = papers.find((p) => p.key === opened) ?? papers[0] ?? null;

  // That paper as it prints, redrawn whenever what it prints changed.
  const shape = data === undefined ? '' : `${data.valuesVersion}:${data.valuesUpdatedAt ?? ''}:${data.contract?.version ?? ''}`;
  useEffect(() => {
    if (active === null) return;
    const id = window.setTimeout(() => {
      preview
        .mutateAsync(active.key)
        .then((out) => setPreviewHtml(out.html))
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(id);
  }, [active?.key, shape]);

  /**
   * Keep values typed in. Saves are queued — each carries the version the previous one returned, and
   * the values as that one left them — so quick changes never race each other into a conflict.
   */
  const saveValue = (changes: { key: string; value: string }[]): void => {
    chain.current = chain.current.then(async () => {
      const current = client.getQueryData<EmployeePapersDto>(queryKey);
      if (current === undefined) return;
      const kept = new Map(current.values.filter((v) => v.overridden).map((v) => [v.key, v.value]));
      for (const change of changes) kept.set(change.key, change.value);
      setSaveState('saving');
      try {
        await saveValues.mutateAsync({
          overrides: [...kept].map(([key, value]) => ({ key, value })),
          version: current.valuesVersion,
        });
        setSaveState('idle');
      } catch {
        setSaveState('error');
        await client.invalidateQueries({ queryKey });
      }
    });
  };

  const run = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      await chain.current; // what was just typed prints as typed
      const set = await print.mutateAsync({ employeeId: employee.id, keys });
      if (set.documents.length === 0) {
        win.close();
        toast.warning(t('hiringPack.empty'));
        return;
      }
      writePrintWindow(win, set.html);
      if (set.contract?.created === true) toast.success(t('hiringPack.contractCreated', { code: set.contract.code }));
      if (set.contractNote !== null) toast.warning(t(`hiringPack.note.${set.contractNote}`));
    } catch {
      win.close(); // the error itself is surfaced globally
    }
  };

  if (isLoading) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  if (isError || data === undefined) return <p className="text-sm text-red-600">{t('employeePapers.loadFailed')}</p>;

  const held = data.contract;
  const selected = papers.filter((p) => chosen.has(p.key));
  const toggle = (key: string, on: boolean): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <div className="space-y-4" data-employee-papers>
      <Card>
        <CardHeader
          title={t('employeePapers.contract')}
          actions={
            held !== null && RENEWABLE.has(held.status) ? (
              <Can permission="contract.renew">
                <Button size="sm" variant="secondary" onClick={() => setRenewing(true)} data-renew>
                  {t('employeePapers.renew')}
                </Button>
              </Can>
            ) : undefined
          }
        />
        <CardBody>
          {held === null ? (
            <p className="text-sm text-slate-500">{t('employeePapers.noContract')}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">{t('contracts.columns.code')}</dt>
                <dd className="font-mono text-xs" dir="ltr">{held.code}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('contracts.columns.status')}</dt>
                <dd><ContractStatusBadge status={held.status as never} /></dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('contracts.fields.startDate')}</dt>
                <dd>{formatDate(held.startDate, locale)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('contracts.fields.endDate')}</dt>
                <dd>{held.endDate === null ? '—' : formatDate(held.endDate, locale)}</dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('employeePapers.papers')}
          description={t('employeePapers.papersHint')}
          actions={
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(papers.map((p) => p.key)))}>
                {t('contracts.candidate.selectAll')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
                {t('contracts.candidate.selectNone')}
              </Button>
            </div>
          }
        />
        <CardBody>
          {papers.length === 0 ? (
            <p className="text-sm text-slate-500">{t('contracts.candidate.noPapers')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {papers.map((p) => (
                <PaperTile
                  key={p.key}
                  paperKey={p.key}
                  name={localized(p.name, locale)}
                  kind={p.kind}
                  checked={chosen.has(p.key)}
                  active={active?.key === p.key}
                  onToggle={(on) => toggle(p.key, on)}
                  onEdit={() => setOpened(p.key)}
                  onPrint={() => void run([p.key])}
                />
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              disabled={selected.length === 0}
              loading={print.isPending}
              onClick={() => void run(selected.map((p) => p.key))}
              data-print-selected
            >
              {t('contracts.candidate.printSelected', { count: selected.length })}
            </Button>
          </div>
        </CardBody>
      </Card>

      {active !== null && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={t('employeePapers.formTitle', { name: localized(active.name, locale) })}
              description={
                active.locked && held !== null
                  ? t('employeePapers.lockedHint', { code: held.code })
                  : t('employeePapers.formHint')
              }
            />
            <CardBody>
              <div data-paper-form-of={active.key} data-locked={active.locked || undefined}>
                <PaperValuesForm
                  paper={active}
                  values={active.locked ? data.contractValues : data.values}
                  disabled={active.locked}
                  onSave={saveValue}
                  readOnly={EMPLOYEE_READ_ONLY}
                  readOnlyHint={t('employeePapers.fixedValue')}
                  overriddenHint={t('employeePapers.overridden')}
                />
              </div>
              {!active.locked && (
                <p className="mt-4 text-xs text-slate-500" data-save-state={saveState}>
                  {saveState === 'saving'
                    ? t('employeePapers.saving')
                    : saveState === 'error'
                      ? t('employeePapers.saveFailed')
                      : data.valuesUpdatedAt === null
                        ? null
                        : t('employeePapers.savedAt', { at: formatDateTime(data.valuesUpdatedAt, locale) })}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('employeePapers.previewOf', { name: localized(active.name, locale) })}
              description={t('employeePapers.previewHint')}
            />
            <CardBody>
              {previewHtml === '' ? (
                <div className="grid min-h-96 place-items-center text-sm text-slate-400">{t('common.loading')}</div>
              ) : (
                <iframe
                  title={localized(active.name, locale)}
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-[75vh] w-full rounded border border-slate-200 bg-white dark:border-slate-700"
                  data-employee-preview
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {held !== null && (
        <AmendRenewDialog
          contract={held}
          mode="renew"
          open={renewing}
          onClose={() => setRenewing(false)}
          initial={renewalTerm(held.endDate, new Date().toISOString().slice(0, 10))}
        />
      )}
    </div>
  );
};

export default EmployeePapersTab;
