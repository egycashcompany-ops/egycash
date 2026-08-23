// The maintenance open form — legacy atm_maintenance.ejs:707-735 by parity: machine codes,
// service types and reference numbers aligned BY LINE, plus one free datetime for the batch
// (datetime-local, empty → now). The two extra textareas and the free time are exactly what
// distinguishes it from the replenishment form.
import { useState, type FormEvent } from 'react';
import { normalizeAtmMachineCode, splitAtmFormLines } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useOpenAtmMaintenances } from '../api/atm-queries';

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

export const OpenMaintenancesForm = (): JSX.Element => {
  const t = useT();
  const open = useOpenAtmMaintenances();
  const [codes, setCodes] = useState('');
  const [services, setServices] = useState('');
  const [references, setReferences] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const rows = buildMaintenanceRows(codes, services, references);
    if (rows.length === 0) return;
    try {
      const result = await open.mutateAsync({
        rows,
        openedAt: openedAt === '' ? null : new Date(openedAt).toISOString(),
      });
      setUnknownCodes(result.unknownCodes);
      if (result.opened.length > 0) {
        toast.success(t('atm.maintenance.openedCount', { count: result.opened.length }));
        setCodes('');
        setServices('');
        setReferences('');
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
          className="min-w-44 text-center"
        />
      </Field>
      <Field label={t('atm.maintenance.serviceTypes')}>
        <Textarea
          value={services}
          onChange={(e) => setServices(e.target.value)}
          rows={3}
          placeholder={t('atm.maintenance.serviceTypesHint')}
          className="min-w-44 text-center"
        />
      </Field>
      <Field label={t('atm.maintenance.referenceNumbers')}>
        <Textarea
          value={references}
          onChange={(e) => setReferences(e.target.value)}
          rows={3}
          placeholder={t('atm.maintenance.referenceNumbersHint')}
          className="min-w-44 text-center"
        />
      </Field>
      <Field label={t('atm.common.openTime')} hint={t('atm.maintenance.openTimeHint')}>
        <Input
          type="datetime-local"
          value={openedAt}
          onChange={(e) => setOpenedAt(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={open.isPending}>
        {t('atm.maintenance.openAction')}
      </Button>
      {unknownCodes.length > 0 && (
        <p className="w-full text-sm text-red-600 dark:text-red-400">
          {t('atm.common.unknownCodes', { codes: unknownCodes.join('، ') })}
        </p>
      )}
    </form>
  );
};
