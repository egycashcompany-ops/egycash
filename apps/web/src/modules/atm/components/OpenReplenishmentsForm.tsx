// The multi-row open form — legacy atm_replenishment.ejs:558-580 by parity: machine codes one
// per line, schedule times aligned BY LINE NUMBER, one date for the batch. Codes the master does
// not know come back in the RESPONSE and are shown here — the per-request replacement for the
// legacy's shared `mach_arr_not_found` global that flashed for every user (contad_app.js:202).
import { useState, type FormEvent } from 'react';
import { normalizeAtmMachineCode, splitAtmFormLines } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useOpenAtmReplenishments } from '../api/atm-queries';

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

export const OpenReplenishmentsForm = ({ defaultDate }: { defaultDate: string }): JSX.Element => {
  const t = useT();
  const open = useOpenAtmReplenishments();
  const [codes, setCodes] = useState('');
  const [schedules, setSchedules] = useState('');
  const [forceDate, setForceDate] = useState(defaultDate);
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const rows = buildReplenishmentRows(codes, schedules);
    if (rows.length === 0) return;
    try {
      const result = await open.mutateAsync({
        rows,
        forceDate: forceDate === '' ? null : forceDate,
      });
      setUnknownCodes(result.unknownCodes);
      if (result.opened.length > 0) {
        toast.success(t('atm.replenishments.openedCount', { count: result.opened.length }));
        setCodes('');
        setSchedules('');
      }
      if (result.unknownCodes.length > 0) {
        toast.error(t('atm.common.unknownCodes', { codes: result.unknownCodes.join('، ') }));
      }
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
    >
      <Field label={t('atm.replenishments.machineCodes')} required>
        <Textarea
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          rows={3}
          required
          placeholder={t('atm.replenishments.machineCodesHint')}
          className="min-w-48 text-center"
        />
      </Field>
      <Field label={t('atm.replenishments.scheduleTimes')}>
        <Textarea
          value={schedules}
          onChange={(e) => setSchedules(e.target.value)}
          rows={3}
          placeholder={t('atm.replenishments.scheduleTimesHint')}
          className="min-w-48 text-center"
        />
      </Field>
      <Field label={t('atm.replenishments.forceDate')} hint={t('atm.replenishments.forceDateHint')}>
        <Input type="date" value={forceDate} onChange={(e) => setForceDate(e.target.value)} />
      </Field>
      <Button type="submit" loading={open.isPending}>
        {t('atm.replenishments.openAction')}
      </Button>
      {unknownCodes.length > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">
          {t('atm.common.unknownCodes', { codes: unknownCodes.join('، ') })}
        </p>
      )}
    </form>
  );
};
