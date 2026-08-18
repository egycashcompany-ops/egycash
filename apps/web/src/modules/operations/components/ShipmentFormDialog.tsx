// Create / edit a cash shipment — the legacy `/main_ops` add and edit modals.
//
// WHAT THE LEGACY FORM ACTUALLY WAS (discovery §E, contad_app.js:306-569): one handler with four
// non-exclusive `if` branches — create/edit × single/multi currency — where the multi-currency
// path walked SEVENTEEN fixed field pairs (`contractValue`..`contractValue17`) and kept the index
// pairs whose value was non-empty (quirk Q7). The single-currency path wrote a scalar where the
// multi path wrote an array (Q6), so the same field held two different shapes.
//
// Here there is ONE shape: a list of {currency, amount} lines, added and removed freely. The 17
// remains only as the contract's max, so a legacy record can always round-trip.
//
// The cascading pickers are legacy behaviour made server-truth: the from-branch list showed only
// the main bank's branches, and the to-branch list the destination bank's (main_ops.ejs:461-503).
// That was a client filter in legacy and is a server rule now (OPERATIONS_BRANCH_BANK_MISMATCH) —
// the form mirrors it so the operator is not offered a choice the server will refuse.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsShipmentDto,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { TrashIcon, PlusIcon } from '../../../shared/ui/icons';
import {
  useBranchesOfBank,
  useCreateOperationsShipment,
  useUpdateOperationsShipment,
} from '../api/operations-queries';

/** The contract's ceiling, inherited from the legacy form's 17 fixed currency slots (Q7). */
export const MAX_SHIPMENT_LINES = 17;

export interface DraftLine {
  currencyId: string;
  amount: string;
}

export const EMPTY_LINE: DraftLine = { currencyId: '', amount: '' };

/**
 * Only complete lines are sent. A blank row the operator added and never filled is not an error —
 * legacy compacted exactly this way, keeping the index pairs whose value was non-empty
 * (contad_app.js:386-398) — so it is dropped rather than rejected.
 */
export const toShipmentLines = (
  draft: readonly DraftLine[],
): { currencyId: string; amount: number }[] =>
  draft
    .filter((line) => line.currencyId !== '' && line.amount.trim() !== '')
    .map((line) => ({ currencyId: line.currencyId, amount: Number(line.amount) }));

/** A shipment needs at least one real line — the legacy server guard (contad_app.js:313). */
export const hasUsableLine = (draft: readonly DraftLine[]): boolean =>
  toShipmentLines(draft).length > 0;

/**
 * `deliveryDate` belongs to secured shipments only: legacy wrote `del_date: ""` for daily
 * (contad_app.js:353) and the contract rejects a daily shipment carrying one.
 */
export const deliveryDateFor = (
  shipmentType: OperationsShipmentType,
  raw: string,
): Date | null => (shipmentType === 'daily' || raw === '' ? null : new Date(raw));

const dateOnly = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

export const ShipmentFormDialog = ({
  open,
  shipment,
  defaultDate,
  banks,
  currencies,
  onClose,
}: {
  open: boolean;
  shipment: OperationsShipmentDto | null;
  /** The board's day — a new shipment defaults to the day being looked at, not to "today". */
  defaultDate: string;
  banks: OperationsBankDto[];
  currencies: OperationsCurrencyDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateOperationsShipment();
  const update = useUpdateOperationsShipment();
  const editing = shipment !== null;

  const [shipmentType, setShipmentType] = useState<OperationsShipmentType>('daily');
  const [mainBankId, setMainBankId] = useState('');
  const [secondaryBankId, setSecondaryBankId] = useState('');
  const [originBranchId, setOriginBranchId] = useState('');
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [areaName, setAreaName] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [serialTracked, setSerialTracked] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);

  useEffect(() => {
    if (!open) return;
    setShipmentType(shipment?.shipmentType ?? 'daily');
    setMainBankId(shipment?.mainBankId ?? '');
    setSecondaryBankId(shipment?.secondaryBankId ?? '');
    setOriginBranchId(shipment?.originBranchId ?? '');
    setDestinationBranchId(shipment?.destinationBranchId ?? '');
    setAreaName(shipment?.areaName ?? '');
    setCollectionDate(shipment === null ? defaultDate : dateOnly(shipment.collectionDate));
    setDeliveryDate(shipment === null ? '' : dateOnly(shipment.deliveryDate));
    setSerialTracked(shipment?.serialTracked ?? false);
    setNotes(shipment?.notes ?? '');
    setLines(
      shipment === null || shipment.lines.length === 0
        ? [EMPTY_LINE]
        : shipment.lines.map((line) => ({
            currencyId: line.currencyId,
            amount: String(line.amount),
          })),
    );
  }, [open, shipment, defaultDate]);

  // The destination side follows the secondary bank when one is chosen, else the main bank —
  // exactly what the legacy to-branch datalist did.
  const destinationBankId = secondaryBankId === '' ? mainBankId : secondaryBankId;
  const originBranches = useBranchesOfBank(mainBankId === '' ? null : mainBankId);
  const destinationBranches = useBranchesOfBank(destinationBankId === '' ? null : destinationBankId);

  // Changing a bank invalidates the branch chosen under the old one.
  useEffect(() => {
    if (!open) return;
    const list = originBranches.data?.items ?? [];
    if (originBranchId !== '' && list.length > 0 && !list.some((b) => b.id === originBranchId)) {
      setOriginBranchId('');
    }
  }, [originBranches.data, open]);
  useEffect(() => {
    if (!open) return;
    const list = destinationBranches.data?.items ?? [];
    if (
      destinationBranchId !== '' &&
      list.length > 0 &&
      !list.some((b) => b.id === destinationBranchId)
    ) {
      setDestinationBranchId('');
    }
  }, [destinationBranches.data, open]);

  const areaOptions = useMemo(() => {
    const names = (originBranches.data?.items ?? [])
      .map((branch) => branch.opsAreaName)
      .filter((name): name is string => name !== null);
    return [...new Set(names)];
  }, [originBranches.data]);

  const setLine = (index: number, patch: Partial<DraftLine>): void =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!hasUsableLine(lines)) {
      toast.error(t('operations.shipment.needLine'));
      return;
    }
    const core = {
      mainBankId,
      secondaryBankId: secondaryBankId === '' ? null : secondaryBankId,
      originBranchId,
      destinationBranchId,
      areaName: areaName.trim() === '' ? null : areaName.trim(),
      lines: toShipmentLines(lines),
      // The contract types dates post-coercion, and JSON.stringify serialises a Date to ISO —
      // which is exactly what the server coerces back. A raw yyyy-mm-dd string would not typecheck.
      collectionDate: new Date(collectionDate),
      deliveryDate: deliveryDateFor(shipmentType, deliveryDate),
      serialTracked,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      if (shipment === null) await create.mutateAsync({ ...core, shipmentType });
      // `shipmentType` is immutable — legacy has no path that converts one type into the other.
      else await update.mutateAsync({ id: shipment.id, body: { ...core, version: shipment.version } });
      toast.success(t('operations.shipment.saved'));
      onClose();
    } catch {
      toast.error(t('operations.shipment.saveFailed'));
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t(editing ? 'operations.shipment.edit' : 'operations.shipment.add')}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('operations.shipment.type')} required>
            <Select
              value={shipmentType}
              onChange={(e) => setShipmentType(e.target.value as OperationsShipmentType)}
              disabled={editing}
            >
              <option value="daily">{t('operations.shipment.type.daily')}</option>
              <option value="secured">{t('operations.shipment.type.secured')}</option>
            </Select>
          </Field>
          <Field label={t('operations.shipment.collectionDate')} required>
            <Input
              type="date"
              value={collectionDate}
              onChange={(e) => setCollectionDate(e.target.value)}
              required
            />
          </Field>
          <Field label={t('operations.shipment.mainBank')} required>
            <Select
              value={mainBankId}
              onChange={(e) => setMainBankId(e.target.value)}
              required
            >
              <option value="">{t('common.select')}</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.opsName}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('operations.shipment.secondaryBank')}
            hint={t('operations.shipment.secondaryBankHint')}
          >
            <Select value={secondaryBankId} onChange={(e) => setSecondaryBankId(e.target.value)}>
              <option value="">{t('operations.shipment.sameBank')}</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.opsName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('operations.shipment.origin')} required>
            <Select
              value={originBranchId}
              onChange={(e) => setOriginBranchId(e.target.value)}
              required
              disabled={mainBankId === ''}
            >
              <option value="">{t('common.select')}</option>
              {(originBranches.data?.items ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('operations.shipment.destination')} required>
            <Select
              value={destinationBranchId}
              onChange={(e) => setDestinationBranchId(e.target.value)}
              required
              disabled={destinationBankId === ''}
            >
              <option value="">{t('common.select')}</option>
              {(destinationBranches.data?.items ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('operations.shipment.area')}>
            <Input
              list="operations-area-options"
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
            />
            <datalist id="operations-area-options">
              {areaOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          {shipmentType === 'secured' && (
            <Field
              label={t('operations.shipment.deliveryDate')}
              hint={t('operations.shipment.deliveryDateHint')}
            >
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>
          )}
        </div>

        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('operations.shipment.lines')}
          </legend>
          {lines.map((line, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  aria-label={t('operations.shipment.currency')}
                  value={line.currencyId}
                  onChange={(e) => setLine(index, { currencyId: e.target.value })}
                >
                  <option value="">{t('operations.shipment.currency')}</option>
                  {currencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <MoneyInput
                  aria-label={t('operations.shipment.amount')}
                  placeholder={t('operations.shipment.amount')}
                  value={line.amount}
                  onChange={(next) => setLine(index, { amount: next })}
                />
              </div>
              <button
                type="button"
                aria-label={t('common.remove')}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={lines.length >= MAX_SHIPMENT_LINES}
            onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
          >
            <PlusIcon className="h-4 w-4" />
            {t('operations.shipment.addLine')}
          </Button>
        </fieldset>

        <Field label={t('operations.shipment.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={serialTracked}
            onChange={(e) => setSerialTracked(e.target.checked)}
            className="h-4 w-4"
          />
          {t('operations.shipment.serialTracked')}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
