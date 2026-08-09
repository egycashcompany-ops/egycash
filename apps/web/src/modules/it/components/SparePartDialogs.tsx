// The store's two dialogs (ADR-024).
//
// **The part.** `onHandQty` is not a field on either form, and that absence IS the decision: stock
// arrives through a receipt and leaves through an order's completion, so a level typed by hand
// would be the one number in the store with no movement behind it.
//
// **The receipt.** Positive only. A negative "receipt" would be a consumption smuggled past FR-9,
// which requires every consumption to name the order it served.
import { useEffect, useState } from 'react';
import { type ItSparePartDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateItSparePart,
  useReceiveItSparePart,
  useUpdateItSparePart,
} from '../api/it-queries';

const asInt = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
};

export const SparePartDialog = ({
  open,
  onClose,
  part,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  part: ItSparePartDto | null;
}): JSX.Element => {
  const t = useT();
  const [partCode, setPartCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [minQty, setMinQty] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPartCode(part?.partCode ?? '');
    setName(part?.name ?? '');
    setUnit(part?.unit ?? '');
    setMinQty(part?.minQty === null || part === null ? '' : String(part.minQty));
    setActive(part?.active ?? true);
    setError(null);
  }, [open, part]);

  const create = useCreateItSparePart();
  const update = useUpdateItSparePart();
  const busy = create.isPending || update.isPending;

  const min = minQty.trim() === '' ? null : asInt(minQty);
  const valid =
    name.trim() !== '' &&
    unit.trim() !== '' &&
    (part !== null || partCode.trim() !== '') &&
    (min === null || (Number.isFinite(min) && min >= 0));

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (part === null) {
        await create.mutateAsync({
          partCode: partCode.trim(),
          name: name.trim(),
          unit: unit.trim(),
          ...(min === null ? {} : { minQty: min }),
        });
        toast.success(t('it.parts.created'));
      } else {
        await update.mutateAsync({
          id: part.id,
          body: { name: name.trim(), unit: unit.trim(), minQty: min, active, version: part.version },
        });
        toast.success(t('it.parts.updated'));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={part === null ? t('it.parts.add') : t('it.parts.edit')}
      description={t('it.parts.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('common.save')}
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
      <div className="grid gap-4 sm:grid-cols-2">
        {/* The code is the shelf label. It is fixed once movements point at it, so edit mode shows
            it read-only rather than offering a change the server would refuse. */}
        <Field label={t('it.parts.fields.partCode')} required={part === null}>
          <Input
            value={partCode}
            onChange={(e) => setPartCode(e.target.value)}
            disabled={part !== null}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.parts.fields.unit')} required hint={t('it.parts.unitHint')}>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <Field label={t('it.parts.fields.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('it.parts.fields.minQty')} hint={t('it.parts.minQtyHint')}>
          <Input
            type="number"
            min="0"
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
            dir="ltr"
          />
        </Field>
        {part !== null && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              label={t('it.parts.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.parts.archiveHint')}
            </p>
          </div>
        )}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.parts.ledgerNote')}
        </p>
      </div>
    </Dialog>
  );
};

export const ReceiveStockDialog = ({
  open,
  onClose,
  part,
}: {
  open: boolean;
  onClose: () => void;
  part: ItSparePartDto;
}): JSX.Element => {
  const t = useT();
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const receive = useReceiveItSparePart();

  useEffect(() => {
    if (open) {
      setQty('1');
      setNote('');
      setError(null);
    }
  }, [open]);

  const amount = asInt(qty);
  const valid = Number.isFinite(amount) && amount >= 1;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await receive.mutateAsync({
        id: part.id,
        body: { qty: amount, ...(note.trim() === '' ? {} : { note: note.trim() }) },
      });
      toast.success(t('it.parts.received'));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.parts.receive')}
      description={t('it.parts.receiveHint', { part: part.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={receive.isPending} disabled={!valid} onClick={() => void submit()}>
            {t('it.parts.receive')}
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
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('it.parts.currentOnHand', {
            qty: String(part.onHandQty),
            unit: part.unit,
          })}
        </p>
        <Field label={t('it.parts.fields.qty')} required>
          <Input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.parts.fields.note')} hint={t('it.parts.noteHint')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
