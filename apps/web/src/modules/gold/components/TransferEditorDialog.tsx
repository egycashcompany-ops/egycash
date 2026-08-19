// عمليات التحويل — the ownership-transfer editor.
//
// Nothing physical moves here. Two panels — the current owner and the new one, each with their
// delegate and national id — and the bars whose ownership changes. Approving rewrites who owns
// them; the bars stay in their drawers, which is why this screen has no vault or drawer anywhere
// on it.
import { useEffect, useState } from 'react';
import {
  type CreateGoldTransfer,
  type GoldBarDto,
  type GoldMetalType,
  type GoldTransferDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { CheckIcon, PrinterIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { printTransfer, transferNextNumber } from '../api/gold-api';
import {
  useConfirmGoldTransfer,
  useCreateGoldTransfer,
  useGoldRepresentatives,
  useUpdateGoldTransfer,
} from '../api/gold-queries';
import { BarPicker } from './BarPicker';
import { EmployeePicker } from './EmployeePicker';
import { metalLabel, metalOptions } from './gold-labels';
import { useGoldCompanyOptions } from './useGoldCompanyOptions';
import { fmtWeightValue, toDateInput, todayInput } from '../lib/gold-format';
import { printReceiptHtml } from '../lib/gold-print';

export const TransferEditorDialog = ({
  existing,
  loading,
  onClose,
}: {
  existing: GoldTransferDto | null;
  loading: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const companies = useGoldCompanyOptions();
  const create = useCreateGoldTransfer();
  const update = useUpdateGoldTransfer();
  const confirm = useConfirmGoldTransfer();

  const [id, setId] = useState<string | null>(existing?.id ?? null);
  const [version, setVersion] = useState(existing?.version ?? 0);
  const [number, setNumber] = useState(existing?.transferNumber ?? '');
  const [transferDate, setTransferDate] = useState(
    existing === null ? todayInput() : toDateInput(existing.transferDate),
  );
  const [metalType, setMetalType] = useState<GoldMetalType | ''>(existing?.metalType ?? '');
  const [currentOwnerId, setCurrentOwnerId] = useState(existing?.currentOwnerId ?? '');
  const [currentDelegateId, setCurrentDelegateId] = useState(
    existing?.currentOwnerDelegateId ?? '',
  );
  const [currentNationalId, setCurrentNationalId] = useState(
    existing?.currentOwnerNationalId ?? '',
  );
  const [newOwnerId, setNewOwnerId] = useState(existing?.newOwnerId ?? '');
  const [newDelegateId, setNewDelegateId] = useState(existing?.newOwnerDelegateId ?? '');
  const [newNationalId, setNewNationalId] = useState(existing?.newOwnerNationalId ?? '');
  const [supervisor1, setSupervisor1] = useState({
    id: existing?.supervisor1EmployeeId ?? '',
    name: existing?.supervisor1Name ?? '',
  });
  const [supervisor2, setSupervisor2] = useState({
    id: existing?.supervisor2EmployeeId ?? '',
    name: existing?.supervisor2Name ?? '',
  });
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [selected, setSelected] = useState<string[]>(existing?.barIds ?? []);
  const [chosen, setChosen] = useState<
    {
      id: string;
      serialNumber: string;
      weight: number;
      brand: string | null;
      purity: string | null;
    }[]
  >(existing?.bars ?? []);

  const locked = existing?.status === 'confirmed' || existing?.status === 'reverted';
  const currentReps = useGoldRepresentatives(
    { companyId: currentOwnerId, pageSize: 200 },
    currentOwnerId !== '',
  );
  const newReps = useGoldRepresentatives(
    { companyId: newOwnerId, pageSize: 200 },
    newOwnerId !== '',
  );

  useEffect(() => {
    if (id !== null || number !== '') return;
    void transferNextNumber()
      .then((next) => {
        setNumber(next.number);
      })
      .catch(() => null);
  }, [id, number]);

  const total = chosen.reduce((sum, bar) => sum + bar.weight, 0);

  const payload = (): CreateGoldTransfer => ({
    transferDate: new Date(transferDate),
    metalType: metalType === '' ? null : metalType,
    currentOwnerId: currentOwnerId === '' ? null : currentOwnerId,
    currentOwnerDelegateId: currentDelegateId === '' ? null : currentDelegateId,
    currentOwnerNationalId: currentNationalId === '' ? null : currentNationalId,
    newOwnerId: newOwnerId === '' ? null : newOwnerId,
    newOwnerDelegateId: newDelegateId === '' ? null : newDelegateId,
    newOwnerNationalId: newNationalId === '' ? null : newNationalId,
    supervisor1EmployeeId: supervisor1.id === '' ? null : supervisor1.id,
    supervisor2EmployeeId: supervisor2.id === '' ? null : supervisor2.id,
    notes: notes === '' ? null : notes,
    barIds: selected,
  });

  const persist = async (): Promise<GoldTransferDto> => {
    if (id === null) {
      const saved = await create.mutateAsync(payload());
      setId(saved.id);
      setVersion(saved.version);
      setNumber(saved.transferNumber);
      return saved;
    }
    const saved = await update.mutateAsync({ id, body: { ...payload(), version } });
    setVersion(saved.version);
    return saved;
  };

  const saveDraft = async (): Promise<void> => {
    try {
      await persist();
      toast.success(t('gold.common.draftSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const doConfirm = async (): Promise<void> => {
    try {
      const saved = await persist();
      await confirm.mutateAsync({ id: saved.id, version: saved.version });
      toast.success(t('gold.transfers.confirmed'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('gold.receiving.confirmFailed'));
    }
  };

  const doPrint = async (): Promise<void> => {
    if (id !== null) await printTransfer(id).catch(() => null);
    const name = (list: { id: string; fullName: string }[] | undefined, target: string): string =>
      list?.find((rep) => rep.id === target)?.fullName ?? '—';
    const ok = printReceiptHtml({
      title: t('gold.transfers.printTitle'),
      number: number === '' ? t('gold.receiving.printDraft') : number,
      branch: existing?.branchName ?? '',
      meta: [
        [t('gold.common.date'), transferDate],
        [t('gold.common.metalType'), metalType === '' ? '—' : metalLabel(t, metalType)],
        [
          t('gold.transfers.currentOwner'),
          companies.find((c) => c.value === currentOwnerId)?.label ?? '—',
        ],
        [
          t('gold.transfers.currentOwnerDelegate'),
          `${name(currentReps.data?.items, currentDelegateId)}${currentNationalId === '' ? '' : ` — ${currentNationalId}`}`,
        ],
        [t('gold.transfers.newOwner'), companies.find((c) => c.value === newOwnerId)?.label ?? '—'],
        [
          t('gold.transfers.newOwnerDelegate'),
          `${name(newReps.data?.items, newDelegateId)}${newNationalId === '' ? '' : ` — ${newNationalId}`}`,
        ],
        [t('gold.common.supervisor1'), supervisor1.name === '' ? '—' : supervisor1.name],
        [t('gold.common.supervisor2'), supervisor2.name === '' ? '—' : supervisor2.name],
        [t('gold.receiving.printBarsCount'), String(selected.length)],
        [t('gold.common.totalWeight'), t('gold.common.grams', { value: fmtWeightValue(total) })],
      ],
      table: {
        head: [
          '#',
          t('gold.common.serial'),
          t('gold.common.weight'),
          t('gold.common.brand'),
          t('gold.common.purity'),
        ],
        rows: chosen.map((bar, index) => [
          index + 1,
          bar.serialNumber,
          t('gold.common.grams', { value: fmtWeightValue(bar.weight) }),
          bar.brand ?? '',
          bar.purity ?? '',
        ]),
      },
      footer: notes,
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  const title = locked
    ? t('gold.transfers.viewTitle', { number })
    : id !== null
      ? t('gold.transfers.editTitle', { number })
      : t('gold.transfers.newTitle');

  if (loading) {
    return (
      <Dialog open onClose={onClose} title={t('gold.common.loading')} size="lg">
        <LoadingState />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {t('gold.common.selectedSummary', {
              count: selected.length,
              weight: t('gold.common.grams', { value: fmtWeightValue(total) }),
            })}
          </span>
          <span className="flex gap-2">
            <Can permission="goldTransfer.print">
              <Button
                variant="secondary"
                leftIcon={<PrinterIcon className="h-4 w-4" />}
                onClick={() => void doPrint()}
              >
                {t('gold.common.print')}
              </Button>
            </Can>
            {!locked && (
              <Button
                variant="secondary"
                loading={create.isPending || update.isPending}
                onClick={() => void saveDraft()}
              >
                {t('gold.common.saveDraft')}
              </Button>
            )}
            {!locked && (
              <Can permission="goldTransfer.confirm">
                <Button
                  leftIcon={<CheckIcon className="h-4 w-4" />}
                  loading={confirm.isPending}
                  onClick={() => void doConfirm()}
                >
                  {t('gold.transfers.confirm')}
                </Button>
              </Can>
            )}
          </span>
        </div>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('gold.transfers.date')}>
              <Input
                type="date"
                value={transferDate}
                disabled={locked}
                onChange={(e) => {
                  setTransferDate(e.target.value);
                }}
              />
            </Field>
            <Field label={t('gold.transfers.number')}>
              <p className="rounded-lg border border-slate-200 px-3 py-2 font-bold tracking-wide text-brand-700 dark:border-slate-700 dark:text-brand-300">
                {number === '' ? '…' : number}
              </p>
            </Field>
            <Field label={t('gold.common.metalType')}>
              <Select
                value={metalType}
                disabled={locked}
                onChange={(e) => {
                  setMetalType(e.target.value as GoldMetalType | '');
                }}
              >
                <option value="">{t('gold.common.allMetals')}</option>
                {metalOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div />
            <EmployeePicker
              label={t('gold.common.supervisor1')}
              value={supervisor1.id}
              valueLabel={supervisor1.name}
              disabled={locked}
              onChange={(employeeId, name) => {
                setSupervisor1({ id: employeeId, name });
              }}
            />
            <EmployeePicker
              label={t('gold.common.supervisor2')}
              value={supervisor2.id}
              valueLabel={supervisor2.name}
              disabled={locked}
              onChange={(employeeId, name) => {
                setSupervisor2({ id: employeeId, name });
              }}
            />
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
              {t('gold.transfers.currentOwner')}
            </p>
            <Field label={t('gold.transfers.currentOwner')}>
              <Select
                value={currentOwnerId}
                disabled={locked}
                onChange={(e) => {
                  setCurrentOwnerId(e.target.value);
                  setCurrentDelegateId('');
                  setCurrentNationalId('');
                }}
              >
                <option value="">{t('gold.common.select')}</option>
                {companies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.transfers.currentOwnerDelegate')}>
              <Select
                value={currentDelegateId}
                disabled={locked || currentOwnerId === ''}
                onChange={(e) => {
                  setCurrentDelegateId(e.target.value);
                  setCurrentNationalId(
                    currentReps.data?.items.find((rep) => rep.id === e.target.value)?.nationalId ??
                      '',
                  );
                }}
              >
                <option value="">
                  {currentOwnerId === ''
                    ? t('gold.transfers.selectOwnerFirst')
                    : t('gold.receiving.selectDelegate')}
                </option>
                {(currentReps.data?.items ?? []).map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.common.nationalId')}>
              <Input
                value={currentNationalId}
                dir="ltr"
                disabled={locked}
                onChange={(e) => {
                  setCurrentNationalId(e.target.value);
                }}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
              {t('gold.transfers.newOwner')}
            </p>
            <Field label={t('gold.transfers.newOwner')}>
              <Select
                value={newOwnerId}
                disabled={locked}
                onChange={(e) => {
                  setNewOwnerId(e.target.value);
                  setNewDelegateId('');
                  setNewNationalId('');
                }}
              >
                <option value="">{t('gold.common.select')}</option>
                {companies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.transfers.newOwnerDelegate')}>
              <Select
                value={newDelegateId}
                disabled={locked || newOwnerId === ''}
                onChange={(e) => {
                  setNewDelegateId(e.target.value);
                  setNewNationalId(
                    newReps.data?.items.find((rep) => rep.id === e.target.value)?.nationalId ?? '',
                  );
                }}
              >
                <option value="">
                  {newOwnerId === ''
                    ? t('gold.transfers.selectOwnerFirst')
                    : t('gold.receiving.selectDelegate')}
                </option>
                {(newReps.data?.items ?? []).map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('gold.common.nationalId')}>
              <Input
                value={newNationalId}
                dir="ltr"
                disabled={locked}
                onChange={(e) => {
                  setNewNationalId(e.target.value);
                }}
              />
            </Field>
          </div>

          <Field label={t('gold.common.notes')}>
            <Textarea
              value={notes}
              disabled={locked}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </Field>
        </div>

        <div className="min-w-0">
          {locked ? (
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              {chosen.map((bar) => (
                <li key={bar.id} className="flex justify-between text-sm">
                  <span className="text-slate-700 dark:text-slate-200">
                    {[bar.serialNumber, bar.brand, bar.purity]
                      .filter((v) => v !== null && v !== '')
                      .join(' · ')}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('gold.common.grams', { value: fmtWeightValue(bar.weight) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('gold.transfers.pickBars')}
              </p>
              <BarPicker
                selected={selected}
                companyId={currentOwnerId === '' ? undefined : currentOwnerId}
                metalType={metalType === '' ? undefined : metalType}
                onChange={(ids, bars: GoldBarDto[]) => {
                  setSelected(ids);
                  setChosen(
                    bars.map((bar) => ({
                      id: bar.id,
                      serialNumber: bar.serialNumber,
                      weight: bar.weight,
                      brand: bar.brand,
                      purity: bar.purity,
                    })),
                  );
                }}
              />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
};
