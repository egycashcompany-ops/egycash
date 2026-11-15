// The shipment's data as a form edits it — ONE set of state, rules and boxes, shared by the two
// forms that edit it:
//
//   · the shipment form (`ShipmentFormDialog`) — add and edit, on the boards;
//   · Round 18's «إستلام محصنة» (`ReceiveIntoVaultDialog`) — «عاوز اخلى الفورم دا لما اجى استلم
//     محصنة», where the vault may correct the shipment's data before it receives it («تعدّلها
//     عادي»): the same banks → branches, the same area, the same money lines in the catalog's
//     order, the same date rules — so the two forms cannot come to disagree about what a valid
//     shipment is. Only the LAYOUT is each form's own.
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
// «المنطقة» is filled from the TO branch's operations area when that branch is picked, and is not
// typed — legacy main_ops.ejs:520-531, «عاوز المنطقة ميقدر يكتب».
//
// «مينفعش لما يجى يضيف شحنه يختار تاريخ فات»: a new shipment opens on today and cannot be dated
// earlier; an edit cannot move a date earlier than the day it was on (`shipmentDateProblem`) — the
// collection date, and a secured shipment's delivery date, as the server holds them. The date boxes
// offer no earlier day, and one typed earlier is said in words on the box, and again if saved —
// before anything is sent.
//
// A محصنة's TWO DATES — «تاريخ المحصنة اجبارى … وتاريخ التسليم تانى يوم الاستلام افتراضى وممكن
// يغير»: the collection date («تاريخ الاستلام» on a محصنة) is required, as on every shipment; the
// delivery date opens on the day after it and FOLLOWS it while the person has not picked another
// (`followCollectionDate`), may be moved, is required of a new one, and never falls before the
// collection date (`deliveryDateProblem` — the server refuses the same,
// `OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION`).
//
// WHAT THE LEGACY FORM WAS (discovery §E, contad_app.js:306-569): one handler with four
// non-exclusive branches — create/edit × single/multi currency — where the multi-currency path
// walked SEVENTEEN fixed field pairs (quirk Q7). Here there is ONE shape: a list of
// {currency, amount} lines. The 17 remains only as the contract's max.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { Input, Select, Textarea } from '../../../shared/ui/form';
import { TrashIcon, PlusIcon } from '../../../shared/ui/icons';
import {
  DesignField,
  LOOK,
  MONO,
  boxTone,
  carBoxClass,
} from '../../fleet/components/FuelCardDialog';
import { useBankBranch, useOperationsAreas } from '../api/operations-queries';
import {
  SHIPMENT_DATE_PROBLEM_KEY,
  areaOfDestination,
  defaultDeliveryDate,
  deliveryDateMin,
  deliveryDateProblem,
  deliveryDateRequired,
  earliestShipmentDate,
  followCollectionDate,
  followMainBank,
  shipmentDateProblem,
  type ShipmentDateProblem,
} from '../lib/shipment-form';
import { cairoToday } from '../lib/shipment-history';
import { compareCurrencies, currencyOfKind } from '../lib/day-board';
import { BankBranchDialog } from './CatalogDialogs';
import { ShipmentBranchSide } from './ShipmentBranchSide';

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
 * (main_ops.ejs:376-387). Found the way the board's figures find it (`currencyKind`): by its code,
 * its name or a legacy alias, so a catalog whose pound is coded «1» still opens on it.
 */
export const defaultCurrencyId = (currencies: readonly OperationsCurrencyDto[]): string =>
  currencyOfKind(currencies, 'pound')?.id ?? '';

export const dateOnly = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

/** A board row carries its branches and crew resolved; a plain shipment does not. */
export const boardRow = (
  shipment: OperationsShipmentDto | OperationsDayBoardShipmentDto | null,
): OperationsDayBoardShipmentDto | null =>
  shipment !== null && 'origin' in shipment ? shipment : null;

/** The select boxes' tone — `Select` and `Textarea` have no `tone` slot, so `!`-classes. */
export const SELECT_BOX = cn(
  '!h-auto !rounded-xl !py-3 !ps-4 !text-[15px] !font-medium !text-slate-900 dark:!text-white focus:!border-indigo-500 focus:!ring-1 focus:!ring-indigo-500',
  '!border-slate-200 !bg-slate-50 dark:!border-[#2b3b6b] dark:!bg-[#0a1233]',
);

/** A refused box's rose frame laid on a `Combobox` from outside (it styles its own input). */
const COMBO_REFUSED =
  '[&_input]:!border-rose-500/70 [&_input]:shadow-[0_0_0_1px_#ef4444,0_0_14px_-2px_rgba(239,68,68,0.3)] [&_input]:!pe-28 [&_.end-2]:!end-10';

/**
 * The shipment's data as a form holds it, with every rule the shipment form keeps — opened from a
 * row (an edit; the receive form always is one) or empty (a new shipment of `createType`).
 */
export const useShipmentDraft = ({
  open,
  shipment,
  createType,
  banks,
  currencies,
}: {
  open: boolean;
  shipment: OperationsShipmentDto | OperationsDayBoardShipmentDto | null;
  createType: OperationsShipmentType;
  banks: readonly OperationsBankDto[];
  currencies: readonly OperationsCurrencyDto[];
}) => {
  const t = useT();
  const can = useCan();
  const editing = shipment !== null;
  const row = boardRow(shipment);
  const shipmentType: OperationsShipmentType = shipment?.shipmentType ?? createType;

  const [mainBankId, setMainBankId] = useState('');
  const [fromBankId, setFromBankId] = useState('');
  const [toBankId, setToBankId] = useState('');
  const [originBranchId, setOriginBranchId] = useState('');
  const [destinationBranchId, setDestinationBranchId] = useState('');
  /** The two branches' names — for what is printed from the form («إيصال»), not for the boxes. */
  const [branchNames, setBranchNames] = useState({ origin: '', destination: '' });
  const [areaName, setAreaName] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);
  /** The catalogs' branch form, opened over this one for a branch that is not there yet. */
  const [adding, setAdding] = useState<{
    side: 'origin' | 'destination';
    bankId: string;
    name: string;
  } | null>(null);

  const activeBanks = useMemo(() => banks.filter((bank) => bank.isActive), [banks]);
  // «ترتيب العملات … على حسب ترتيبها ف شاشة البيانات المرجعية»: the pickers list the currencies in
  // the catalog's dragged order, whatever order the caller's list came in (`compareCurrencies`).
  const activeCurrencies = useMemo(
    () => currencies.filter((c) => c.isActive).sort(compareCurrencies),
    [currencies],
  );

  useEffect(() => {
    if (!open) return;
    setMainBankId(shipment?.mainBankId ?? '');
    // The from-bank is the origin branch's own; a board row has it, a plain shipment is read below.
    setFromBankId(row?.origin?.bankId ?? '');
    setToBankId(shipment === null ? '' : (shipment.secondaryBankId ?? shipment.mainBankId));
    setOriginBranchId(shipment?.originBranchId ?? '');
    setDestinationBranchId(shipment?.destinationBranchId ?? '');
    setBranchNames({ origin: row?.origin?.name ?? '', destination: row?.destination?.name ?? '' });
    setAreaName(shipment?.areaName ?? '');
    const openedOn = cairoToday();
    setCollectionDate(shipment === null ? openedOn : dateOnly(shipment.collectionDate));
    // A new محصنة opens on the day after its collection — «تانى يوم الاستلام افتراضى».
    setDeliveryDate(
      shipment === null
        ? createType === 'secured'
          ? defaultDeliveryDate(openedOn)
          : ''
        : dateOnly(shipment.deliveryDate),
    );
    setNotes(shipment?.notes ?? '');
    setLines(
      shipment === null || shipment.lines.length === 0
        ? [{ currencyId: defaultCurrencyId(activeCurrencies), amount: '' }]
        : shipment.lines.map((line) => ({
            currencyId: line.currencyId,
            amount: String(line.amount),
          })),
    );
    setAdding(null);
    // `row` and the currencies are read on OPEN only — the form is the operator's from then on.
  }, [open, shipment]);

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
    setBranchNames((names) => ({ ...names, [side]: branch?.name ?? '' }));
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
  const addLine = (): void => setLines((prev) => [...prev, EMPTY_LINE]);
  const removeLine = (index: number): void =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  // ── The dates' floor ───────────────────────────────────────────────────────────────────────────
  //
  // Today for a new date, the day it was on for an edit — a delivery date never set before is a new
  // one. Today is read per render (cheap), so a form left open over midnight moves its floor with
  // the clock.
  const heldDate = shipment === null ? null : dateOnly(shipment.collectionDate);
  const heldDeliveryDate = shipment?.deliveryDate == null ? null : dateOnly(shipment.deliveryDate);
  const today = cairoToday();
  const earliestDate = earliestShipmentDate(heldDate, today);
  // A delivery date's calendar starts at the later of its own floor and the collection date.
  const earliestDeliveryDate = deliveryDateMin(
    earliestShipmentDate(heldDeliveryDate, today),
    collectionDate,
  );
  /** The two dates as stored on the shipment being edited — null for a new one. */
  const heldDates = heldDate === null ? null : { delivery: heldDeliveryDate, collection: heldDate };
  /** Both dates' problems as of `day` — the delivery date only where the form has one. */
  const dateProblems = (
    day: string,
  ): { collection: ShipmentDateProblem | null; delivery: ShipmentDateProblem | null } => ({
    collection: shipmentDateProblem(collectionDate, heldDate, day),
    delivery:
      shipmentType === 'secured'
        ? deliveryDateProblem(deliveryDate, collectionDate, heldDates, day)
        : null,
  });
  const dateProblem = dateProblems(today);

  /**
   * A new محصنة's delivery date follows its collection date until the person picks one
   * (`followCollectionDate`); an edit's dates are the person's from the start.
   */
  const changeCollectionDate = (next: string): void => {
    if (!editing && shipmentType === 'secured') {
      setDeliveryDate((current) => followCollectionDate(current, collectionDate, next));
    }
    setCollectionDate(next);
  };
  const needsDeliveryDate = deliveryDateRequired(shipmentType, heldDeliveryDate, !editing);
  // On a محصنة the collection date is named for what it is — the day it is collected from the bank —
  // beside «تاريخ التسليم»; a daily shipment has the one date, «تاريخ الشحنة».
  const collectionLabel = t(
    shipmentType === 'secured' ? 'operations.board.collectedOn' : 'operations.shipment.form.date',
  );

  /** The branch the catalogs' form just saved, picked on the side that asked for it. */
  const branchSaved = (saved: OperationsBankBranchDto): void => {
    if (adding === null) return;
    if (adding.side === 'origin') {
      setFromBankId(saved.bankId);
    } else {
      setToBankId(saved.bankId);
    }
    pickBranch(adding.side, saved);
  };

  return {
    editing,
    row,
    shipmentType,
    banks,
    activeBanks,
    activeCurrencies,
    mainBankId,
    fromBankId,
    toBankId,
    originBranchId,
    destinationBranchId,
    branchNames,
    areaName,
    collectionDate,
    deliveryDate,
    notes,
    lines,
    changeMainBank,
    changeSideBank,
    pickBranch,
    setLine,
    addLine,
    removeLine,
    setNotes,
    setDeliveryDate,
    changeCollectionDate,
    adding,
    setAdding,
    branchSaved,
    areas: areas.data?.items ?? [],
    canAddBranch,
    heldDate,
    heldDeliveryDate,
    earliestDate,
    earliestDeliveryDate,
    dateProblems,
    dateProblem,
    needsDeliveryDate,
    collectionLabel,
  };
};

export type ShipmentDraft = ReturnType<typeof useShipmentDraft>;

/** A date problem's words — the same as the server's refusal of it (`SAVE_ERRORS`). */
const useProblemText = (): ((problem: ShipmentDateProblem | null) => string | undefined) => {
  const t = useT();
  return (problem) => (problem === null ? undefined : t(SHIPMENT_DATE_PROBLEM_KEY[problem]));
};

// ── The boxes ────────────────────────────────────────────────────────────────────────────────────
//
// Each takes the draft and what the FORM decides about it: whether Save found it empty
// (`missing`), and the words of a server refusal said on it (`refused`).
//
// `starred` — whether a box the shipment cannot do without carries the rose star. The shipment form
// stars them: it is where they are filled in. The receive form does not: «ومش عاوز اى خانة من
// الخانات دى اجبارى كله اختيارى» — its boxes arrive filled, the vault only corrects them, and a
// star would say «you must fill this» on a form that asks nothing. Emptying one is still said under
// it (`missing`): the stored shipment cannot be left without it.

/** «البنك الرئيسي». What «الرئيسي» means is the shipment form's subtitle («البنك المُحاسب…»). */
export const MainBankField = ({
  draft,
  missing = false,
  refused,
  starred = true,
}: {
  draft: ShipmentDraft;
  missing?: boolean;
  refused?: string | undefined;
  starred?: boolean;
}): JSX.Element => {
  const t = useT();
  const { activeBanks, banks, mainBankId, changeMainBank } = draft;
  return (
    <DesignField
      label={t('operations.shipment.form.mainBank')}
      required={starred}
      missing={missing}
      error={refused}
    >
      <div className={cn(carBoxClass(false), (missing || refused !== undefined) && COMBO_REFUSED)}>
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
  );
};

/** «تاريخ الاستلام» on a محصنة, «تاريخ الشحنة» on a daily shipment — floored (see the header). */
export const CollectionDateField = ({
  draft,
  missing = false,
  refused,
  starred = true,
}: {
  draft: ShipmentDraft;
  missing?: boolean;
  refused?: string | undefined;
  starred?: boolean;
}): JSX.Element => {
  const problemText = useProblemText();
  const { collectionLabel, earliestDate, collectionDate, changeCollectionDate, dateProblem } =
    draft;
  return (
    <DesignField
      label={collectionLabel}
      required={starred}
      missing={missing}
      error={problemText(dateProblem.collection) ?? refused}
      datePicker
    >
      <Input
        type="date"
        dir="ltr"
        // The calendar offers no earlier day; one typed earlier is named under the box.
        min={earliestDate}
        value={collectionDate}
        onChange={(e) => changeCollectionDate(e.target.value)}
        tone={cn(boxTone(LOOK.add), MONO)}
        data-shipment-date="true"
      />
    </DesignField>
  );
};

/** «تاريخ التسليم» — a محصنة's only. */
export const DeliveryDateField = ({
  draft,
  missing = false,
  refused,
  hint = true,
  starred = true,
}: {
  draft: ShipmentDraft;
  missing?: boolean;
  refused?: string | undefined;
  /** The grey line under the box — a form short of height leaves it to the box's own floor. */
  hint?: boolean;
  starred?: boolean;
}): JSX.Element => {
  const t = useT();
  const problemText = useProblemText();
  const { needsDeliveryDate, earliestDeliveryDate, deliveryDate, setDeliveryDate, dateProblem } =
    draft;
  return (
    <DesignField
      label={t('operations.shipment.deliveryDate')}
      hint={hint ? t('operations.shipment.deliveryDateHint') : undefined}
      required={starred && needsDeliveryDate}
      missing={missing}
      error={problemText(dateProblem.delivery) ?? refused}
      datePicker
    >
      <Input
        type="date"
        dir="ltr"
        // Not before its floor, nor before the collection date.
        min={earliestDeliveryDate}
        value={deliveryDate}
        onChange={(e) => setDeliveryDate(e.target.value)}
        tone={cn(boxTone(LOOK.add), MONO)}
        data-shipment-delivery-date="true"
      />
    </DesignField>
  );
};

/** «ملاحظات». */
export const NotesField = ({ draft }: { draft: ShipmentDraft }): JSX.Element => {
  const t = useT();
  return (
    <DesignField label={t('operations.shipment.notes')}>
      <Textarea
        value={draft.notes}
        onChange={(e) => draft.setNotes(e.target.value)}
        rows={1}
        aria-label={t('operations.shipment.notes')}
        // The select's tone, not `box`: a Textarea has no `tone` slot, and only `!`-classes beat
        // its own background (the Accident form's notes box does the same).
        className={cn(SELECT_BOX, '!pe-4')}
      />
    </DesignField>
  );
};

/**
 * «المنطقة» — read only: it is the TO branch's («المنطقة … تحت الفرع اللى الى»), so typing it would
 * only let the two disagree. `labelled` draws it as a box of its own with the label above (the
 * receive form's row of boxes); otherwise it is a line under the TO branch, label beside it.
 */
export const AreaBox = ({
  areaName,
  labelled = false,
}: {
  areaName: string;
  labelled?: boolean;
}): JSX.Element => {
  const t = useT();
  const box = (
    <div
      role="textbox"
      aria-readonly="true"
      // A read-only textbox stays in the Tab order, so a keyboard reader meets it.
      tabIndex={0}
      aria-label={t('operations.shipment.area')}
      aria-description={t('operations.shipment.form.areaHint')}
      data-shipment-area="true"
      className={cn(
        'flex flex-1 items-center rounded-xl border px-4 text-[15px] font-medium',
        labelled ? 'min-h-[3.125rem]' : 'min-h-[2.5rem]',
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
  );
  if (labelled) {
    return (
      <div className="space-y-2" title={t('operations.shipment.form.areaHint')}>
        <span className="block text-[15px] font-bold text-slate-900 dark:text-white">
          {t('operations.shipment.area')}
        </span>
        {box}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3" title={t('operations.shipment.form.areaHint')}>
      <span className="shrink-0 text-[15px] font-bold text-slate-900 dark:text-white">
        {t('operations.shipment.area')}
      </span>
      {box}
    </div>
  );
};

/** «من فرع» / «إلى فرع» — the side's bank, then its branch, wired to the draft. */
export const DraftBranchSide = ({
  draft,
  side,
  missing = false,
  refused,
  bankRefused,
  compact = false,
  starred = true,
  children,
}: {
  draft: ShipmentDraft;
  side: 'origin' | 'destination';
  missing?: boolean;
  refused?: string | undefined;
  bankRefused?: string | undefined;
  compact?: boolean;
  starred?: boolean;
  children?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const origin = side === 'origin';
  return (
    <ShipmentBranchSide
      side={side}
      title={t(origin ? 'operations.shipment.origin' : 'operations.shipment.destination')}
      banks={draft.banks}
      bankId={origin ? draft.fromBankId : draft.toBankId}
      onBankChange={(next) => draft.changeSideBank(side, next)}
      branchId={origin ? draft.originBranchId : draft.destinationBranchId}
      onBranchChange={(branch) => draft.pickBranch(side, branch)}
      known={(origin ? draft.row?.origin : draft.row?.destination) ?? null}
      canCreate={draft.canAddBranch}
      onRequestCreate={(bankId, name) => draft.setAdding({ side, bankId, name })}
      branchMissing={missing}
      branchError={refused}
      bankError={bankRefused}
      compact={compact}
      starred={starred}
    >
      {children}
    </ShipmentBranchSide>
  );
};

/**
 * The money: one row per currency line — the currency, then the amount — and a bin. Only the first
 * row carries the boxes' names (`labelled`): a shipment of several currencies (the owner's own
 * example has four) grows by a box's height a currency, not a labelled field's.
 */
export const MoneyLines = ({
  draft,
  missing = false,
  refused,
  labelled = true,
  columns = 'grid-cols-[minmax(0,5fr)_minmax(0,7fr)_auto]',
}: {
  draft: ShipmentDraft;
  missing?: boolean;
  refused?: string | undefined;
  /** The first row's labels — off where the caller names the column itself. */
  labelled?: boolean;
  /** The row's columns — currency, amount, bin. A narrow column gives the currency more. */
  columns?: string;
}): JSX.Element => {
  const t = useT();
  const { lines, activeCurrencies, setLine, removeLine } = draft;
  const box = boxTone(LOOK.add);
  return (
    <div className="space-y-2" data-shipment-lines="true">
      {lines.map((line, index) => {
        const currencyBox = (
          <Select
            value={line.currencyId}
            onChange={(e) => setLine(index, { currencyId: e.target.value })}
            className={SELECT_BOX}
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
            aria-invalid={refused !== undefined ? true : undefined}
            data-shipment-amount={String(index)}
          />
        );
        return (
          // Lines have no identity of their own until saved; the index IS the slot.
          <div key={index} className={cn('grid items-end gap-2', columns)}>
            {index === 0 && labelled ? (
              <>
                <DesignField label={t('operations.shipment.currency')} missing={missing}>
                  {currencyBox}
                </DesignField>
                <DesignField
                  label={t('operations.shipment.form.amount')}
                  required
                  missing={missing}
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
              onClick={() => removeLine(index)}
              disabled={lines.length === 1}
              aria-label={`${t('common.remove')} ${index + 1}`}
              className="mb-1 rounded-xl border border-slate-200 p-3 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-500 disabled:opacity-40 dark:border-[#2b3b6b] dark:text-slate-400"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      {refused !== undefined && (
        <p role="alert" className="text-[13px] font-semibold text-[#ff6b81]">
          {refused}
        </p>
      )}
    </div>
  );
};

/** «+ إضافة عملة» — a new line, up to the contract's 17. */
export const AddLineButton = ({
  draft,
  className,
}: {
  draft: ShipmentDraft;
  className?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={draft.addLine}
      disabled={draft.lines.length >= MAX_SHIPMENT_LINES}
      data-shipment-add-line="true"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-dashed border-indigo-300 px-2.5 py-1 text-xs font-bold text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10',
        className,
      )}
    >
      <PlusIcon className="h-3.5 w-3.5" />
      {t('operations.shipment.addLine')}
    </button>
  );
};

/**
 * «يظهر موديل كدا انه يضيف باقى البيانات»: the catalogs screen's own branch form, opened over the
 * form with the bank and the typed name; the branch it saves is picked on the side that asked.
 */
export const DraftBranchCreate = ({ draft }: { draft: ShipmentDraft }): JSX.Element => {
  const { adding } = draft;
  return (
    <BankBranchDialog
      open={adding !== null}
      branch={null}
      banks={draft.activeBanks}
      areas={draft.areas}
      {...(adding === null ? {} : { initial: { bankId: adding.bankId, name: adding.name } })}
      onSaved={draft.branchSaved}
      onClose={() => draft.setAdding(null)}
    />
  );
};
