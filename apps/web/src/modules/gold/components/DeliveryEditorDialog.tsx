// عمليات الخروج — the delivery-order editor.
//
// Simpler than receiving because the bars already exist: the left side records WHO is taking them
// and WHO in the vault signed for it, and the right side is the selection. Approving is what marks
// the bars delivered and empties their drawers, so a confirmed order is read-only.
import { useEffect, useState } from 'react';
import {
  type CreateGoldDelivery,
  type GoldBarDto,
  type GoldDeliveryReceiptDto,
  type GoldMetalType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { CheckIcon, PrinterIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { deliveryNextNumber, printDelivery } from '../api/gold-api';
import {
  useConfirmGoldDelivery,
  useCreateGoldDelivery,
  useGoldRepresentatives,
  useUpdateGoldDelivery,
} from '../api/gold-queries';
import { BarPicker } from './BarPicker';
import { EmployeePicker } from './EmployeePicker';
import { metalLabel, metalOptions } from './gold-labels';
import { useGoldCompanyOptions } from './useGoldCompanyOptions';
import { fmtWeightValue, toDateInput, todayInput } from '../lib/gold-format';
import { printReceiptHtml } from '../lib/gold-print';

export const DeliveryEditorDialog = ({
  existing,
  loading,
  onClose,
}: {
  existing: GoldDeliveryReceiptDto | null;
  loading: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const companies = useGoldCompanyOptions();
  const create = useCreateGoldDelivery();
  const update = useUpdateGoldDelivery();
  const confirm = useConfirmGoldDelivery();

  const [id, setId] = useState<string | null>(existing?.id ?? null);
  const [version, setVersion] = useState(existing?.version ?? 0);
  const [number, setNumber] = useState(existing?.receiptNumber ?? '');
  const [receiptDate, setReceiptDate] = useState(
    existing === null ? todayInput() : toDateInput(existing.receiptDate),
  );
  const [companyId, setCompanyId] = useState(existing?.companyId ?? '');
  const [metalType, setMetalType] = useState<GoldMetalType | ''>(existing?.metalType ?? '');
  const [representativeId, setRepresentativeId] = useState(existing?.representativeId ?? '');
  const [nationalId, setNationalId] = useState(existing?.nationalId ?? '');
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

  // A confirmed OR reverted order is history: neither can be edited again.
  const locked = existing?.status === 'confirmed' || existing?.status === 'reverted';
  const reps = useGoldRepresentatives({ companyId, pageSize: 200 }, companyId !== '');

  useEffect(() => {
    if (id !== null || number !== '') return;
    void deliveryNextNumber()
      .then((next) => {
        setNumber(next.number);
      })
      .catch(() => null);
  }, [id, number]);

  const total = chosen.reduce((sum, bar) => sum + bar.weight, 0);

  const payload = (): CreateGoldDelivery => ({
    receiptDate: new Date(receiptDate),
    companyId: companyId === '' ? null : companyId,
    metalType: metalType === '' ? null : metalType,
    representativeId: representativeId === '' ? null : representativeId,
    nationalId: nationalId === '' ? null : nationalId,
    supervisor1EmployeeId: supervisor1.id === '' ? null : supervisor1.id,
    supervisor2EmployeeId: supervisor2.id === '' ? null : supervisor2.id,
    notes: notes === '' ? null : notes,
    barIds: selected,
  });

  const persist = async (): Promise<GoldDeliveryReceiptDto> => {
    if (id === null) {
      const saved = await create.mutateAsync(payload());
      setId(saved.id);
      setVersion(saved.version);
      setNumber(saved.receiptNumber);
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
      toast.success(t('gold.delivery.confirmed'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('gold.receiving.confirmFailed'));
    }
  };

  const doPrint = async (): Promise<void> => {
    if (id !== null) await printDelivery(id).catch(() => null);
    const rep = reps.data?.items.find((r) => r.id === representativeId);
    const ok = printReceiptHtml({
      title: t('gold.delivery.printTitle'),
      number: number === '' ? t('gold.receiving.printDraft') : number,
      branch: existing?.branchName ?? '',
      meta: [
        [t('gold.common.date'), receiptDate],
        [t('gold.delivery.owner'), companies.find((c) => c.value === companyId)?.label ?? '—'],
        [t('gold.common.metalType'), metalType === '' ? '—' : metalLabel(t, metalType)],
        [
          t('gold.delivery.receiver'),
          `${rep?.fullName ?? '—'}${nationalId === '' ? '' : ` — ${nationalId}`}`,
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
    ? t('gold.delivery.viewTitle', { number })
    : id !== null
      ? t('gold.delivery.editTitle', { number })
      : t('gold.delivery.newTitle');

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
            <Can permission="goldDelivery.print">
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
              <Can permission="goldDelivery.confirm">
                <Button
                  leftIcon={<CheckIcon className="h-4 w-4" />}
                  loading={confirm.isPending}
                  onClick={() => void doConfirm()}
                >
                  {t('gold.delivery.confirm')}
                </Button>
              </Can>
            )}
          </span>
        </div>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label={t('gold.common.date')}>
            <Input
              type="date"
              value={receiptDate}
              disabled={locked}
              onChange={(e) => {
                setReceiptDate(e.target.value);
              }}
            />
          </Field>
          <Field label={t('gold.delivery.number')}>
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
          <Field label={t('gold.delivery.owner')}>
            <Select
              value={companyId}
              disabled={locked}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setRepresentativeId('');
                setNationalId('');
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
          <Field label={t('gold.delivery.receiver')}>
            <Select
              value={representativeId}
              disabled={locked || companyId === ''}
              onChange={(e) => {
                setRepresentativeId(e.target.value);
                setNationalId(
                  reps.data?.items.find((rep) => rep.id === e.target.value)?.nationalId ?? '',
                );
              }}
            >
              <option value="">
                {companyId === ''
                  ? t('gold.delivery.selectOwnerFirst')
                  : t('gold.receiving.selectDelegate')}
              </option>
              {(reps.data?.items ?? []).map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('gold.common.nationalId')}>
            <Input
              value={nationalId}
              dir="ltr"
              disabled={locked}
              onChange={(e) => {
                setNationalId(e.target.value);
              }}
            />
          </Field>
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
          <div className="sm:col-span-2">
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
        </div>

        <div className="min-w-0">
          {locked ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
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
                {t('gold.delivery.pickBars')}
                {(metalType !== '' || companyId !== '') && t('gold.delivery.pickBarsFiltered')}
              </p>
              <BarPicker
                selected={selected}
                companyId={companyId === '' ? undefined : companyId}
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
