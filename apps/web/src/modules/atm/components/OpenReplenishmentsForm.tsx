// The multi-row open form — legacy atm_replenishment.ejs:558-580 by parity: machine codes one
// per line, schedule times aligned BY LINE NUMBER, one date for the batch. Codes the master does
// not know come back in the RESPONSE and are shown here — the per-request replacement for the
// legacy's shared `mach_arr_not_found` global that flashed for every user (contad_app.js:202).
// Every line of a known code opens — a code pasted twice opens twice, and a machine already open
// opens again (the owner, 2026-11-01 — port doc OD-1b), as in the legacy.
//
// Any number of lines (2026-11-01: «حوالى 700 تغذية … لما بضيفهم كلهم مره واحده بيجيب الرساله»):
// they go in consecutive requests of `ATM_OPEN_MAX_ROWS` (`openInBatches`). If the run stops, what
// went before stays opened and ONLY the lines certainly not sent stay in the boxes. The lines of a
// request that got no answer may have opened — a replenishment opens again on every send — so they
// are named under the form instead (`OpenStopNotice`), to be checked in the table and put back by
// hand; they stay until then, whatever is pressed meanwhile. The boxes are held while the run goes.
//
// The form renders BARE — no card, no bottom margin. The page wraps it and the bank/area filters
// in one bordered row so entry and narrowing read as a single band (ReplenishmentsPage.tsx).
import { useState, type FormEvent } from 'react';
import { normalizeAtmMachineCode, splitAtmFormLines } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { runFailureText } from '../lib/paste-batches';
import { useRunUnloadGuard } from '../lib/useRunUnloadGuard';
import { useOpenAtmReplenishments } from '../api/atm-queries';
import { type ReplenishmentOpenRow } from '../api/atm-api';
import { joinCodes } from '../lib/operation-view';
import { LineListInput } from './LineListInput';
import { OpenRefusalNotice } from './OpenRefusalNotice';
import {
  OpenStopNotice,
  emptyOpenStop,
  openPressEnded,
  openPressStarted,
  prependLines,
  withoutRows,
  type OpenStopState,
} from './OpenStopNotice';

/** Line pairs → rows: code[i] + schedule[i]; blank code lines dropped, as the legacy loop did. */
export const buildReplenishmentRows = (
  codesRaw: string,
  schedulesRaw: string,
): { machineCode: string; scheduleTime: string | null }[] => {
  const codes = splitAtmFormLines(codesRaw);
  const schedules = splitAtmFormLines(schedulesRaw);
  return codes
    .map((code, index) => ({
      machineCode: normalizeAtmMachineCode(code),
      scheduleTime: (schedules[index] ?? '') === '' ? null : (schedules[index] as string),
    }))
    .filter((row) => row.machineCode !== '');
};

/** Pure: rows back into the form's two boxes, line by line — `buildReplenishmentRows` reversed. */
export const replenishmentLines = (
  rows: readonly ReplenishmentOpenRow[],
): { codes: string; schedules: string } => ({
  codes: rows.map((row) => row.machineCode).join('\n'),
  schedules: rows.map((row) => row.scheduleTime ?? '').join('\n'),
});

export const OpenReplenishmentsForm = ({ defaultDate }: { defaultDate: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const open = useOpenAtmReplenishments();
  useRunUnloadGuard(open.isPending);
  const [codes, setCodes] = useState('');
  const [schedules, setSchedules] = useState('');
  const [forceDate, setForceDate] = useState(defaultDate);
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);
  const [stop, setStop] = useState<OpenStopState<ReplenishmentOpenRow>>(emptyOpenStop);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const rows = buildReplenishmentRows(codes, schedules);
    if (rows.length === 0) return;
    setStop(openPressStarted);
    try {
      const result = await open.mutateAsync({
        rows,
        forceDate: forceDate === '' ? null : forceDate,
      });
      setUnknownCodes(result.unknownCodes);
      if (result.opened.length > 0) {
        toast.success(t('atm.replenishments.openedCount', { count: result.opened.length }));
      }
      if (result.unsent.length > 0 || result.uncertain.length > 0) {
        // Stopped part-way: only the lines certainly not sent stay in the boxes.
        const left = replenishmentLines(result.unsent);
        setCodes(left.codes);
        setSchedules(left.schedules);
        setStop((held) => openPressEnded(held, result));
        toast.error(
          result.uncertain.length > 0
            ? t('atm.common.openUncertain', { count: result.uncertain.length })
            : t('atm.common.openStopped', { count: result.unsent.length }),
          result.uncertain.length > 0
            ? `${t('atm.common.openUncertainRisk')} ${runFailureText(result.failure, t, locale)}`
            : runFailureText(result.failure, t, locale),
        );
      } else if (result.opened.length > 0) {
        setCodes('');
        setSchedules('');
      }
      if (result.unknownCodes.length > 0) {
        toast.error(
          t('atm.common.unknownCodes', { codes: joinCodes(result.unknownCodes, locale) }),
        );
      }
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  /** The lines of unknown outcome, back before what the boxes hold — the reader checked the table. */
  const restoreUncertain = (): void => {
    const shown = stop.uncertain;
    const back = replenishmentLines(shown);
    setCodes((current) => prependLines(back.codes, current));
    setSchedules((current) => prependLines(back.schedules, current));
    setStop((held) => ({ ...held, uncertain: withoutRows(held.uncertain, shown) }));
  };
  /** Hide the list the reader saw — they checked the table, or will not reopen them. */
  const dismissUncertain = (): void => {
    const shown = stop.uncertain;
    setStop((held) => ({ ...held, uncertain: withoutRows(held.uncertain, shown) }));
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
      <Field label={t('atm.replenishments.machineCodes')} required>
        <LineListInput
          value={codes}
          onChange={setCodes}
          required
          disabled={open.isPending}
          placeholder={t('atm.replenishments.machineCodesHint')}
        />
      </Field>
      <Field label={t('atm.replenishments.scheduleTimes')}>
        <LineListInput
          value={schedules}
          onChange={setSchedules}
          disabled={open.isPending}
          placeholder={t('atm.replenishments.scheduleTimesHint')}
        />
      </Field>
      <Field label={t('atm.replenishments.forceDate')}>
        <Input
          type="date"
          value={forceDate}
          disabled={open.isPending}
          onChange={(e) => setForceDate(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={open.isPending}>
        {t('atm.replenishments.openAction')}
      </Button>
      <OpenRefusalNotice unknownCodes={unknownCodes} />
      {(stop.unsent > 0 || stop.uncertain.length > 0) && (
        <OpenStopNotice
          unsent={stop.unsent}
          uncertainCodes={stop.uncertain.map((row) => row.machineCode)}
          action={t('atm.replenishments.openAction')}
          busy={open.isPending}
          pressAgain={stop.pressAgain}
          onRestore={restoreUncertain}
          onDismiss={dismissUncertain}
        />
      )}
    </form>
  );
};
