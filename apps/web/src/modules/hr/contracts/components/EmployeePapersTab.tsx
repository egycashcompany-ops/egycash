// «طباعة العقد والمستندات» on the EMPLOYEE's profile (A28) — «لما ادخل علي موظف مثلا و عاوز اجدد
// عقد او اطبع نمازج او عقود تكون موجوده فال toggle اللي فوق … علي اساس لو عاوز اجددلو عقد او عاوز
// اطبعها لاي سبب كان يبقا فيه امكانيه سريعه ان اطبعلو».
//
//   · THE CONTRACT the employee holds, with «تجديد العقد»: a renewal from the day after it ends, for
//     one year, through the contract's own renewal (approval and generation as always).
//   · THE PAPERS of their job — the contract, every job's forms, their job's own — as the same tiles
//     as «عقد جديد»: tick, «طباعة» one alone, or «طباعة المحدد». The contract prints as generated;
//     an employee who holds none has one made, as «مستندات التعيين» makes it.
import { useEffect, useState } from 'react';
import { type CandidatePaperGroup, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Button, Card, CardBody, CardHeader, toast } from '../../../../shared/ui';
import { formatDate, localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import { useEmployeePapers, usePrintEmployeePapers } from '../api/contract-queries';
import { AmendRenewDialog } from './ContractActionDialogs';
import { ContractStatusBadge } from './ContractStatusBadge';
import { PaperTile } from './PaperTile';

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
  const { data, isLoading, isError } = useEmployeePapers(employee.id);
  const print = usePrintEmployeePapers();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [renewing, setRenewing] = useState(false);

  const papers = data === undefined ? [] : GROUPS.flatMap((g) => data.papers.filter((p) => p.group === g));
  // Every paper ticked to start with, each time the list arrives — but one the job is only offered
  // unticked (the cash-in-transit specialist's weapon declaration).
  useEffect(() => {
    if (data !== undefined) setChosen(new Set(data.papers.filter((p) => !p.optional).map((p) => p.key)));
  }, [data]);

  const run = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
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
                  onToggle={(on) => toggle(p.key, on)}
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
