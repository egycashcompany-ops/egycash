// /atm/data-edit — the legacy /data_edit_atm page (data_edit_atm.ejs, contad_app.js:2356-2544)
// by parity, added to scope by the owner after design approval. One page, the legacy's own
// sections:
//
//   · bulk machine add — code+name line pairs, one bank and one area for the batch; existing
//     codes are skipped and NAMED (:2429-2451 skipped silently);
//   · machine delete by codes — soft + `-D` rename (:2494-2508);
//   · move a machine to another area (:2529-2541);
//   · the ATM bank and area label lists — add if absent, remove (:2471-2527).
import { useState, type FormEvent } from 'react';
import { MAX_PAGE_SIZE, normalizeAtmMachineCode, splitAtmFormLines } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAtmRefLabels,
  useBulkCreateAtmMachines,
  useBulkDeleteAtmMachines,
  useCreateAtmRefLabel,
  useDeleteAtmRefLabel,
  useReassignAtmMachineArea,
} from '../api/atm-queries';

/** Code/name line pairs → machine rows; blank code lines dropped, as the legacy loop did. */
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

const SectionCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element => (
  <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
    <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
    {children}
  </section>
);

const LabelList = ({ kind }: { kind: 'bank' | 'area' }): JSX.Element => {
  const t = useT();
  const labels = useAtmRefLabels(kind, { pageSize: MAX_PAGE_SIZE, sortBy: 'name', sortDir: 'asc' });
  const create = useCreateAtmRefLabel(kind);
  const remove = useDeleteAtmRefLabel(kind);
  const [name, setName] = useState('');

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '') return;
    try {
      await create.mutateAsync({ name: name.trim() });
      toast.success(t('atm.dataEdit.labelAdded'));
      setName('');
    } catch {
      // The legacy said "موجود قبل كدا" for a duplicate (:2474) — the 409 lands here.
      toast.error(t('atm.dataEdit.labelExists'));
    }
  };

  return (
    <SectionCard title={t(kind === 'bank' ? 'atm.dataEdit.banks' : 'atm.dataEdit.areas')}>
      <form onSubmit={(e) => void add(e)} className="mb-3 flex items-end gap-2">
        <Field label={t('atm.dataEdit.labelName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Button type="submit" loading={create.isPending}>
          {t('atm.common.add')}
        </Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {(labels.data?.items ?? []).map((label) => (
          <li
            key={label.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-slate-800"
          >
            {label.name}
            <button
              type="button"
              title={t('atm.common.delete')}
              className="text-slate-400 hover:text-red-600"
              onClick={() => {
                void remove.mutateAsync(label.id).catch(() => {
                  toast.error(t('atm.common.actionFailed'));
                });
              }}
            >
              ×
            </button>
          </li>
        ))}
        {(labels.data?.items ?? []).length === 0 && !labels.isLoading && (
          <li className="text-sm text-slate-400">{t('atm.dataEdit.noLabels')}</li>
        )}
      </ul>
    </SectionCard>
  );
};

export const DataEditPage = (): JSX.Element => {
  const t = useT();
  const banks = useAtmRefLabels('bank', {
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'name',
    sortDir: 'asc',
  });
  const areas = useAtmRefLabels('area', {
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'name',
    sortDir: 'asc',
  });

  const bulkCreate = useBulkCreateAtmMachines();
  const bulkDelete = useBulkDeleteAtmMachines();
  const reassign = useReassignAtmMachineArea();

  // Bulk add.
  const [codes, setCodes] = useState('');
  const [names, setNames] = useState('');
  const [bankName, setBankName] = useState('');
  const [area, setArea] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);

  // Delete.
  const [deleteCodes, setDeleteCodes] = useState('');

  // Reassign.
  const [moveCode, setMoveCode] = useState('');
  const [moveArea, setMoveArea] = useState('');

  const submitAdd = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const machines = buildMachineRows(codes, names);
    if (machines.length === 0 || bankName === '' || area === '') return;
    try {
      const result = await bulkCreate.mutateAsync({ bankName, area, machines });
      setSkipped(result.skippedCodes);
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

  const submitMove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (moveCode.trim() === '' || moveArea === '') return;
    try {
      await reassign.mutateAsync({ machineCode: moveCode.trim(), area: moveArea });
      toast.success(t('atm.dataEdit.machineMoved'));
      setMoveCode('');
    } catch {
      toast.error(t('atm.dataEdit.machineNotFound'));
    }
  };

  const bankOptions = banks.data?.items ?? [];
  const areaOptions = areas.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader title={t('atm.dataEdit.title')} description={t('atm.dataEdit.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t('atm.dataEdit.addMachines')}>
          <form onSubmit={(e) => void submitAdd(e)} className="flex flex-wrap items-end gap-3">
            <Field label={t('atm.replenishments.machineCodes')} required>
              <Textarea
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                rows={3}
                required
                className="min-w-40 text-center"
              />
            </Field>
            <Field label={t('atm.dataEdit.machineNames')} required>
              <Textarea
                value={names}
                onChange={(e) => setNames(e.target.value)}
                rows={3}
                required
                className="min-w-40 text-center"
              />
            </Field>
            <Field label={t('atm.common.bank')} required>
              <Select value={bankName} onChange={(e) => setBankName(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickBank')}
                </option>
                {bankOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('atm.common.area')} required>
              <Select value={area} onChange={(e) => setArea(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickArea')}
                </option>
                {areaOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={bulkCreate.isPending}>
              {t('atm.common.add')}
            </Button>
            {skipped.length > 0 && (
              <p className="w-full text-sm">
                <StatusBadge
                  tone="warning"
                  label={t('atm.dataEdit.machinesSkipped', { codes: skipped.join('، ') })}
                />
              </p>
            )}
          </form>
        </SectionCard>

        <SectionCard title={t('atm.dataEdit.deleteMachines')}>
          <form onSubmit={(e) => void submitDelete(e)} className="flex items-end gap-3">
            <Field
              label={t('atm.replenishments.machineCodes')}
              required
              hint={t('atm.dataEdit.deleteHint')}
            >
              <Textarea
                value={deleteCodes}
                onChange={(e) => setDeleteCodes(e.target.value)}
                rows={3}
                required
                className="min-w-40 text-center"
              />
            </Field>
            <Button type="submit" variant="danger" loading={bulkDelete.isPending}>
              {t('atm.common.delete')}
            </Button>
          </form>
        </SectionCard>

        <SectionCard title={t('atm.dataEdit.moveMachine')}>
          <form onSubmit={(e) => void submitMove(e)} className="flex flex-wrap items-end gap-3">
            <Field label={t('atm.common.machineId')} required>
              <Input value={moveCode} onChange={(e) => setMoveCode(e.target.value)} required />
            </Field>
            <Field label={t('atm.dataEdit.newArea')} required>
              <Select value={moveArea} onChange={(e) => setMoveArea(e.target.value)} required>
                <option value="" disabled>
                  {t('atm.dataEdit.pickArea')}
                </option>
                {areaOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={reassign.isPending}>
              {t('atm.common.save')}
            </Button>
          </form>
        </SectionCard>

        <div className="space-y-4">
          <LabelList kind="bank" />
          <LabelList kind="area" />
        </div>
      </div>
    </PageContainer>
  );
};
