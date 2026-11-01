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
import { useEffect, useState } from 'react';
import {
  IT_CONSUMABLE_ISSUE_MAX_LINES,
  IT_CONSUMABLE_ISSUE_REASONS,
  type CreateItConsumable,
  type IssueItConsumables,
  type ItConsumableDto,
  type ItConsumableIssueReason,
  type Locale,
  type UpdateItConsumable,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { Checkbox, Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { Pagination } from '../../../shared/ui/Pagination';
import { toast } from '../../../shared/ui/toast/toast-store';
import { PlusIcon, PrinterIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import {
  useCreateItConsumable,
  useIssueItConsumables,
  useItBranchOptions,
  useItConsumableMovements,
  useReceiveItConsumable,
  useReturnItConsumable,
  useScrapItConsumable,
  useUpdateItConsumable,
} from '../api/it-queries';
import { AssetPicker } from './AssetPicker';
import { ConsumablePicker } from './ConsumablePicker';
import { useConsumableMemoPrinter } from './ConsumableMemo';
import { useConsumableMovementColumns } from './ConsumableMovements';
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

interface IssueLine {
  /** A stable key for the row, so a removed line does not hand its boxes to the next. */
  key: number;
  consumable: ItConsumableDto | null;
  qty: string;
  reason: ItConsumableIssueReason;
  assetId: string;
}

const blankLine = (key: number, consumable: ItConsumableDto | null = null): IssueLine => ({
  key,
  consumable,
  qty: '1',
  reason: 'new',
  assetId: '',
});

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
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branches = useItBranchOptions();
  const issue = useIssueItConsumables();
  const printer = useConsumableMemoPrinter();
  const [employeeId, setEmployeeId] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<IssueLine[]>([blankLine(0, item)]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmployeeId('');
      setEmployeeLabel('');
      setIssuedAt(nowLocal());
      setNotes('');
      setLines([blankLine(0, item)]);
      setNextKey(1);
      setError(null);
    }
  }, [open, item]);

  const patchLine = (key: number, update: Partial<IssueLine>): void =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...update } : line)));
  const addLine = (): void => {
    setLines((prev) => [...prev, blankLine(nextKey)]);
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number): void =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));

  // One memo is one branch's store: the first item chosen decides it, and the other lines search
  // that branch only.
  const memoBranch = lines.find((line) => line.consumable !== null)?.consumable?.branchId ?? '';
  const branchName = (branches.data ?? []).find((branch) => branch.id === memoBranch)?.name;
  const chosen = lines.flatMap((line) => (line.consumable === null ? [] : [line.consumable.id]));

  const lineQty = (line: IssueLine): number => wholeNumber(line.qty);
  const lineOk = (line: IssueLine): boolean =>
    line.consumable !== null &&
    line.consumable.active &&
    line.consumable.branchId === memoBranch &&
    qtyOk(lineQty(line), line.consumable.onHandQty);
  const ready = employeeId !== '' && lines.length > 0 && lines.every(lineOk);
  const replacing = lines.some((line) => line.reason === 'replacement');

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setError(null);
    const body: IssueItConsumables = {
      employeeId,
      ...(issuedAt === '' ? {} : { issuedAt: new Date(issuedAt) }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      lines: lines.map((line) => ({
        consumableId: line.consumable?.id ?? '',
        qty: lineQty(line),
        reason: line.reason,
        ...(line.assetId === '' ? {} : { assetId: line.assetId }),
      })),
    };
    // The tab first, inside the click; the issue is recorded only once there is a tab to print in.
    const memo = await printer.print(async () => {
      try {
        const result = await issue.mutateAsync(body);
        return result.memo;
      } catch (err) {
        setError(message(err, t('common.error')));
        throw err;
      }
    });
    if (memo !== null) {
      toast.success(t('it.consumables.issued'));
      onClose();
    }
  };

  return (
    <Shell
      open={open}
      onClose={onClose}
      size="xl"
      title={t('it.consumables.issue.title')}
      description={t('it.consumables.issue.printsMemo')}
      error={error}
      busy={issue.isPending || printer.isPrinting}
      canSubmit={ready}
      submitLabel={t('it.consumables.issue.submit')}
      submitIcon={<PrinterIcon className="h-4 w-4" />}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* A hand-over: the people who work here today, and nobody else. */}
        <Field label={t('it.consumables.issue.employee')} required>
          <EmployeePicker
            value={employeeId}
            valueLabel={employeeLabel}
            onChange={(id, label) => {
              setEmployeeId(id);
              setEmployeeLabel(label);
            }}
            ariaLabel={t('it.consumables.issue.employee')}
          />
        </Field>
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
          {lines.map((line, index) => {
            const qty = lineQty(line);
            const tooMany =
              line.consumable !== null && Number.isInteger(qty) && qty > line.consumable.onHandQty;
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
                      onChange={(_id, consumable) => patchLine(line.key, { consumable })}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('it.consumables.fields.qty')}
                      required
                      {...(line.consumable === null ? {} : { hint: line.consumable.unit })}
                      error={
                        tooMany && line.consumable !== null
                          ? t('it.consumables.errors.moreThanOnHand', {
                              qty: formatNumber(line.consumable.onHandQty, locale),
                            })
                          : line.qty.trim() !== '' && !qtyOk(qty)
                            ? t('it.consumables.errors.wholeNumber')
                            : undefined
                      }
                    >
                      <Input
                        type="number"
                        min="1"
                        dir="ltr"
                        value={line.qty}
                        onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                        error={tooMany}
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
                <Field
                  label={t('it.consumables.issue.installedOn')}
                  hint={t('it.consumables.issue.installedOnHint')}
                >
                  <AssetPicker
                    value={line.assetId}
                    withoutStatus="disposed"
                    onChange={(assetId) => patchLine(line.key, { assetId })}
                    ariaLabel={t('it.consumables.issue.installedOn')}
                  />
                </Field>
              </li>
            );
          })}
        </ol>
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
  const columns = useConsumableMovementColumns({ item: false });
  const movements = useItConsumableMovements(
    { consumableId: item.id, page, pageSize: MOVEMENTS_PAGE_SIZE },
    open,
  );

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
        <DataTable
          embedded
          columns={columns}
          rows={movements.data?.items ?? []}
          rowKey={(m) => m.id}
          loading={movements.isLoading}
          error={movements.isError ? movements.error : undefined}
          onRetry={() => void movements.refetch()}
          empty={t('it.consumables.noMovements')}
        />
        {movements.data !== undefined && movements.data.meta.totalPages > 1 && (
          <Pagination meta={movements.data.meta} onPageChange={setPage} />
        )}
      </div>
    </Dialog>
  );
};
