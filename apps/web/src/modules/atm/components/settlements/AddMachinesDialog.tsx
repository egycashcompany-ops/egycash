// «إضافة ماكينات» (§9.4, §6.5 S14): machine IDs one per line and their times aligned BY LINE, the
// replenishment board's pairing (`OpenReplenishmentsForm.buildReplenishmentRows`, `LineListInput`),
// plus one run for the batch. A time may be typed as `9:00`, `9:00 PM` or `9:00 م` — the server
// reads it (§3.6), and one it cannot read refuses that row only (`badTime`), never the batch.
//
// THE RESULT STAYS ON SCREEN: «أُضيف n», then every code that was not added with its reason.
//
// Any number of lines (2026-11-01, «صلّح كمان إضافة الماكينات»): they go in requests of 200,
// repeats decided over the whole paste first (`addPlanLinesInBatches`). A run that stops puts
// every line not confirmed back into the boxes (`PasteStopNotice`) — sending them again is safe, a
// line added already comes back «موجودة في هذه التغذية». The plan itself still holds at most
// `ATM_PLAN_LINES_MAX` live lines. The boxes, the run and closing are held while a run goes.
import { useEffect, useState } from 'react';
import {
  ATM_PLAN_RUNS,
  type AtmPlanAddResultDto,
  type AtmPlanRun,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { SettlementDialog } from './SettlementDialog';
import { Field, Select } from '../../../../shared/ui/form';
import { LineListInput } from '../LineListInput';
import { buildReplenishmentRows, replenishmentLines } from '../OpenReplenishmentsForm';
import { PasteStopNotice } from '../PasteStopNotice';
import { type PlanAddRun } from '../../api/settlements-api';
import { runLabel } from '../../lib/settlement-view';

export const AddMachinesDialog = ({
  open,
  locale,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  busy: boolean;
  error: string | null;
  /** Resolves with the joined answer (and what is left if the run stopped), or null on failure. */
  onSubmit: (
    run: AtmPlanRun,
    rows: { machineCode: string; scheduleTime: string | null }[],
  ) => Promise<PlanAddRun | null>;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [codes, setCodes] = useState('');
  const [times, setTimes] = useState('');
  const [run, setRun] = useState<AtmPlanRun>(1);
  const [result, setResult] = useState<AtmPlanAddResultDto | null>(null);
  const [stop, setStop] = useState({ left: 0, maybeDone: 0 });

  useEffect(() => {
    if (!open) return;
    setCodes('');
    setTimes('');
    setRun(1);
    setResult(null);
    setStop({ left: 0, maybeDone: 0 });
  }, [open]);

  const rows = buildReplenishmentRows(codes, times);
  const submit = async (): Promise<void> => {
    if (rows.length === 0) return;
    setStop({ left: 0, maybeDone: 0 });
    const answer = await onSubmit(run, rows);
    if (answer === null) return;
    setResult({ added: answer.added, refused: answer.refused });
    if (answer.left.length > 0) {
      // Stopped part-way: every line not confirmed goes back, paired line for line.
      const back = replenishmentLines(answer.left);
      setCodes(back.codes);
      setTimes(back.schedules);
      setStop({ left: answer.left.length, maybeDone: answer.maybeDone });
    } else if (answer.added.length > 0) {
      // As the board's open form does: once something was added the boxes clear, and what was not
      // added stays listed below with its reason.
      setCodes('');
      setTimes('');
    }
  };

  return (
    <SettlementDialog
      open={open}
      // Held while a run goes: closing would reset the boxes its end writes back into.
      onClose={busy ? () => {} : onClose}
      title={t('atm.plan.add.title')}
      size="lg"
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button loading={busy} disabled={rows.length === 0} onClick={() => void submit()}>
            {t('atm.plan.add.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <Field label={t('atm.plan.add.codes')} hint={t('atm.plan.add.codesHint')}>
            <LineListInput
              value={codes}
              onChange={setCodes}
              placeholder="1001"
              required
              disabled={busy}
            />
          </Field>
          <Field label={t('atm.plan.add.times')}>
            <LineListInput value={times} onChange={setTimes} placeholder="9:00" disabled={busy} />
          </Field>
          <Field label={t('atm.settlement.run')} htmlFor="add-machines-run">
            <Select
              id="add-machines-run"
              value={String(run)}
              disabled={busy}
              onChange={(e) => setRun(Number(e.target.value) as AtmPlanRun)}
            >
              {ATM_PLAN_RUNS.map((n) => (
                <option key={n} value={String(n)}>
                  {runLabel(n, t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <PasteStopNotice
          left={stop.left}
          maybeDone={stop.maybeDone}
          action={t('atm.plan.add.submit')}
          safeHint={t('atm.plan.add.resendSafe')}
        />
        {result !== null && (
          <div aria-live="polite" className="space-y-2" data-add-result="true">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {t('atm.plan.add.added', { n: formatNumber(result.added.length, locale) })}
            </p>
            {result.refused.length > 0 && (
              <>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t('atm.plan.add.refused', { n: formatNumber(result.refused.length, locale) })}
                </p>
                <ul className="space-y-1 text-sm" data-add-refused="true">
                  {result.refused.map((r, i) => (
                    <li key={`${r.code}-${String(i)}`} className="flex gap-2">
                      <span dir="ltr" className="font-medium">
                        {r.code}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {t(`atm.plan.refused.${r.reason}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </SettlementDialog>
  );
};
