// The consumables dialogs (FR-20): the item's form, the three movements of one item — receive,
// scrap, return — the issue to an employee with its memo, and one item's movements.
//
// Their own file, not the spare parts' (`SparePartDialogs.tsx`): a spare part leaves the store
// only through a maintenance order (FR-9), while a consumable is HANDED to a person, on a memo they
// sign, and may be named as installed on one of the register's assets — «وأتبدل لمين واطبعله
// مذكره ولو حاجة بتتركب فى حاجة تانية … أقدر أذكر الجهاز اللى أتركب عليه من اللأصول».
//
// NO QUANTITY IS A FIELD on the item's form, and that absence IS the decision: what the store
// holds, what it issued and what was scrapped move only with a movement, atomically with it, so a
// figure typed by hand would be the one number with no movement behind it. A new item's opening
// quantity is its first receipt, written with it.
//
// Every dialog is thin. The SERVER owns the rules (more than is on hand, an inactive item, a
// leaver, an asset the reader cannot see or a disposed one — each refused), so these shape a
// payload and surface the API's verdict; the register only OFFERS what an item's figures allow.
//
// «تحويل إلى فرع» (2026-11-11) — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني»: one or more items
// of one store, each with how many, to another branch's store, at once and with no paper. Its rules
// are `lib/consumable-transfer.ts`.
import { useEffect, useReducer, useState } from 'react';
import {
  IT_CONSUMABLE_ISSUE_MAX_LINES,
  IT_CONSUMABLE_ISSUE_REASONS,
  IT_CONSUMABLE_TRANSFER_MAX_LINES,
  type CreateItConsumable,
  type IssueItConsumables,
  type ItConsumableDto,
  type ItConsumableIssueReason,
  type Locale,
  type UpdateItConsumable,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { Pagination } from '../../../shared/ui/Pagination';
import { toast } from '../../../shared/ui/toast/toast-store';
import { PlusIcon, PrinterIcon, SwapIcon, TrashIcon } from '../../../shared/ui/icons';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber, localized } from '../../../shared/lib/format';
import {
  useCreateItConsumable,
  useIssueItConsumables,
  useItBranchOptions,
  useItCatalog,
  useItConsumableMovements,
  useItConsumableTransferTargets,
  useItDepartmentOptions,
  useItLocationOptions,
  useItPerson,
  useItPrinterCounters,
  useReceiveItConsumable,
  useReturnItConsumable,
  useScrapItConsumable,
  useTransferItConsumables,
  useUpdateItConsumable,
} from '../api/it-queries';
import {
  consumableTransferCheck,
  consumableTransferRequest,
  consumablesCreatedWords,
  consumablesTransferredWords,
  type ConsumableTransferDraftLine,
} from '../lib/consumable-transfer';
import { branchMoveTargets } from '../lib/branch-move-targets';
import {
  clearedLineNumbers,
  custodianKey,
  custodianReady,
  heldByOther,
  holderAnswer,
  holderName,
  issueCustodianBody,
  issueHolderReducer,
  issueHolderStart,
  lineNumber,
  type IssueDeviceLine,
  type IssueHolderEvent,
  type IssueHolderState,
} from '../lib/consumable-issue-holder';
import { bareDepartmentName } from '../lib/custody-holder';
import { CustodianKindSwitch, DepartmentCustodianFields } from './DepartmentCustodianFields';
import {
  backdatedAgainst,
  clearMovedReadings,
  counterBody,
  counterFailures,
  counterLineCheck,
  counterProblemWords,
  countingTypes,
  countsLine,
  refusalAlertWords,
  sentCounterFailures,
  standingFailure,
  type CounterProblem,
  type LatestReading,
  type SentCounterFailure,
} from '../lib/consumable-counter';
import { AssetPicker } from './AssetPicker';
import { ConsumableCartridges, LastReadingNote } from './PrinterCounterCard';
import { ConsumablePicker } from './ConsumablePicker';
import { useConsumableMemoPrinter } from './ConsumableMemo';
import { useConsumableMovementLedger } from './ConsumableMovements';
import { EmployeePicker } from './EmployeePicker';
import { ItCatalogSelect } from './ItCatalogSelect';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; an empty string means "let the server stamp now". */
const nowLocal = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

/** A whole number typed into a box, or NaN — «2.5» of a mouse is not a quantity. */
const wholeNumber = (value: string): number => {
  const text = value.trim();
  return /^\d+$/u.test(text) ? Number(text) : Number.NaN;
};

/** The contract's own bound on any one movement. */
const MAX_QTY = 1_000_000;

/** A quantity a movement can carry: whole, at least one, and no more than `limit` when there is one. */
const qtyOk = (qty: number, limit?: number): boolean =>
  Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY && (limit === undefined || qty <= limit);

/** «حبر HP 85A — CON-00001»: which item a dialog is about, in its subtitle. */
const caption = (item: ItConsumableDto): string => `${item.name} — ${item.code}`;

const Shell = ({
  open,
  onClose,
  title,
  description,
  error,
  busy,
  canSubmit,
  submitLabel,
  submitIcon,
  submitVariant,
  onSubmit,
  size,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  error: string | null;
  busy: boolean;
  canSubmit: boolean;
  submitLabel: string;
  submitIcon?: JSX.Element;
  submitVariant?: 'primary' | 'danger';
  onSubmit: () => void;
  size?: 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      // A dialog that is FILLED IN keeps its typing: only the × and Escape close it.
      dismissOnOutsideClick={false}
      {...(description === undefined ? {} : { description })}
      {...(size === undefined ? {} : { size })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={submitVariant ?? 'primary'}
            loading={busy}
            disabled={!canSubmit}
            {...(submitIcon === undefined ? {} : { leftIcon: submitIcon })}
            onClick={onSubmit}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {error !== null && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="space-y-4">{children}</div>
    </Dialog>
  );
};

/** «الرصيد الحالي: ١٢ قطعة» — what the store holds, above a movement that changes it. */
const OnHand = ({ item }: { item: ItConsumableDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300">
      {t('it.consumables.onHandNow', {
        qty: formatNumber(item.onHandQty, locale),
        unit: item.unit,
      })}
    </p>
  );
};

// ── The item's form: add one to a branch's store, or correct its facts ────────
//
// The branch is chosen once: each branch keeps its own stock, so an item is a row PER BRANCH and a
// store's item never moves — another branch's stock of the same thing is its own row.

interface ItemForm {
  name: string;
  typeId: string;
  unit: string;
  branchId: string;
  minQty: string;
  notes: string;
  openingQty: string;
  active: boolean;
}

const formFrom = (item: ItConsumableDto | null): ItemForm => ({
  name: item?.name ?? '',
  typeId: item?.typeId ?? '',
  unit: item?.unit ?? '',
  branchId: item?.branchId ?? '',
  minQty: item?.minQty === null || item === null ? '' : String(item.minQty),
  notes: item?.notes ?? '',
  openingQty: '',
  active: item?.active ?? true,
});

/** A box left empty is «nothing», which an edit writes as null. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export const ConsumableFormDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  /** null → a new item. */
  item: ItConsumableDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const create = useCreateItConsumable();
  const update = useUpdateItConsumable();
  const [form, setForm] = useState<ItemForm>(formFrom(item));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(formFrom(item));
      setError(null);
    }
  }, [open, item]);

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const min = form.minQty.trim() === '' ? null : wholeNumber(form.minQty);
  const minError = min !== null && !(Number.isInteger(min) && min >= 0 && min <= MAX_QTY);
  const opening = form.openingQty.trim() === '' ? null : wholeNumber(form.openingQty);
  const openingError = opening !== null && !qtyOk(opening);
  const complete =
    form.name.trim() !== '' &&
    form.typeId !== '' &&
    form.unit.trim() !== '' &&
    form.branchId !== '' &&
    !minError &&
    !openingError;
  const busy = create.isPending || update.isPending;

  /** What an edit changes — only the facts that moved. */
  const changes = (current: ItConsumableDto): Omit<UpdateItConsumable, 'version'> => {
    const notes = orNull(form.notes);
    return {
      ...(form.name.trim() === current.name ? {} : { name: form.name.trim() }),
      ...(form.typeId === current.typeId ? {} : { typeId: form.typeId }),
      ...(form.unit.trim() === current.unit ? {} : { unit: form.unit.trim() }),
      ...(min === current.minQty ? {} : { minQty: min }),
      ...(notes === current.notes ? {} : { notes }),
      ...(form.active === current.active ? {} : { active: form.active }),
    };
  };
  const changed = item === null || Object.keys(changes(item)).length > 0;

  const submit = async (): Promise<void> => {
    if (!complete) return;
    setError(null);
    try {
      if (item === null) {
        const body: CreateItConsumable = {
          name: form.name.trim(),
          typeId: form.typeId,
          unit: form.unit.trim(),
          branchId: form.branchId,
          ...(min === null ? {} : { minQty: min }),
          ...(orNull(form.notes) === null ? {} : { notes: form.notes.trim() }),
          ...(opening === null ? {} : { openingQty: opening }),
        };
        await create.mutateAsync(body);
        toast.success(t('it.consumables.created'));
      } else {
        await update.mutateAsync({
          id: item.id,
          body: { ...changes(item), version: item.version },
        });
        toast.success(t('it.consumables.updated'));
      }
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      size="lg"
      title={item === null ? t('it.consumables.create') : t('it.consumables.edit')}
      {...(item === null ? {} : { description: caption(item) })}
      error={error}
      busy={busy}
      canSubmit={complete && changed}
      submitLabel={t('common.save')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('it.consumables.fields.name')}
          required
          hint={t('it.consumables.fields.nameHint')}
        >
          {/* The contract's own bounds, so a long name stops at the box rather than at a 400. */}
          <Input value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('it.consumables.fields.type')} required>
          <ItCatalogSelect
            kind="consumableType"
            value={form.typeId}
            onChange={(id) => set('typeId', id)}
            allLabel={t('it.consumables.chooseType')}
            ariaLabel={t('it.consumables.fields.type')}
            className="w-full"
          />
        </Field>
        <Field
          label={t('it.consumables.fields.unit')}
          required
          hint={t('it.consumables.fields.unitHint')}
        >
          <Input value={form.unit} maxLength={20} onChange={(e) => set('unit', e.target.value)} />
        </Field>
        <Field
          label={t('it.assets.columns.branch')}
          required
          hint={t('it.consumables.fields.branchHint')}
        >
          {/* Fixed once the item exists: a store's item stays in the store that keeps it. */}
          <Select
            value={form.branchId}
            disabled={item !== null}
            onChange={(e) => set('branchId', e.target.value)}
          >
            <option value="">{t('it.consumables.chooseBranch')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('it.consumables.fields.minQty')}
          hint={t('it.consumables.fields.minQtyHint')}
          error={minError ? t('it.consumables.errors.wholeNumber') : undefined}
        >
          <Input
            type="number"
            min="0"
            dir="ltr"
            value={form.minQty}
            onChange={(e) => set('minQty', e.target.value)}
            error={minError}
          />
        </Field>
        {item === null && (
          <Field
            label={t('it.consumables.fields.openingQty')}
            hint={t('it.consumables.fields.openingQtyHint')}
            error={openingError ? t('it.consumables.errors.wholeNumber') : undefined}
          >
            <Input
              type="number"
              min="1"
              dir="ltr"
              value={form.openingQty}
              onChange={(e) => set('openingQty', e.target.value)}
              error={openingError}
            />
          </Field>
        )}
      </div>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {item !== null && (
        <div>
          <Checkbox
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            label={t('it.consumables.fields.active')}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('it.consumables.fields.activeHint')}
          </p>
        </div>
      )}
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        {t('it.consumables.ledgerNote')}
      </p>
    </Shell>
  );
};

// ── Receive: stock in, from a delivery («توريد») ─────────────────────────────

export const ReceiveConsumableDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: ItConsumableDto;
}): JSX.Element => {
  const t = useT();
  const receive = useReceiveItConsumable();
  const [qty, setQty] = useState('1');
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQty('1');
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const amount = wholeNumber(qty);
  const valid = qtyOk(amount);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await receive.mutateAsync({
        id: item.id,
        body: {
          qty: amount,
          ...(at === '' ? {} : { at: new Date(at) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.consumables.received'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.consumables.actions.receive')}
      description={caption(item)}
      error={error}
      busy={receive.isPending}
      canSubmit={valid}
      submitLabel={t('it.consumables.actions.receive')}
      onSubmit={() => void submit()}
    >
      <OnHand item={item} />
      <Field
        label={t('it.consumables.fields.qty')}
        required
        hint={item.unit}
        error={qty.trim() !== '' && !valid ? t('it.consumables.errors.wholeNumber') : undefined}
      >
        <Input
          type="number"
          min="1"
          dir="ltr"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </Field>
      <Field label={t('it.consumables.fields.at')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')} hint={t('it.consumables.receiveNotesHint')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Scrap: out of the store, damaged («هالك») ───────────────────────────────
//
// Why is the record: a scrap with no reason is a number nobody can check, so it is required.

export const ScrapConsumableDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: ItConsumableDto;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const scrap = useScrapItConsumable();
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [at, setAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQty('1');
      setReason('');
      setAt(nowLocal());
      setError(null);
    }
  }, [open]);

  const amount = wholeNumber(qty);
  const tooMany = Number.isInteger(amount) && amount > item.onHandQty;
  const valid = qtyOk(amount, item.onHandQty) && reason.trim() !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await scrap.mutateAsync({
        id: item.id,
        body: { qty: amount, reason: reason.trim(), ...(at === '' ? {} : { at: new Date(at) }) },
      });
      toast.success(t('it.consumables.scrapped'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.consumables.actions.scrap')}
      description={caption(item)}
      error={error}
      busy={scrap.isPending}
      canSubmit={valid}
      submitLabel={t('it.consumables.actions.scrap')}
      submitVariant="danger"
      onSubmit={() => void submit()}
    >
      <OnHand item={item} />
      <Field
        label={t('it.consumables.fields.qty')}
        required
        hint={item.unit}
        error={
          tooMany
            ? t('it.consumables.errors.moreThanOnHand', {
                qty: formatNumber(item.onHandQty, locale),
              })
            : qty.trim() !== '' && !qtyOk(amount)
              ? t('it.consumables.errors.wholeNumber')
              : undefined
        }
      >
        <Input
          type="number"
          min="1"
          max={String(item.onHandQty)}
          dir="ltr"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          error={tooMany}
        />
      </Field>
      <Field
        label={t('it.consumables.fields.scrapReason')}
        required
        hint={t('it.consumables.fields.scrapReasonHint')}
      >
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t('it.consumables.fields.at')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Return: back to the store in working order («مرتجع») ─────────────────────
//
// From a person when known. Recording it is ADDING a record, so the box finds the people who work
// here today — «لكن فى حاله الاضافه اللى موجود بس» — like every other box that records something.

export const ReturnConsumableDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: ItConsumableDto;
}): JSX.Element => {
  const t = useT();
  const back = useReturnItConsumable();
  const [qty, setQty] = useState('1');
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQty('1');
      setEmployeeId('');
      setEmployeeLabel('');
      setAt(nowLocal());
      setNotes('');
      setError(null);
    }
  }, [open]);

  const amount = wholeNumber(qty);
  const valid = qtyOk(amount);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await back.mutateAsync({
        id: item.id,
        body: {
          qty: amount,
          ...(employeeId === '' ? {} : { employeeId }),
          ...(at === '' ? {} : { at: new Date(at) }),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      });
      toast.success(t('it.consumables.returned'));
      onClose();
    } catch (err) {
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={t('it.consumables.actions.return')}
      description={caption(item)}
      error={error}
      busy={back.isPending}
      canSubmit={valid}
      submitLabel={t('it.consumables.actions.return')}
      onSubmit={() => void submit()}
    >
      <p
        role="note"
        className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        {t('it.consumables.returnHint')}
      </p>
      <OnHand item={item} />
      <Field
        label={t('it.consumables.fields.qty')}
        required
        hint={item.unit}
        error={qty.trim() !== '' && !valid ? t('it.consumables.errors.wholeNumber') : undefined}
      >
        <Input
          type="number"
          min="1"
          dir="ltr"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </Field>
      <Field label={t('it.consumables.returnFrom')} hint={t('it.consumables.returnFromHint')}>
        <EmployeePicker
          value={employeeId}
          valueLabel={employeeLabel}
          onChange={(id, label) => {
            setEmployeeId(id);
            setEmployeeLabel(label);
          }}
          ariaLabel={t('it.consumables.returnFrom')}
          handOver
        />
      </Field>
      <Field label={t('it.consumables.fields.at')}>
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Issue: to an employee, on ONE memo («صرف لموظف») ─────────────────────────
//
// One employee, one or more items from ONE branch's store, one memo — recorded and printed in one
// step: «صرف وطباعة المذكرة» opens the print tab while the click still counts, records the issue
// (every movement, every figure and the memo, in one transaction), and writes the memo the issue
// answers into the tab. A tab the browser refuses records nothing, so no issue is ever left with a
// memo nobody printed; the memo prints again from the register any time, with the same number.
//
// Each line may name the register's asset the item was installed on («مركّب على»), and why it was
// issued: new, or in place of a damaged one — and then the damaged unit counts as scrap.
//
// The person and the devices find each other (2026-11-17, `lib/consumable-issue-holder.ts`): a
// person chosen first lists what they hold now in every line's «مركّب على», with «جهاز آخر» under
// it for any other device of the register; a device picked first fills the person with whoever
// holds it — when they still work here. Changing the person takes only the previous person's
// devices off the lines.
//
// «عداد الطابعة» (2026-11-19, `lib/consumable-counter.ts`): an item whose type takes the printer's
// counter («حبارات») is one cartridge a line, on the printer it goes into — «مركّب على» is then
// required — with that printer's counter reading, typed under the box once the printer is picked,
// above the printer's last reading (shown there), unless «تم تصفير عداد الطابعة» is ticked. A line
// whose printer changes loses its reading: it was read on the other one.

interface IssueLine extends IssueDeviceLine {
  /** A stable key for the row, so a removed line does not hand its boxes to the next. */
  key: number;
  consumable: ItConsumableDto | null;
  qty: string;
  reason: ItConsumableIssueReason;
  /** «قراءة عداد الطابعة» as typed — sent only when the item counts. */
  counterReading: string;
  /** «تم تصفير عداد الطابعة». */
  counterReset: boolean;
}

const blankLine = (key: number, consumable: ItConsumableDto | null = null): IssueLine => ({
  key,
  consumable,
  qty: '1',
  reason: 'new',
  assetId: '',
  asset: null,
  counterReading: '',
  counterReset: false,
});

/**
 * The person-and-device reducer, and then one rule of the counter's: every line whose device it
 * changed — a device picked again or cleared, or taken off by a change of person — loses its
 * reading. One place covers every way a device changes.
 */
const issueReducer = (
  state: IssueHolderState<IssueLine>,
  event: IssueHolderEvent<IssueLine>,
): IssueHolderState<IssueLine> => {
  const next = issueHolderReducer(state, event);
  const lines = clearMovedReadings(state.lines, next.lines);
  return lines === next.lines ? next : { ...next, lines };
};

/**
 * «قراءة عداد الطابعة» on one counted line, once its printer is picked: the reading, the reset, and
 * the printer's last reading under them. Its own component so each line reads its own words.
 */
const IssueCounterField = ({
  line,
  latest,
  unavailable,
  backdated,
  problem,
  onChange,
}: {
  line: IssueLine;
  /** The printer's newest reading — null for none yet, undefined while it is not read. */
  latest: LatestReading | undefined;
  unavailable: boolean;
  backdated: boolean;
  problem: CounterProblem | null;
  onChange: (update: Pick<IssueLine, 'counterReading' | 'counterReset'>) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div data-issue-counter={line.key} className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('it.consumables.counter.reading')}
          required
          {...(problem === null ? {} : { error: counterProblemWords(t, problem, locale) })}
        >
          <Input
            type="number"
            min="0"
            step="1"
            dir="ltr"
            inputMode="numeric"
            data-issue-counter-reading={line.key}
            value={line.counterReading}
            onChange={(e) =>
              onChange({ counterReading: e.target.value, counterReset: line.counterReset })
            }
            error={problem !== null}
          />
        </Field>
        <div className="space-y-1 sm:pt-7">
          <Checkbox
            data-issue-counter-reset={line.key}
            label={t('it.consumables.counter.reset')}
            checked={line.counterReset}
            onChange={(e) =>
              onChange({ counterReading: line.counterReading, counterReset: e.target.checked })
            }
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.consumables.counter.resetHint')}
          </p>
        </div>
      </div>
      <LastReadingNote latest={latest} unavailable={unavailable} backdated={backdated} />
    </div>
  );
};

/** «٢ و٣» — the lines a message is about, as the dialog numbers them. */
const lineList = (numbers: readonly number[], locale: Locale): string =>
  new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    numbers.map((n) => formatNumber(n, locale)),
  );

export const IssueConsumablesDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  /** The register's «صرف» on a row starts the memo with that item; the header's starts it empty. */
  item: ItConsumableDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const issue = useIssueItConsumables();
  const printer = useConsumableMemoPrinter();
  // «مركّب على» names one of the register's ASSETS, and its search reads `/it/assets`: offered
  // only to a reader of the assets. The store's own grants issue an item; they do not open the
  // register of devices (the server refuses an asset outside `itAsset.view` too).
  const canAssets = can('itAsset.view');
  // Who receives and the lines, in one reducer: choosing a person and a line's device each change
  // the other (`lib/consumable-issue-holder.ts`).
  const [state, dispatch] = useReducer(issueReducer, [blankLine(0, item)], issueHolderStart);
  const { employeeId, employeeLabel, lines } = state;
  // «صرف لإدارة» (2026-11-19): the memo goes to a department at a place of the store's branch,
  // signed by its responsible person. The custodian is the department at its place — its devices
  // are what «مركّب على» lists — never the signer.
  const toDepartment = state.mode === 'department';
  const departments = useItDepartmentOptions(toDepartment);
  const places = useItLocationOptions(toDepartment);
  const departmentName = departments.data?.find((each) => each.id === state.departmentId)?.name;
  const placeName = (places.data ?? []).find((each) => each.id === state.locationId)?.name;
  const custodianLabel = toDepartment
    ? departmentName === undefined || placeName === undefined
      ? ''
      : t('it.custody.department.heldAt', {
          department: bareDepartmentName(localized(departmentName, locale)),
          location: localized(placeName, locale),
        })
    : employeeLabel;
  const [issuedAt, setIssuedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // The server's counter refusals, each on the line and field it named — said while that line is
  // still exactly as it was sent, and a refused reading while the memo is still dated as it was
  // sent (the date places the reading among the printer's).
  const [counterRefusals, setCounterRefusals] = useState<SentCounterFailure[]>([]);

  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset', lines: [blankLine(0, item)] });
      setIssuedAt(nowLocal());
      setNotes('');
      setNextKey(1);
      setError(null);
      setCounterRefusals([]);
    }
  }, [open, item]);

  // A device picked with nobody chosen: its holder is read before the person is filled, so a
  // leaver is never filled in (the employee box offers none either). The answer is handed to the
  // reducer, which drops it if the user has moved on meanwhile. What to hand it is `holderAnswer`.
  const asking = state.asking;
  const holderRead = useItPerson(asking?.employeeId ?? '', canAssets);
  useEffect(() => {
    const answer = holderAnswer<IssueLine>(asking, {
      data: holderRead.data,
      isError: holderRead.isError,
    });
    if (answer !== null) dispatch(answer);
  }, [asking, holderRead.data, holderRead.isError]);

  const patchLine = (
    key: number,
    update: Partial<Omit<IssueLine, 'key' | 'assetId' | 'asset'>>,
  ): void => dispatch({ type: 'patch', key, update });
  const addLine = (): void => {
    dispatch({ type: 'add', line: blankLine(nextKey) });
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number): void => dispatch({ type: 'remove', key });
  const cleared = clearedLineNumbers(state);
  const noteLine = state.note === null ? null : lineNumber(state, state.note.lineKey);

  // One memo is one branch's store: the first item chosen decides it, and the other lines search
  // that branch only.
  const memoBranch = lines.find((line) => line.consumable !== null)?.consumable?.branchId ?? '';
  const branchName = (branches.data ?? []).find((branch) => branch.id === memoBranch)?.name;
  const chosen = lines.flatMap((line) => (line.consumable === null ? [] : [line.consumable.id]));

  // «عداد الطابعة»: which lines' items take the printer's counter (a catalog that could not be read
  // counts none — the server reads the type itself), and each counted printer's last reading.
  const types = useItCatalog('consumableType');
  const counting = countingTypes(types.data?.items);
  const counted = lines.map((line) => ({ ...line, counts: countsLine(line, counting) }));
  const printers = [
    ...new Set(
      counted.flatMap((line) => (line.counts && line.assetId !== '' ? [line.assetId] : [])),
    ),
  ];
  const printerReads = useItPrinterCounters(canAssets ? printers : []);
  const printerRead = (assetId: string) => printerReads[printers.indexOf(assetId)];
  const latestOf = (assetId: string): LatestReading | undefined =>
    printerRead(assetId)?.data?.latest;
  // The memo's moment: what it is dated, or now when the box is emptied (the server stamps it).
  const issuedOn = issuedAt === '' ? new Date() : new Date(issuedAt);
  const counterCheck = (line: (typeof counted)[number]) =>
    counterLineCheck(line, {
      counts: line.counts,
      canAssets,
      latest: latestOf(line.assetId),
      issuedAt: issuedOn,
      lines: counted,
    });

  const lineQty = (line: IssueLine): number => wholeNumber(line.qty);
  const lineOk = (line: (typeof counted)[number]): boolean =>
    line.consumable !== null &&
    line.consumable.active &&
    line.consumable.branchId === memoBranch &&
    qtyOk(lineQty(line), line.consumable.onHandQty) &&
    counterCheck(line).ok;
  const ready = custodianReady(state) && lines.length > 0 && counted.every(lineOk);
  const replacing = lines.some((line) => line.reason === 'replacement');

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setError(null);
    setCounterRefusals([]);
    const sent = lines;
    const sentIssuedAt = issuedAt;
    const body: IssueItConsumables = {
      ...issueCustodianBody(state),
      ...(issuedAt === '' ? {} : { issuedAt: new Date(issuedAt) }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      lines: counted.map((line) => ({
        consumableId: line.consumable?.id ?? '',
        qty: lineQty(line),
        reason: line.reason,
        ...(line.assetId === '' ? {} : { assetId: line.assetId }),
        ...counterBody(line, line.counts),
      })),
    };
    // The tab first, inside the click; the issue is recorded only once there is a tab to print in.
    const memo = await printer.print(async () => {
      try {
        const result = await issue.mutateAsync(body);
        return result.memo;
      } catch (err) {
        // A counter refusal is said on its line's field, with the figures; above, in the same words
        // — and the printer's toast says the figure too, in the reader's words, not the server's.
        const refusals = sentCounterFailures(counterFailures(err), sent, sentIssuedAt);
        setCounterRefusals(refusals);
        setError(refusalAlertWords(t, refusals, err, locale) ?? message(err, t('common.error')));
        const [first] = refusals;
        if (first !== undefined) throw new Error(counterProblemWords(t, first.problem, locale));
        throw err;
      }
    });
    if (memo !== null) {
      toast.success(t(toDepartment ? 'it.consumables.issuedDepartment' : 'it.consumables.issued'));
      onClose();
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      size="xl"
      title={t(
        toDepartment ? 'it.consumables.issue.titleDepartment' : 'it.consumables.issue.title',
      )}
      description={t(
        toDepartment
          ? 'it.consumables.issue.printsMemoDepartment'
          : 'it.consumables.issue.printsMemo',
      )}
      error={error}
      busy={issue.isPending || printer.isPrinting}
      canSubmit={ready}
      submitLabel={t('it.consumables.issue.submit')}
      submitIcon={<PrinterIcon className="h-4 w-4" />}
      onSubmit={() => void submit()}
    >
      <CustodianKindSwitch
        value={state.mode}
        onChange={(mode) => dispatch({ type: 'mode', mode })}
      />
      {toDepartment && (
        <DepartmentCustodianFields
          value={{
            departmentId: state.departmentId,
            locationId: state.locationId,
            responsibleEmployeeId: state.responsibleEmployeeId,
            responsibleLabel: state.responsibleLabel,
          }}
          onChange={(next) => {
            if (next.departmentId !== state.departmentId || next.locationId !== state.locationId) {
              dispatch({
                type: 'department',
                departmentId: next.departmentId,
                locationId: next.locationId,
              });
            }
            if (next.responsibleEmployeeId !== state.responsibleEmployeeId) {
              dispatch({
                type: 'responsible',
                employeeId: next.responsibleEmployeeId,
                label: next.responsibleLabel,
              });
            }
          }}
          branchId={memoBranch}
          branchMissingHint={t('it.custody.department.locationAfterItem')}
          filledFromDevice={
            state.filledDepartmentId !== '' && state.filledDepartmentId === state.departmentId
          }
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* A hand-over: the people who work here today, in every branch, and nobody else. */}
        {toDepartment ? (
          // Whether a picked device filled the department and its place — no empty cell otherwise.
          state.note?.kind === 'filledDepartment' && noteLine !== null ? (
            <p
              role="note"
              aria-live="polite"
              data-issue-holder-note={state.note.kind}
              className="self-end text-xs text-slate-500 dark:text-slate-400"
            >
              {t('it.consumables.issue.departmentFilled', { n: formatNumber(noteLine, locale) })}
            </p>
          ) : null
        ) : (
          <Field label={t('it.consumables.issue.employee')} required>
            <EmployeePicker
              value={employeeId}
              valueLabel={employeeLabel}
              onChange={(id, label) => dispatch({ type: 'person', employeeId: id, label })}
              ariaLabel={t('it.consumables.issue.employee')}
              handOver
            />
            {/* Whether a picked device filled the person — or why it could not. */}
            <div aria-live="polite">
              {state.note !== null && noteLine !== null && (
                <p
                  role="note"
                  data-issue-holder-note={state.note.kind}
                  className={
                    state.note.kind === 'filled' || state.note.kind === 'filledDepartment'
                      ? 'text-xs text-slate-500 dark:text-slate-400'
                      : 'rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                  }
                >
                  {state.note.kind === 'filled'
                    ? t('it.consumables.issue.holderFilled', { n: formatNumber(noteLine, locale) })
                    : state.note.kind === 'filledDepartment'
                      ? t('it.consumables.issue.departmentFilled', {
                          n: formatNumber(noteLine, locale),
                        })
                      : state.note.kind === 'exited'
                        ? t('it.consumables.issue.holderExited', {
                            n: formatNumber(noteLine, locale),
                            name: state.note.name,
                          })
                        : t('it.consumables.issue.holderUnreadable', {
                            n: formatNumber(noteLine, locale),
                          })}
                </p>
              )}
            </div>
          </Field>
        )}
        <Field label={t('it.consumables.fields.at')}>
          <Input
            type="datetime-local"
            value={issuedAt}
            onChange={(e) => setIssuedAt(e.target.value)}
          />
        </Field>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('it.consumables.issue.lines')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {memoBranch === '' || branchName === undefined
              ? t('it.consumables.issue.linesHint', { max: IT_CONSUMABLE_ISSUE_MAX_LINES })
              : t('it.consumables.issue.sameBranch', { branch: localized(branchName, locale) })}
          </p>
        </div>
        <ol className="space-y-3">
          {counted.map((line, index) => {
            const qty = lineQty(line);
            const tooMany =
              line.consumable !== null && Number.isInteger(qty) && qty > line.consumable.onHandQty;
            // A device somebody else holds, picked through «جهاز آخر»: the custodian stays.
            const otherHolder = heldByOther(line, custodianKey(state));
            // «عداد الطابعة» — what the dialog finds wrong first, then what the server said.
            const check = counterCheck(line);
            const words = (problem: CounterProblem | null): string | undefined =>
              problem === null ? undefined : counterProblemWords(t, problem, locale);
            const qtyProblem = check.qty ?? standingFailure(counterRefusals, line, 'qty', issuedAt);
            const printerProblem = standingFailure(counterRefusals, line, 'assetId', issuedAt);
            const readingProblem =
              check.reading ?? standingFailure(counterRefusals, line, 'counterReading', issuedAt);
            const read = line.counts ? printerRead(line.assetId) : undefined;
            return (
              <li
                key={line.key}
                data-issue-line={index}
                className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {t('it.consumables.issue.lineLabel', { n: formatNumber(index + 1, locale) })}
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                      aria-label={t('it.consumables.issue.removeLine')}
                      title={t('it.consumables.issue.removeLine')}
                      onClick={() => removeLine(line.key)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <Field label={t('it.consumables.movements.columns.item')} required>
                    <ConsumablePicker
                      value={line.consumable?.id ?? ''}
                      branchId={memoBranch}
                      exclude={chosen.filter((id) => id !== line.consumable?.id)}
                      // A toner is one cartridge a line: its quantity is one, and stays so.
                      onChange={(_id, consumable) =>
                        patchLine(line.key, {
                          consumable,
                          ...(consumable !== null && countsLine({ consumable }, counting)
                            ? { qty: '1' }
                            : {}),
                        })
                      }
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('it.consumables.fields.qty')}
                      required
                      {...(line.consumable === null
                        ? {}
                        : {
                            hint: line.counts
                              ? t('it.consumables.counter.oneCartridge')
                              : line.consumable.unit,
                          })}
                      error={
                        tooMany && line.consumable !== null
                          ? t('it.consumables.errors.moreThanOnHand', {
                              qty: formatNumber(line.consumable.onHandQty, locale),
                            })
                          : line.qty.trim() !== '' && !qtyOk(qty)
                            ? t('it.consumables.errors.wholeNumber')
                            : words(qtyProblem)
                      }
                    >
                      <Input
                        type="number"
                        min="1"
                        dir="ltr"
                        value={line.qty}
                        onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                        disabled={line.counts && line.qty.trim() === '1'}
                        error={tooMany || qtyProblem !== null}
                      />
                    </Field>
                    <Field label={t('it.consumables.issue.reason')}>
                      <Select
                        value={line.reason}
                        onChange={(e) =>
                          patchLine(line.key, {
                            reason: e.target.value as ItConsumableIssueReason,
                          })
                        }
                      >
                        {IT_CONSUMABLE_ISSUE_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {t(`it.consumables.reason.${reason}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </div>
                {/* A toner goes onto a printer of the register, which this reader cannot open. */}
                {check.printer !== null && (
                  <p
                    role="note"
                    data-issue-counter-blocked={line.key}
                    className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    {words(check.printer)}
                  </p>
                )}
                {canAssets && (
                  <Field
                    label={t('it.consumables.issue.installedOn')}
                    required={line.counts}
                    hint={
                      line.counts
                        ? t('it.consumables.counter.printerRequired')
                        : t('it.consumables.issue.installedOnHint')
                    }
                    error={words(printerProblem)}
                  >
                    <AssetPicker
                      value={line.assetId}
                      withoutStatus="disposed"
                      holderEmployeeId={toDepartment ? '' : employeeId}
                      holderDepartmentId={
                        toDepartment && state.locationId !== '' ? state.departmentId : ''
                      }
                      holderLocationId={toDepartment ? state.locationId : ''}
                      holderLabel={custodianLabel}
                      showHolder
                      allowOther
                      onChange={(assetId, asset) =>
                        dispatch({ type: 'device', key: line.key, assetId, asset: asset ?? null })
                      }
                      ariaLabel={t('it.consumables.issue.installedOn')}
                    />
                    <div aria-live="polite">
                      {otherHolder !== null && (
                        <p
                          role="note"
                          data-issue-line-holder={
                            otherHolder.employeeId ?? otherHolder.departmentId ?? ''
                          }
                          className="text-xs text-slate-500 dark:text-slate-400"
                        >
                          {t('it.consumables.issue.deviceHeldByOther', {
                            name: holderName(otherHolder, t, locale),
                          })}
                        </p>
                      )}
                    </div>
                  </Field>
                )}
                {canAssets && line.counts && line.assetId !== '' && (
                  <IssueCounterField
                    line={line}
                    latest={read?.data?.latest}
                    unavailable={read?.isError ?? false}
                    backdated={backdatedAgainst(read?.data?.latest, issuedOn)}
                    problem={readingProblem}
                    onChange={(update) => patchLine(line.key, update)}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {/* Said once, for every line a change of person emptied. */}
        <div aria-live="polite">
          {cleared.length > 0 && (
            <p
              role="note"
              data-issue-devices-cleared={cleared.join(',')}
              className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {state.clearedFrom === 'department'
                ? cleared.length === 1
                  ? t('it.consumables.issue.deviceClearedDepartment', {
                      lines: lineList(cleared, locale),
                    })
                  : t('it.consumables.issue.devicesClearedDepartment', {
                      lines: lineList(cleared, locale),
                    })
                : cleared.length === 1
                  ? t('it.consumables.issue.deviceCleared', { lines: lineList(cleared, locale) })
                  : t('it.consumables.issue.devicesCleared', { lines: lineList(cleared, locale) })}
            </p>
          )}
        </div>
        {lines.length < IT_CONSUMABLE_ISSUE_MAX_LINES && (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={addLine}
          >
            {t('it.consumables.issue.addLine')}
          </Button>
        )}
        {replacing && (
          <p
            role="note"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('it.consumables.replacementNote')}
          </p>
        )}
      </section>

      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── Transfer: to another branch's store («تحويل إلى فرع») ───────────────────
//
// The items ticked on the register (or the one row's), all of ONE store — the register sends no
// other set. Each row asks how many, from one to what the store holds, and starts EMPTY: «how
// many» is answered, never assumed. An item with nothing on hand is listed and left out. The other
// store's item of the same name receives it, and is made there when it has none — the toast says
// which, from the server's answer. The branches offered are the ones the SERVER says the caller's
// `itConsumable.assign` reaches (`GET /it/consumables/transfer-targets` — the store's own custody
// grant since 2026-11-17, §2.11, not the assets' `move-targets`); it answers 403 for any other.

export const TransferConsumablesDialog = ({
  open,
  onClose,
  items,
  onTransferred,
}: {
  open: boolean;
  onClose: () => void;
  /** The items as they were when the dialog opened, in the register's order. */
  items: readonly ItConsumableDto[];
  /** After the transfer is recorded — the register clears its selection. */
  onTransferred?: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const reach = useItConsumableTransferTargets(open);
  const transfer = useTransferItConsumables();
  const [toBranchId, setToBranchId] = useState('');
  const [at, setAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ConsumableTransferDraftLine<ItConsumableDto>[]>(() =>
    items.map((item) => ({ item, qty: '' })),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setToBranchId('');
      setAt(nowLocal());
      setNotes('');
      setLines(items.map((item) => ({ item, qty: '' })));
      setError(null);
    }
  }, [open, items]);

  const fromBranchId = lines[0]?.item.branchId ?? '';
  // Never back into the store the items leave, and only where the server says the custody grant
  // reaches. Null while either list is on its way: the picker waits instead of saying there is
  // nowhere to go.
  const targets = branchMoveTargets(branches.data, reach.data?.branchIds, fromBranchId);
  const noTarget = targets !== null && targets.length === 0;
  const unread = targets === null ? (reach.error ?? branches.error) : null;
  // A choice no longer offered is no choice: nothing is sent to it.
  const chosen = targets?.some((branch) => branch.id === toBranchId) === true ? toBranchId : '';
  const check = consumableTransferCheck(lines, chosen);
  const request = consumableTransferRequest(check, chosen, at, notes);
  const nameOf = (branchId: string): string | undefined => {
    const branch = (branches.data ?? []).find((b) => b.id === branchId);
    return branch === undefined ? undefined : localized(branch.name, locale);
  };
  const fromName = nameOf(check.fromBranchId);

  const setQty = (id: string, qty: string): void =>
    setLines((prev) => prev.map((line) => (line.item.id === id ? { ...line, qty } : line)));
  const removeLine = (id: string): void =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.item.id !== id)));

  const submit = async (): Promise<void> => {
    if (request === null) return;
    setError(null);
    try {
      const result = await transfer.mutateAsync(request);
      const branch = nameOf(result.toBranchId) ?? t('it.consumables.transfer.theBranch');
      toast.success(
        consumablesTransferredWords(t, locale, result.lines.length, branch),
        consumablesCreatedWords(t, locale, result, branch) ?? undefined,
      );
      onTransferred?.();
      onClose();
    } catch (err) {
      // Toasted once by the client's global handler; said here too, beside the rows it is about.
      setError(message(err, t('common.error')));
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      size="lg"
      title={t('it.consumables.transfer.title')}
      description={
        fromName === undefined
          ? t('it.consumables.transfer.hint')
          : t('it.consumables.transfer.fromStore', { branch: fromName })
      }
      error={error}
      busy={transfer.isPending}
      canSubmit={request !== null}
      submitLabel={t('it.consumables.transfer.submit')}
      submitIcon={<SwapIcon className="h-4 w-4" />}
      onSubmit={() => void submit()}
    >
      {fromName !== undefined && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('it.consumables.transfer.hint')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('it.consumables.transfer.toBranchLabel')}
          required
          error={
            noTarget
              ? t('it.consumables.transfer.noTarget')
              : unread !== null
                ? errorMessage(unread, locale)
                : check.sameBranch
                  ? t('it.consumables.transfer.sameBranch')
                  : undefined
          }
        >
          <Select
            value={chosen}
            disabled={targets === null || noTarget}
            onChange={(e) => setToBranchId(e.target.value)}
          >
            <option value="">
              {targets === null && unread === null
                ? t('common.loading')
                : t('it.consumables.chooseBranch')}
            </option>
            {(targets ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('it.consumables.fields.at')}>
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {t('it.consumables.transfer.lines')}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.consumables.transfer.linesHint', {
              max: formatNumber(IT_CONSUMABLE_TRANSFER_MAX_LINES, locale),
            })}
          </p>
        </div>
        <ol className="space-y-2">
          {check.lines.map((line) => {
            const draft = lines.find((d) => d.item.id === line.item.id);
            const { item } = line;
            const problem =
              line.problem === 'moreThanOnHand'
                ? t('it.consumables.errors.moreThanOnHand', {
                    qty: formatNumber(item.onHandQty, locale),
                  })
                : line.problem === 'wholeNumber'
                  ? t('it.consumables.errors.wholeNumber')
                  : undefined;
            return (
              <li
                key={item.id}
                data-transfer-line={item.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {item.name}{' '}
                    <bdi className="font-mono text-xs text-slate-500" dir="ltr">
                      {item.code}
                    </bdi>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {line.problem === 'nothingOnHand'
                      ? t('it.consumables.transfer.nothingOnHand')
                      : t('it.consumables.onHandNow', {
                          qty: formatNumber(item.onHandQty, locale),
                          unit: item.unit,
                        })}
                  </p>
                </div>
                {line.problem !== 'nothingOnHand' && (
                  <div className="w-36">
                    <Field
                      label={t('it.consumables.fields.qty')}
                      required
                      hint={item.unit}
                      error={problem}
                    >
                      <Input
                        type="number"
                        min="1"
                        max={String(item.onHandQty)}
                        dir="ltr"
                        value={draft?.qty ?? ''}
                        onChange={(e) => setQty(item.id, e.target.value)}
                        error={problem !== undefined}
                      />
                    </Field>
                  </div>
                )}
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                    aria-label={`${t('it.consumables.transfer.removeLine')} — ${item.name}`}
                    title={t('it.consumables.transfer.removeLine')}
                    onClick={() => removeLine(item.id)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.consumables.transfer.sameNameNote')}
        </p>
      </section>

      <Field label={t('it.assets.fields.notes')}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
};

// ── One item's movements ────────────────────────────────────────────────────
//
// Read from the ledger, never typed: every receipt, issue, scrap and return the item has seen,
// newest first, each issue with the memo it was signed on.

const MOVEMENTS_PAGE_SIZE = 20;

export const ConsumableMovementsDialog = ({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item: ItConsumableDto;
}): JSX.Element => {
  const t = useT();
  const [page, setPage] = useState(1);
  const movements = useItConsumableMovements(
    { consumableId: item.id, page, pageSize: MOVEMENTS_PAGE_SIZE },
    open,
  );
  const rows = movements.data?.items ?? [];
  // «قراءة العداد» — on a toner's movements (its type takes the counter, or a row carries a
  // reading from when it did); every other item's would be a column of dashes.
  const counting = countingTypes(useItCatalog('consumableType').data?.items);
  const counter =
    countsLine({ consumable: item }, counting) || rows.some((m) => m.counterReading !== null);
  const { columns, editor } = useConsumableMovementLedger(rows, { item: false, counter });

  return (
    // Its rows open a memo's signed copy in a viewer of its own, a second dialog beside this one:
    // a click inside that viewer is «outside» this panel, and must not close the two of them.
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      dismissOnOutsideClick={false}
      title={t('it.consumables.movementsTitle')}
      description={caption(item)}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="space-y-3">
        <OnHand item={item} />
        {/* A toner's cartridges, the pages each printed and their average (`GET …/cartridges`). */}
        {counter && <ConsumableCartridges consumableId={item.id} open={open} />}
        <DataTable
          embedded
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          loading={movements.isLoading}
          error={movements.isError ? movements.error : undefined}
          onRetry={() => void movements.refetch()}
          empty={t('it.consumables.noMovements')}
          // Nine columns with «تعديل الجهاز» in a 64rem panel — ten on a toner, with «قراءة العداد»:
          // a 6.5rem floor (6rem for ten) keeps the row's action in view instead of past the
          // table's left edge.
          minColumnWidth={counter ? 6 : 6.5}
        />
        {movements.data !== undefined && movements.data.meta.totalPages > 1 && (
          <Pagination meta={movements.data.meta} onPageChange={setPage} />
        )}
        {editor}
      </div>
    </Dialog>
  );
};
