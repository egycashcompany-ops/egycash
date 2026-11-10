// Create / edit a cash shipment — the legacy `/main_ops` add and edit forms, in the Fleet forms'
// design («عدل الـ ui بتاع الفورم … زى الحركة»: `DesignDialog`, the shape every Fleet entry form
// takes).
//
// THE THREE BANKS, as the owner described them and as legacy drew them (main_ops.ejs:405-433):
//   · البنك الرئيسي — the bank BILLED for the shipment (`mainBankId`). Every per-bank roll-up keys
//     on it, in legacy and here.
//   · «من فرع» — a bank chooser above the branch box: the bank the money is collected FROM. Not a
//     stored field (legacy never posted it, :420); the origin branch carries its own bank.
//   · «إلى فرع» — the same, for where the money goes; stored as `secondaryBankId` when it is not
//     the main bank (legacy `sec_bank`).
// Both sides start on the main bank and follow it while untouched (`followMainBank`).
//
// «المنطقة» is filled from the TO branch's operations area when that branch is picked, and stays
// editable — legacy main_ops.ejs:520-531.
//
// «اسم القائد وكود العربيه»: two boxes over ONE choice — a crew row of the collection date's plan.
// Picking a vehicle names the captain on it; picking a captain names his vehicle. Only on CREATE:
// re-crewing a saved shipment moves a stop between captains' ordered days, which is not an edit.
//
// WHAT THE LEGACY FORM WAS (discovery §E, contad_app.js:306-569): one handler with four
// non-exclusive branches — create/edit × single/multi currency — where the multi-currency path
// walked SEVENTEEN fixed field pairs (quirk Q7). Here there is ONE shape: a list of
// {currency, amount} lines. The 17 remains only as the contract's max.
import { useEffect, useId, useMemo, useState } from 'react';
import {
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsShipmentDto,
  type OperationsShipmentType,
  MAX_PAGE_SIZE,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { Combobox } from '../../../shared/ui/Combobox';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { Checkbox, Input, Select, Textarea } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { useAppSelector } from '../../../store';
import { TrashIcon, PlusIcon } from '../../../shared/ui/icons';
import {
  DesignCancel,
  DesignDialog,
  DesignSave,
  DesignSection,
} from '../../fleet/components/DesignDialog';
import {
  DesignField,
  LOOK,
  MONO,
  boxTone,
  carBoxClass,
} from '../../fleet/components/FuelCardDialog';
import {
  useBankBranch,
  useCreateOperationsShipment,
  useOperationsAreas,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useUpdateOperationsShipment,
} from '../api/operations-queries';
import {
  chooseVehicle,
  dispatchCrewOptions,
  findDispatchOption,
  vehiclesOf,
} from '../lib/dispatch-crew';
import {
  areaOfDestination,
  followMainBank,
  secondaryBankFor,
  shipmentSaveErrorKey,
} from '../lib/shipment-form';
import { BankBranchDialog } from './CatalogDialogs';
import { ShipmentBranchSide } from './ShipmentBranchSide';
import { SHIPMENT_PATH } from './shipment-icons';

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
export const deliveryDateFor = (shipmentType: OperationsShipmentType, raw: string): Date | null =>
  shipmentType === 'daily' || raw === '' ? null : new Date(raw);

/**
 * The currency a new line starts on: the domestic one — legacy's form opened on «مصري»
 * (main_ops.ejs:376-387). Found by its code (`EGP`, as the reports know it) or a legacy alias.
 */
export const defaultCurrencyId = (currencies: readonly OperationsCurrencyDto[]): string =>
  (
    currencies.find((c) => c.code === 'EGP') ??
    currencies.find((c) => c.legacyAliases.includes('مصري') || c.name === 'مصري')
  )?.id ?? '';

const dateOnly = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

/** A board row carries its branches and crew resolved; a plain shipment does not. */
const boardRow = (
  shipment: OperationsShipmentDto | OperationsDayBoardShipmentDto | null,
): OperationsDayBoardShipmentDto | null =>
  shipment !== null && 'origin' in shipment ? shipment : null;

export const ShipmentFormDialog = ({
  open,
  shipment,
  defaultDate,
  banks,
  currencies,
  createType,
  onClose,
}: {
  open: boolean;
  /**
   * The kind a NEW shipment is — decided by the screen, not chosen in the form. «عاوز اضافة شحنة
   * اشيل النوع ويكون يومى بس»: the day board adds daily shipments; the secured backlog (legacy
   * `/mohsana`, where secured shipments were always created) adds secured ones. An edit keeps the
   * shipment's own type — it never changes (legacy had no path between the two).
   */
  createType: OperationsShipmentType;
  /** A board row (with its branches resolved) or a plain shipment; null creates one. */
  shipment: OperationsShipmentDto | OperationsDayBoardShipmentDto | null;
  /** The board's day — a new shipment defaults to the day being looked at, not to "today". */
  defaultDate: string;
  banks: OperationsBankDto[];
  currencies: OperationsCurrencyDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const can = useCan();
  const create = useCreateOperationsShipment();
  const update = useUpdateOperationsShipment();
  const editing = shipment !== null;
  const row = boardRow(shipment);
  const shipmentType: OperationsShipmentType = shipment?.shipmentType ?? createType;

  const [mainBankId, setMainBankId] = useState('');
  const [fromBankId, setFromBankId] = useState('');
  const [toBankId, setToBankId] = useState('');
  const [originBranchId, setOriginBranchId] = useState('');
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [areaName, setAreaName] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [serialTracked, setSerialTracked] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);
  const [crewKey, setCrewKey] = useState('');
  /** The catalogs' branch form, opened over this one for a branch that is not there yet. */
  const [adding, setAdding] = useState<{
    side: 'origin' | 'destination';
    bankId: string;
    name: string;
  } | null>(null);

  const activeBanks = useMemo(() => banks.filter((bank) => bank.isActive), [banks]);
  const activeCurrencies = useMemo(() => currencies.filter((c) => c.isActive), [currencies]);

  useEffect(() => {
    if (!open) return;
    setMainBankId(shipment?.mainBankId ?? '');
    // The from-bank is the origin branch's own; a board row has it, a plain shipment is read below.
    setFromBankId(row?.origin?.bankId ?? '');
    setToBankId(shipment === null ? '' : (shipment.secondaryBankId ?? shipment.mainBankId));
    setOriginBranchId(shipment?.originBranchId ?? '');
    setDestinationBranchId(shipment?.destinationBranchId ?? '');
    setAreaName(shipment?.areaName ?? '');
    setCollectionDate(shipment === null ? defaultDate : dateOnly(shipment.collectionDate));
    setDeliveryDate(shipment === null ? '' : dateOnly(shipment.deliveryDate));
    setSerialTracked(shipment?.serialTracked ?? false);
    setNotes(shipment?.notes ?? '');
    setLines(
      shipment === null || shipment.lines.length === 0
        ? [{ currencyId: defaultCurrencyId(activeCurrencies), amount: '' }]
        : shipment.lines.map((line) => ({
            currencyId: line.currencyId,
            amount: String(line.amount),
          })),
    );
    setCrewKey('');
    setAdding(null);
    // `row` and the currencies are read on OPEN only — the form is the operator's from then on.
  }, [open, shipment, defaultDate]);

  // Editing a plain shipment (the secured backlog's): its origin branch names the from-bank.
  const heldOrigin = useBankBranch(open && editing && row === null ? originBranchId : '');
  useEffect(() => {
    if (fromBankId === '' && heldOrigin.data !== undefined) setFromBankId(heldOrigin.data.bankId);
  }, [heldOrigin.data, fromBankId]);

  // ── The three banks ────────────────────────────────────────────────────────────────────────────
  const changeMainBank = (next: string): void => {
    const nextFrom = followMainBank(fromBankId, mainBankId, next);
    const nextTo = followMainBank(toBankId, mainBankId, next);
    if (nextFrom !== fromBankId) setOriginBranchId('');
    if (nextTo !== toBankId) {
      // The area is the destination branch's: no branch, no area.
      setDestinationBranchId('');
      setAreaName('');
    }
    setFromBankId(nextFrom);
    setToBankId(nextTo);
    setMainBankId(next);
  };
  const changeSideBank = (side: 'origin' | 'destination', next: string): void => {
    if (side === 'origin') {
      if (next !== fromBankId) setOriginBranchId('');
      setFromBankId(next);
    } else {
      if (next !== toBankId) {
        setDestinationBranchId('');
        setAreaName('');
      }
      setToBankId(next);
    }
  };
  const pickBranch = (
    side: 'origin' | 'destination',
    branch: OperationsBankBranchDto | null,
  ): void => {
    if (side === 'origin') {
      setOriginBranchId(branch?.id ?? '');
      return;
    }
    setDestinationBranchId(branch?.id ?? '');
    setAreaName(areaOfDestination(branch));
  };

  // The area catalog — the branch form opened from here offers it for the new branch's area.
  const areas = useOperationsAreas({ page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'name' }, open);
  const canAddBranch = can('operationsCatalog.manage');

  const setLine = (index: number, patch: Partial<DraftLine>): void =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  // ── The collection crew (legacy leader1 + car_num1, written at creation) ──────────────────────
  //
  // Read from the collection date's crew plan; both boxes edit the SAME choice (`crewKey`, one
  // crew row and one of its captains), so they cannot disagree.
  const canSeeCrew = can('operationsCrew.view');
  const crewHintId = useId();
  const crewOn = open && !editing && canSeeCrew && collectionDate !== '';
  const crewBoard = useOperationsCrewBoard(crewOn ? collectionDate : null, crewOn);
  const crewDirectory = useOperationsCrewDirectory(crewOn ? collectionDate : null, crewOn);
  const crewOptions = useMemo(
    () => dispatchCrewOptions(crewBoard.data?.rows ?? []),
    [crewBoard.data],
  );
  const chosenCrew = findDispatchOption(crewOptions, crewKey);
  // The day changed under the choice — a crew belongs to a date, so a stale pick would be refused
  // (OPERATIONS_CREW_DAY_MISMATCH).
  useEffect(() => setCrewKey(''), [collectionDate]);

  const captainName = (employeeId: string): string =>
    crewDirectory.data?.members.find((m) => m.employeeId === employeeId)?.fullNameAr ?? '…';
  // A captain named twice (two vans — the plan forbids it, but a stale plan could) says which van.
  const captainLabel = (key: string): string => {
    const option = findDispatchOption(crewOptions, key);
    if (option === undefined) return key;
    const twice =
      crewOptions.filter((o) => o.captainEmployeeId === option.captainEmployeeId).length > 1;
    const name = captainName(option.captainEmployeeId);
    return twice ? `${name} — ${option.vehicleCode}` : name;
  };
  const vehicles = vehiclesOf(crewOptions);

  // ── Required fields ────────────────────────────────────────────────────────────────────────────
  const required = useRequiredFields(
    [
      { key: 'mainBank', label: t('operations.shipment.form.mainBank'), ok: mainBankId !== '' },
      { key: 'origin', label: t('operations.shipment.origin'), ok: originBranchId !== '' },
      {
        key: 'destination',
        label: t('operations.shipment.destination'),
        ok: destinationBranchId !== '',
      },
      {
        key: 'collectionDate',
        label: t('operations.shipment.form.date'),
        ok: collectionDate !== '',
      },
      { key: 'amount', label: t('operations.shipment.form.amount'), ok: hasUsableLine(lines) },
      // NOT the delivery date of a secured shipment: the contract keeps it nullable, legacy never
      // required it (receive_mohsana.ejs:644), and a date invented to get past the form would put
      // the shipment on that day's dispatch list.
    ],
    open,
  );

  const submit = async (): Promise<void> => {
    const core = {
      mainBankId,
      secondaryBankId: secondaryBankFor(mainBankId, toBankId),
      originBranchId,
      destinationBranchId,
      areaName: areaName.trim() === '' ? null : areaName.trim(),
      lines: toShipmentLines(lines),
      // The contract types dates post-coercion, and JSON.stringify serialises a Date to ISO —
      // which is exactly what the server coerces back.
      collectionDate: new Date(collectionDate),
      deliveryDate: deliveryDateFor(shipmentType, deliveryDate),
      serialTracked,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      if (shipment === null) {
        await create.mutateAsync({
          ...core,
          shipmentType,
          // The VEHICLE IS NOT SENT. `crewAssignmentId` is a (day, vehicle) row, so the vehicle is
          // a fact the server reads off it — a client that named its own could claim a captain was
          // on a van he was never planned onto.
          pickup:
            chosenCrew === undefined
              ? null
              : {
                  crewAssignmentId: chosenCrew.crewAssignmentId,
                  captainEmployeeId: chosenCrew.captainEmployeeId,
                },
        });
      }
      // `shipmentType` is immutable — legacy has no path that converts one type into the other.
      else
        await update.mutateAsync({ id: shipment.id, body: { ...core, version: shipment.version } });
      toast.success(t('operations.shipment.saved'));
      onClose();
    } catch (error) {
      // The mutations leave their errors to this form (operations-queries.ts), so this is the one
      // message — in the reader's language, naming the reason where the server gave one, and the
      // shared wording when the reason is not the values at all (a dropped connection, no rights).
      const key = shipmentSaveErrorKey(error);
      toast.error(key === null ? errorMessage(error, locale) : t(key));
    }
  };

  const busy = create.isPending || update.isPending;

  // The design's boxes.
  const box = boxTone(LOOK.add);
  const selectBox = cn(
    '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
    '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
  );
  const mainMissing = required.isMissing('mainBank');

  return (
    <>
      <DesignDialog
        open={open}
        // Escape inside the branch form closes THAT form; this one must not close with it. Both are
        // DesignDialogs listening on the window, in whatever order React last registered them:
        // only the dialog on top of the `[data-dialog-root]` stack answers, and it marks the key
        // handled for a listener that runs after it. `adding` alone is not enough — a real key
        // press lets React commit `adding = null` and re-register this listener before the event
        // reaches it. The check stays for the × and «إلغاء» while the branch form is up.
        onClose={() => {
          if (adding === null) onClose();
        }}
        title={t(editing ? 'operations.shipment.edit' : 'operations.shipment.add')}
        subtitle={t('operations.shipment.form.subtitle')}
        icon={SHIPMENT_PATH.shipment}
        width="6xl"
        dense
        panelProps={{ 'data-shipment-form': editing ? 'edit' : 'new' }}
        footer={
          <>
            <DesignSave
              data-shipment-save="true"
              busy={busy}
              onClick={required.guard(() => void submit())}
            />
            <DesignCancel onClick={onClose} />
          </>
        }
      >
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />

        {/* «الفورم … كبيرة انها متهكنش فيها اسكرول»: ONE band of three columns on a wide panel —
            the shipment, its two branches, then the money and the crew — so the form is as tall as
            its tallest column rather than the sum of its rows, and fits a laptop screen. One
            column on a narrow screen. */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
          <DesignSection
            title={t('operations.shipment.form.sections.shipment')}
            icon={SHIPMENT_PATH.calendar}
          >
            {/* What «الرئيسي» means is the form's subtitle («البنك المُحاسب…»); a hint here too
                would cost the line that keeps the form on a laptop screen without a scroll. */}
            <DesignField
              label={t('operations.shipment.form.mainBank')}
              required
              missing={mainMissing}
            >
              <div
                className={cn(
                  carBoxClass(false),
                  mainMissing &&
                    '[&_input]:!border-rose-500/70 [&_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] [&_input]:!pe-28 [&_.end-2]:!end-10',
                )}
              >
                <Combobox
                  value={mainBankId}
                  options={activeBanks.map((bank) => bank.id)}
                  optionLabel={(id) => banks.find((bank) => bank.id === id)?.opsName ?? id}
                  onChange={changeMainBank}
                  placeholder={t('operations.shipment.form.pickBank')}
                  emptyText={t('common.noResults')}
                  clearLabel={t('common.clear')}
                  ariaLabel={t('operations.shipment.form.mainBank')}
                  testId="main-bank"
                />
              </div>
            </DesignField>
            <DesignField
              label={t('operations.shipment.form.date')}
              required
              missing={required.isMissing('collectionDate')}
              datePicker
            >
              <Input
                type="date"
                dir="ltr"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                tone={cn(box, MONO)}
                data-shipment-date="true"
              />
            </DesignField>
            {shipmentType === 'secured' && (
              <DesignField
                label={t('operations.shipment.deliveryDate')}
                hint={t('operations.shipment.deliveryDateHint')}
                datePicker
              >
                <Input
                  type="date"
                  dir="ltr"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  tone={cn(box, MONO)}
                />
              </DesignField>
            )}
            <DesignField label={t('operations.shipment.notes')}>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={1}
                aria-label={t('operations.shipment.notes')}
                // The select's tone, not `box`: a Textarea has no `tone` slot, and only `!`-classes
                // beat its own background (the Accident form's notes box does the same).
                className={cn(selectBox, '!pe-4')}
              />
            </DesignField>
            <Checkbox
              label={t('operations.shipment.serialTracked')}
              checked={serialTracked}
              onChange={(e) => setSerialTracked(e.target.checked)}
            />
          </DesignSection>

          <DesignSection
            title={t('operations.shipment.form.sections.route')}
            icon={SHIPMENT_PATH.route}
          >
            <div className="space-y-4">
              <ShipmentBranchSide
                side="origin"
                title={t('operations.shipment.origin')}
                banks={banks}
                bankId={fromBankId}
                onBankChange={(next) => changeSideBank('origin', next)}
                branchId={originBranchId}
                onBranchChange={(branch) => pickBranch('origin', branch)}
                known={row?.origin ?? null}
                canCreate={canAddBranch}
                onRequestCreate={(bankId, name) => setAdding({ side: 'origin', bankId, name })}
                branchMissing={required.isMissing('origin')}
              />
              <ShipmentBranchSide
                side="destination"
                title={t('operations.shipment.destination')}
                banks={banks}
                bankId={toBankId}
                onBankChange={(next) => changeSideBank('destination', next)}
                branchId={destinationBranchId}
                onBranchChange={(branch) => pickBranch('destination', branch)}
                known={row?.destination ?? null}
                canCreate={canAddBranch}
                onRequestCreate={(bankId, name) => setAdding({ side: 'destination', bankId, name })}
                branchMissing={required.isMissing('destination')}
              >
                {/* «المنطقة … تحت الفرع اللى الى»: under the TO branch, read only — it is that
                    branch's, so typing it would only let the two disagree. */}
                <div
                  className="flex items-center gap-3"
                  title={t('operations.shipment.form.areaHint')}
                >
                  <span className="shrink-0 text-[15px] font-bold text-slate-900 dark:text-white">
                    {t('operations.shipment.area')}
                  </span>
                  <div
                    role="textbox"
                    aria-readonly="true"
                    // A read-only textbox stays in the Tab order, so a keyboard reader meets it.
                    tabIndex={0}
                    aria-label={t('operations.shipment.area')}
                    aria-description={t('operations.shipment.form.areaHint')}
                    data-shipment-area="true"
                    className={cn(
                      'flex min-h-[2.5rem] flex-1 items-center rounded-xl border px-4 text-[15px] font-medium',
                      'border-dashed border-slate-300 bg-slate-100/70 text-slate-900 dark:border-[#2b3b6b] dark:bg-[#0a1233]/50 dark:text-white',
                    )}
                  >
                    {areaName === '' ? (
                      <span className="text-sm text-slate-400 dark:text-slate-500">
                        {t('operations.shipment.form.areaEmpty')}
                      </span>
                    ) : (
                      areaName
                    )}
                  </div>
                </div>
              </ShipmentBranchSide>
            </div>
          </DesignSection>

          <div className="space-y-5">
            {/* «+ إضافة عملة» sits on the section's own title line, and only the first line
                carries the boxes' names: a shipment of several currencies (the owner's own
                example has four) grows by a box's height a currency, not a labelled field's. */}
            <div className="relative">
              <DesignSection
                title={t('operations.shipment.form.sections.money')}
                icon={SHIPMENT_PATH.money}
              >
                <div className="space-y-2">
                  {lines.map((line, index) => {
                    const currencyBox = (
                      <Select
                        value={line.currencyId}
                        onChange={(e) => setLine(index, { currencyId: e.target.value })}
                        className={selectBox}
                        aria-label={`${t('operations.shipment.currency')} ${index + 1}`}
                      >
                        <option value="">{t('common.select')}</option>
                        {activeCurrencies.map((currency) => (
                          <option key={currency.id} value={currency.id}>
                            {currency.name}
                          </option>
                        ))}
                      </Select>
                    );
                    const amountBox = (
                      <MoneyInput
                        value={line.amount}
                        onChange={(amount) => setLine(index, { amount })}
                        tone={cn(box, MONO, 'text-right')}
                        aria-label={`${t('operations.shipment.form.amount')} ${index + 1}`}
                        data-shipment-amount={String(index)}
                      />
                    );
                    return (
                      // Lines have no identity of their own until saved; the index IS the slot.
                      <div
                        key={index}
                        className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)_auto] items-end gap-2"
                      >
                        {index === 0 ? (
                          <>
                            <DesignField
                              label={t('operations.shipment.currency')}
                              missing={required.isMissing('amount')}
                            >
                              {currencyBox}
                            </DesignField>
                            <DesignField
                              label={t('operations.shipment.form.amount')}
                              required
                              missing={required.isMissing('amount')}
                            >
                              {amountBox}
                            </DesignField>
                          </>
                        ) : (
                          <>
                            {currencyBox}
                            <div className="relative">{amountBox}</div>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                          disabled={lines.length === 1}
                          aria-label={`${t('common.remove')} ${index + 1}`}
                          className="mb-1 rounded-xl border border-slate-200 p-3 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-500 disabled:opacity-40 dark:border-[#2b3b6b] dark:text-slate-400"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </DesignSection>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
                disabled={lines.length >= MAX_SHIPMENT_LINES}
                data-shipment-add-line="true"
                className="absolute end-0 top-0 inline-flex items-center gap-1 rounded-lg border border-dashed border-indigo-300 px-2.5 py-1 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {t('operations.shipment.addLine')}
              </button>
            </div>

            <DesignSection
              title={t('operations.shipment.form.sections.crew')}
              icon={SHIPMENT_PATH.crew}
            >
              {editing ? (
                // Re-crewing a saved shipment is not an edit — it moves a stop between captains'
                // ordered days. What it rides with now is shown, read only.
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200">
                  {row?.crew != null
                    ? t('operations.shipment.form.crewHeld', {
                        captain: row.crew.captainName ?? '—',
                        vehicle: row.crew.vehicleCode ?? '—',
                      })
                    : // «No crew yet» is a fact only where this form KNOWS the legs: a day-board row
                      // reports the pickup leg of a daily shipment. A secured row reports its delivery
                      // leg (a pickup may exist), and a shipment opened from elsewhere (the secured
                      // backlog) carries no legs at all — for those, say where the crew is set.
                      t(
                        row !== null && row.shipmentType === 'daily'
                          ? 'operations.shipment.form.crewNotOnEdit'
                          : 'operations.shipment.form.crewElsewhere',
                      )}
                </p>
              ) : !canSeeCrew ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('operations.shipment.form.crewNoAccess')}
                </p>
              ) : (
                <>
                  {/* How the two boxes pick each other, said to a screen reader on both of them — a
                    visible line would cost the height that keeps the form without a scroll. */}
                  <span id={crewHintId} className="sr-only">
                    {t('operations.shipment.form.crewHint')}
                  </span>
                  <div
                    className="grid grid-cols-1 items-start gap-4"
                    title={t('operations.shipment.form.crewHint')}
                  >
                    <DesignField label={t('operations.shipment.form.captain')}>
                      <div className={carBoxClass(false)}>
                        <Combobox
                          value={crewKey}
                          options={crewOptions.map((option) => option.key)}
                          optionLabel={captainLabel}
                          onChange={setCrewKey}
                          placeholder={t('operations.shipment.noCrew')}
                          emptyText={t(crewBoard.isLoading ? 'common.loading' : 'common.noResults')}
                          clearLabel={t('common.clear')}
                          ariaLabel={t('operations.shipment.form.captain')}
                          testId="shipment-captain"
                          ariaDescribedBy={crewHintId}
                        />
                      </div>
                    </DesignField>
                    <DesignField label={t('operations.shipment.form.vehicle')}>
                      <div className={carBoxClass(false)}>
                        <Combobox
                          value={chosenCrew?.vehicleId ?? ''}
                          options={vehicles.map((vehicle) => vehicle.vehicleId)}
                          optionLabel={(id) =>
                            vehicles.find((vehicle) => vehicle.vehicleId === id)?.vehicleCode ?? id
                          }
                          onChange={(vehicleId) =>
                            setCrewKey(
                              vehicleId === ''
                                ? ''
                                : (chooseVehicle(
                                    crewOptions,
                                    vehicleId,
                                    chosenCrew?.captainEmployeeId ?? '',
                                  )?.key ?? ''),
                            )
                          }
                          placeholder={t('operations.shipment.noCrew')}
                          emptyText={t(crewBoard.isLoading ? 'common.loading' : 'common.noResults')}
                          clearLabel={t('common.clear')}
                          ariaLabel={t('operations.shipment.form.vehicle')}
                          testId="shipment-vehicle"
                          ariaDescribedBy={crewHintId}
                        />
                      </div>
                    </DesignField>
                  </div>
                  {/* Only the warning keeps a line of its own; how the two boxes pick each other is said
                    by the boxes' title, so the form fits a laptop screen with no scroll. */}
                  {crewOptions.length === 0 && !crewBoard.isLoading && (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      {t('operations.shipment.noCrewForDay')}
                    </p>
                  )}
                </>
              )}
            </DesignSection>
          </div>
        </div>
      </DesignDialog>

      {/* «يظهر موديل كدا انه يضيف باقى البيانات»: the catalogs screen's own branch form, opened with
          the bank and the typed name; the branch it saves is picked on the side that asked. */}
      <BankBranchDialog
        open={adding !== null}
        branch={null}
        banks={activeBanks}
        areas={areas.data?.items ?? []}
        {...(adding === null ? {} : { initial: { bankId: adding.bankId, name: adding.name } })}
        onSaved={(saved) => {
          if (adding === null) return;
          if (adding.side === 'origin') {
            setFromBankId(saved.bankId);
          } else {
            setToBankId(saved.bankId);
          }
          pickBranch(adding.side, saved);
        }}
        onClose={() => setAdding(null)}
      />
    </>
  );
};
