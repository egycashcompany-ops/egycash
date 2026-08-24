// The /atm/data-edit entry forms, in the fleet-catalogs shape: one item per dialog, version-aware
// on edit, `isActive` as the archive switch rather than a delete.
//
// The legacy's BULK paste is not lost — it lives in `BulkMachinesDialog` below, reached from the
// machines tab. Pasting a column of codes beside a column of names is how a bank's new batch of
// ATMs actually arrives (contad_app.js:2412-2466), and a per-item form is a poor way to enter
// forty of them; the per-item form is the better way to fix ONE of them, which the legacy had no
// way to do at all.
import { useEffect, useState, type FormEvent } from 'react';
import {
  normalizeAtmMachineCode,
  splitAtmFormLines,
  type AtmMachineDto,
  type AtmRefLabelDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useBulkCreateAtmMachines,
  useBulkDeleteAtmMachines,
  useCreateAtmMachine,
  useCreateAtmRefLabel,
  useUpdateAtmMachine,
  useUpdateAtmRefLabel,
} from '../api/atm-queries';

/** Code/name line pairs → machine rows; blank lines dropped, as the legacy loop did. */
export const buildMachineRows = (
  codesRaw: string,
  namesRaw: string,
): { machineCode: string; name: string }[] => {
  const codes = splitAtmFormLines(codesRaw);
  const names = splitAtmFormLines(namesRaw);
  return codes
    .map((code, index) => ({
      machineCode: normalizeAtmMachineCode(code),
      name: names[index] ?? '',
    }))
    .filter((row) => row.machineCode !== '' && row.name !== '');
};

const LabelOptions = ({ options }: { options: AtmRefLabelDto[] }): JSX.Element => (
  <>
    {options.map((option) => (
      <option key={option.id} value={option.name}>
        {option.name}
      </option>
    ))}
  </>
);

export const MachineDialog = ({
  open,
  onClose,
  machine,
  banks,
  areas,
}: {
  open: boolean;
  onClose: () => void;
  /** null = add; a document = version-aware edit (the code is identity and stays read-only). */
  machine: AtmMachineDto | null;
  banks: AtmRefLabelDto[];
  areas: AtmRefLabelDto[];
}): JSX.Element => {
  const t = useT();
  const [machineCode, setMachineCode] = useState('');
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [area, setArea] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setMachineCode(machine?.machineCode ?? '');
    setName(machine?.name ?? '');
    setBankName(machine?.bankName ?? '');
    setArea(machine?.area ?? '');
    setIsActive(machine?.isActive ?? true);
  }, [open, machine]);

  const create = useCreateAtmMachine();
  const update = useUpdateAtmMachine();
  const pending = create.isPending || update.isPending;
  const complete =
    name.trim() !== '' &&
    bankName !== '' &&
    area !== '' &&
    (machine !== null || normalizeAtmMachineCode(machineCode) !== '');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!complete) return;
    try {
      if (machine === null) {
        await create.mutateAsync({
          machineCode: normalizeAtmMachineCode(machineCode),
          name: name.trim(),
          bankName,
          area,
        });
        toast.success(t('atm.dataEdit.machineAdded'));
      } else {
        await update.mutateAsync({
          id: machine.id,
          body: { name: name.trim(), bankName, area, isActive, version: machine.version },
        });
        toast.success(t('atm.dataEdit.machineSaved'));
      }
      onClose();
    } catch {
      // The single add reports a taken code, where the bulk paste skips it silently.
      toast.error(machine === null ? t('atm.dataEdit.codeTaken') : t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={machine === null ? t('atm.dataEdit.addMachine') : t('atm.dataEdit.editMachine')}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field
          label={t('atm.common.machineId')}
          required
          hint={machine === null ? undefined : t('atm.dataEdit.codeIsIdentity')}
        >
          <Input
            value={machineCode}
            onChange={(e) => setMachineCode(e.target.value)}
            disabled={machine !== null}
            required={machine === null}
            dir="ltr"
          />
        </Field>
        <Field label={t('atm.dataEdit.machineName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('atm.common.bank')} required>
          <Select value={bankName} onChange={(e) => setBankName(e.target.value)} required>
            <option value="" disabled>
              {t('atm.dataEdit.pickBank')}
            </option>
            <LabelOptions options={banks} />
          </Select>
        </Field>
        <Field label={t('atm.common.area')} required>
          <Select value={area} onChange={(e) => setArea(e.target.value)} required>
            <option value="" disabled>
              {t('atm.dataEdit.pickArea')}
            </option>
            <LabelOptions options={areas} />
          </Select>
        </Field>
        {machine !== null && (
          <div className="space-y-1">
            <Checkbox
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              label={t('atm.dataEdit.isActive')}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.dataEdit.isActiveHint')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={pending} disabled={!complete}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export const RefLabelDialog = ({
  open,
  onClose,
  kind,
  label,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'bank' | 'area';
  label: AtmRefLabelDto | null;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(label?.name ?? '');
    setIsActive(label?.isActive ?? true);
  }, [open, label]);

  const create = useCreateAtmRefLabel(kind);
  const update = useUpdateAtmRefLabel(kind);
  const pending = create.isPending || update.isPending;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '') return;
    try {
      if (label === null) {
        await create.mutateAsync({ name: name.trim() });
        toast.success(t('atm.dataEdit.labelAdded'));
      } else {
        await update.mutateAsync({
          id: label.id,
          body: { name: name.trim(), isActive, version: label.version },
        });
        toast.success(t('atm.dataEdit.labelSaved'));
      }
      onClose();
    } catch {
      // The legacy said "موجود قبل كدا" for a duplicate (:2474) — the 409 lands here.
      toast.error(t('atm.dataEdit.labelExists'));
    }
  };

  const title =
    label === null
      ? t(kind === 'bank' ? 'atm.dataEdit.addBank' : 'atm.dataEdit.addArea')
      : t(kind === 'bank' ? 'atm.dataEdit.editBank' : 'atm.dataEdit.editArea');

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label={t('atm.dataEdit.labelName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        {label !== null && (
          <div className="space-y-1">
            <Checkbox
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              label={t('atm.dataEdit.isActive')}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.dataEdit.labelActiveHint')}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={pending} disabled={name.trim() === ''}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * The legacy bulk forms, kept whole: paste a column of codes beside a column of names to register
 * a batch (existing codes are skipped and NAMED), and paste a column of codes to delete a batch
 * (soft delete + the `-D` rename that frees each code for re-registration).
 */
export const BulkMachinesDialog = ({
  open,
  onClose,
  banks,
  areas,
}: {
  open: boolean;
  onClose: () => void;
  banks: AtmRefLabelDto[];
  areas: AtmRefLabelDto[];
}): JSX.Element => {
  const t = useT();
  const [codes, setCodes] = useState('');
  const [names, setNames] = useState('');
  const [bankName, setBankName] = useState('');
  const [area, setArea] = useState('');
  const [deleteCodes, setDeleteCodes] = useState('');

  useEffect(() => {
    if (!open) return;
    setCodes('');
    setNames('');
    setBankName('');
    setArea('');
    setDeleteCodes('');
  }, [open]);

  const bulkCreate = useBulkCreateAtmMachines();
  const bulkDelete = useBulkDeleteAtmMachines();

  const submitAdd = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const machines = buildMachineRows(codes, names);
    if (machines.length === 0 || bankName === '' || area === '') return;
    try {
      const result = await bulkCreate.mutateAsync({ bankName, area, machines });
      if (result.created.length > 0) {
        toast.success(t('atm.dataEdit.machinesAdded', { count: result.created.length }));
        setCodes('');
        setNames('');
      }
      if (result.skippedCodes.length > 0) {
        toast.error(t('atm.dataEdit.machinesSkipped', { codes: result.skippedCodes.join('، ') }));
      }
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const submitDelete = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const machineCodes = splitAtmFormLines(deleteCodes).filter((code) => code !== '');
    if (machineCodes.length === 0) return;
    try {
      const result = await bulkDelete.mutateAsync({ machineCodes });
      toast.success(t('atm.dataEdit.machinesDeleted', { count: result.deletedCodes.length }));
      if (result.unknownCodes.length > 0) {
        toast.error(t('atm.common.unknownCodes', { codes: result.unknownCodes.join('، ') }));
      }
      setDeleteCodes('');
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('atm.dataEdit.bulkTitle')}>
      <div className="space-y-6">
        <form onSubmit={(e) => void submitAdd(e)} className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.dataEdit.addMachines')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('atm.replenishments.machineCodes')} required>
              <Textarea
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                rows={5}
                required
                dir="ltr"
                className="text-center"
              />
            </Field>
            <Field
              label={t('atm.dataEdit.machineNames')}
              required
              hint={t('atm.dataEdit.lineAlignHint')}
            >
              <Textarea
                value={names}
                onChange={(e) => setNames(e.target.value)}
                rows={5}
                required
                className="text-center"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('atm.common.bank')} required>
              <Select value={bankName} onChange={(e) => setBankName(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickBank')}
                </option>
                <LabelOptions options={banks} />
              </Select>
            </Field>
            <Field label={t('atm.common.area')} required>
              <Select value={area} onChange={(e) => setArea(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickArea')}
                </option>
                <LabelOptions options={areas} />
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={bulkCreate.isPending}>
              {t('atm.common.add')}
            </Button>
          </div>
        </form>

        <form
          onSubmit={(e) => void submitDelete(e)}
          className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.dataEdit.deleteMachines')}
          </h3>
          <Field
            label={t('atm.replenishments.machineCodes')}
            required
            hint={t('atm.dataEdit.deleteHint')}
          >
            <Textarea
              value={deleteCodes}
              onChange={(e) => setDeleteCodes(e.target.value)}
              rows={4}
              required
              dir="ltr"
              className="text-center"
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" loading={bulkDelete.isPending}>
              {t('atm.common.delete')}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
};
