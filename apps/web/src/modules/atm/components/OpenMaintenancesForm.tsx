// The maintenance open form — legacy atm_maintenance.ejs:707-735 by parity: machine codes,
// service types and reference numbers aligned BY LINE, plus one free datetime for the batch
// (datetime-local, empty → now). The two extra line columns and the free time are exactly what
// distinguishes it from the replenishment form. Unknown codes and the codes the owner's rule left
// unopened (an open maintenance already, or pasted twice — port doc OD-1) are shown in red.
//
// Any number of lines: they go in consecutive requests of `ATM_OPEN_MAX_ROWS` (`openInBatches`).
// If the run stops, what went before stays opened and ONLY the lines certainly not sent stay in
// the boxes; the lines of a request that got no answer are named under the form
// (`OpenStopNotice`), to be checked on the board and put back by hand. The boxes are held while
// the run goes.
//
// The form renders BARE — no card, no bottom margin. The page wraps it and the bank/area filters
// in one bordered row so entry and narrowing read as a single band (MaintenancePage.tsx).
import { useState, type FormEvent } from 'react';
import { normalizeAtmMachineCode, splitAtmFormLines } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { useOpenAtmMaintenances } from '../api/atm-queries';
import { type MaintenanceOpenRow } from '../api/atm-api';
import { joinCodes } from '../lib/operation-view';
import { LineListInput } from './LineListInput';
import { OpenRefusalNotice } from './OpenRefusalNotice';
import { OpenStopNotice, prependLines, type OpenStop } from './OpenStopNotice';

export const buildMaintenanceRows = (
  codesRaw: string,
  servicesRaw: string,
  referencesRaw: string,
): { machineCode: string; serviceType: string | null; referenceNumber: string | null }[] => {
  const codes = splitAtmFormLines(codesRaw);
  const services = splitAtmFormLines(servicesRaw);
  const references = splitAtmFormLines(referencesRaw);
  const lineOrNull = (lines: string[], index: number): string | null =>
    (lines[index] ?? '') === '' ? null : (lines[index] as string);
  return codes
    .map((code, index) => ({
      machineCode: normalizeAtmMachineCode(code),
      serviceType: lineOrNull(services, index),
      referenceNumber: lineOrNull(references, index),
    }))
    .filter((row) => row.machineCode !== '');
};

/** Pure: rows back into the form's three boxes, line by line — `buildMaintenanceRows` reversed. */
export const maintenanceLines = (
  rows: readonly MaintenanceOpenRow[],
): { codes: string; services: string; references: string } => ({
  codes: rows.map((row) => row.machineCode).join('\n'),
  services: rows.map((row) => row.serviceType ?? '').join('\n'),
  references: rows.map((row) => row.referenceNumber ?? '').join('\n'),
});

export const OpenMaintenancesForm = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const open = useOpenAtmMaintenances();
  const [codes, setCodes] = useState('');
  const [services, setServices] = useState('');
  const [references, setReferences] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);
  const [alreadyOpenCodes, setAlreadyOpenCodes] = useState<string[]>([]);
  const [stop, setStop] = useState<OpenStop<MaintenanceOpenRow> | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const rows = buildMaintenanceRows(codes, services, references);
    if (rows.length === 0) return;
    setStop(null);
    try {
      const result = await open.mutateAsync({
        rows,
        openedAt: openedAt === '' ? null : new Date(openedAt).toISOString(),
      });
      setUnknownCodes(result.unknownCodes);
      setAlreadyOpenCodes(result.alreadyOpenCodes);
      if (result.opened.length > 0) {
        toast.success(t('atm.maintenance.openedCount', { count: result.opened.length }));
      }
      if (result.unsent.length > 0 || result.uncertain.length > 0) {
        // Stopped part-way: only the lines certainly not sent stay in the boxes.
        const left = maintenanceLines(result.unsent);
        setCodes(left.codes);
        setServices(left.services);
        setReferences(left.references);
        setStop({ unsent: result.unsent.length, uncertain: result.uncertain });
        toast.error(
          result.uncertain.length > 0
            ? t('atm.common.openUncertain', { count: result.uncertain.length })
            : t('atm.common.openStopped', { count: result.unsent.length }),
          errorMessage(result.failure, locale),
        );
      } else if (result.opened.length > 0) {
        setCodes('');
        setServices('');
        setReferences('');
      }
      if (result.unknownCodes.length > 0) {
        toast.error(
          t('atm.common.unknownCodes', { codes: joinCodes(result.unknownCodes, locale) }),
        );
      }
      // The owner's rule (OD-1): a machine already open — or pasted twice — was not opened again.
      if (result.alreadyOpenCodes.length > 0) {
        toast.error(
          t('atm.maintenance.alreadyOpenCodes', {
            codes: joinCodes(result.alreadyOpenCodes, locale),
          }),
        );
      }
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  /** The lines of unknown outcome, back before what the boxes hold — the reader checked the board. */
  const restoreUncertain = (): void => {
    if (stop === null) return;
    const back = maintenanceLines(stop.uncertain);
    setCodes((current) => prependLines(back.codes, current));
    setServices((current) => prependLines(back.services, current));
    setReferences((current) => prependLines(back.references, current));
    setStop({ ...stop, uncertain: [] });
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
      <Field label={t('atm.maintenance.serviceTypes')}>
        <LineListInput
          value={services}
          onChange={setServices}
          disabled={open.isPending}
          placeholder={t('atm.maintenance.serviceTypesHint')}
        />
      </Field>
      <Field label={t('atm.maintenance.referenceNumbers')}>
        <LineListInput
          value={references}
          onChange={setReferences}
          disabled={open.isPending}
          placeholder={t('atm.maintenance.referenceNumbersHint')}
        />
      </Field>
      <Field label={t('atm.common.openTime')}>
        <Input
          type="datetime-local"
          value={openedAt}
          disabled={open.isPending}
          onChange={(e) => setOpenedAt(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={open.isPending}>
        {t('atm.maintenance.openAction')}
      </Button>
      <OpenRefusalNotice unknownCodes={unknownCodes} alreadyOpenCodes={alreadyOpenCodes} />
      {stop !== null && (
        <OpenStopNotice
          unsent={stop.unsent}
          uncertainCodes={stop.uncertain.map((row) => row.machineCode)}
          onRestore={restoreUncertain}
        />
      )}
    </form>
  );
};
