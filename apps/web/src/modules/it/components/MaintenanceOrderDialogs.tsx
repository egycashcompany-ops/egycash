// The four maintenance-order dialogs (design §4.7).
//
// Each transition is a DIALOG on the order, never a route: a URL that performs a state change is a
// URL someone can bookmark, share or reload into a second transition — and `complete` is precisely
// the one nobody wants to fire twice, because it consumes stock.
//
// Two things the screens must say out loud, because the server enforces them and a user who learns
// them from a 409 has already lost work:
//   * starting takes the asset OUT of service, and completing puts it back where it was;
//   * consumption is order-tied and cannot go below zero (FR-9), so the parts rows show what is on
//     hand and refuse to ask for more.
import { useEffect, useState } from 'react';
import { type ItMaintenanceOrderDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { CloseIcon, PlusIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCancelItMaintenanceOrder,
  useCompleteItMaintenanceOrder,
  useCreateItMaintenanceOrder,
  useStartItMaintenanceOrder,
} from '../api/it-queries';
import { AssetPicker } from './AssetPicker';
import { SparePartPicker } from './SparePartPicker';
import { VendorPicker } from './VendorPicker';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const Alert = ({ message }: { message: string }): JSX.Element => (
  <p
    role="alert"
    className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
  >
    {message}
  </p>
);

const Note = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
    {children}
  </p>
);

// ── Create (corrective) ─────────────────────────────────────────────────────

/**
 * `kind` is not on this form, and its absence is the design: a preventive order is born from the
 * sweep against a plan (§4.6), never from a person — one raised by hand would sit in a plan's
 * history that no plan generated.
 */
export const CreateMaintenanceOrderDialog = ({
  open,
  onClose,
  onCreated,
  assetId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (order: ItMaintenanceOrderDto) => void;
  /** Pre-picked when raised from an asset's own screen. */
  assetId?: string;
}): JSX.Element => {
  const t = useT();
  const [asset, setAsset] = useState(assetId ?? '');
  const [vendorId, setVendorId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateItMaintenanceOrder();

  useEffect(() => {
    if (open) {
      setAsset(assetId ?? '');
      setVendorId('');
      setScheduledFor('');
      setSummary('');
      setError(null);
    }
  }, [open, assetId]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const order = await create.mutateAsync({
        assetId: asset,
        ...(vendorId === '' ? {} : { vendorId }),
        ...(scheduledFor === '' ? {} : { scheduledFor: new Date(scheduledFor) }),
        ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
      });
      toast.success(t('it.maintenance.created'));
      onCreated?.(order);
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.maintenance.create')}
      description={t('it.maintenance.createHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} disabled={asset === ''} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.maintenance.fields.asset')} required>
          <AssetPicker value={asset} onChange={setAsset} />
        </Field>
        <Field label={t('it.maintenance.fields.scheduledFor')} hint={t('it.maintenance.scheduledHint')}>
          <Input
            type="date"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.maintenance.fields.vendor')} hint={t('it.maintenance.vendorHint')}>
          <VendorPicker value={vendorId} onChange={setVendorId} />
        </Field>
        <Field label={t('it.maintenance.fields.summary')}>
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Note>{t('it.maintenance.correctiveOnly')}</Note>
      </div>
    </Dialog>
  );
};

// ── Start ───────────────────────────────────────────────────────────────────

export const StartMaintenanceOrderDialog = ({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: ItMaintenanceOrderDto;
}): JSX.Element => {
  const t = useT();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = useStartItMaintenanceOrder();

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await start.mutateAsync({
        id: order.id,
        body: note.trim() === '' ? {} : { note: note.trim() },
      });
      toast.success(t('it.maintenance.started'));
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.maintenance.start')}
      description={t('it.maintenance.startHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={start.isPending} onClick={() => void submit()}>
            {t('it.maintenance.start')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.maintenance.fields.note')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {/* The rule the server enforces, said before it is hit rather than after. */}
        <Note>{t('it.maintenance.startCustodyWarning')}</Note>
      </div>
    </Dialog>
  );
};

// ── Complete (with parts) ───────────────────────────────────────────────────

/**
 * A chosen part carries its on-hand level with it. The dialog needs that number to warn before the
 * server refuses (FR-9), and a searching picker is the only way to have it without holding the
 * catalogue in the browser (ADR-019 rule 5).
 */
interface PartRow {
  partId: string;
  qty: string;
  onHandQty: number | null;
  unit: string;
}

export const CompleteMaintenanceOrderDialog = ({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: ItMaintenanceOrderDto;
}): JSX.Element => {
  const t = useT();
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');
  const [rows, setRows] = useState<PartRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const complete = useCompleteItMaintenanceOrder();

  useEffect(() => {
    if (open) {
      setSummary(order.summary ?? '');
      setCost(order.cost === null ? '' : String(order.cost));
      setRows([]);
      setError(null);
    }
  }, [open, order]);

  const setRow = (index: number, next: Partial<PartRow>): void =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));

  // Mirrors the server's rule so the reader sees it first; the server still decides.
  const overdrawn = rows.some((row) => {
    const qty = Number(row.qty);
    return row.onHandQty !== null && Number.isFinite(qty) && qty > row.onHandQty;
  });
  const rowsValid = rows.every((row) => row.partId !== '' && Number(row.qty) >= 1);
  const complete_ = summary.trim() !== '' && rowsValid && !overdrawn;

  const submit = async (): Promise<void> => {
    setError(null);
    const parsedCost = Number(cost);
    try {
      await complete.mutateAsync({
        id: order.id,
        body: {
          summary: summary.trim(),
          ...(cost.trim() === '' || !Number.isFinite(parsedCost) ? {} : { cost: parsedCost }),
          ...(rows.length === 0
            ? {}
            : { parts: rows.map((row) => ({ partId: row.partId, qty: Math.trunc(Number(row.qty)) })) }),
        },
      });
      toast.success(t('it.maintenance.completed'));
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.maintenance.complete')}
      description={t('it.maintenance.completeHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={complete.isPending}
            disabled={!complete_}
            onClick={() => void submit()}
          >
            {t('it.maintenance.complete')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.maintenance.fields.summary')} required>
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label={t('it.maintenance.fields.cost')} hint={t('it.maintenance.costHint')}>
          <MoneyInput value={cost} onChange={(next) => setCost(next)} />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('it.maintenance.partsUsed')}
            </span>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() =>
                setRows((prev) => [...prev, { partId: '', qty: '1', onHandQty: null, unit: '' }])
              }
            >
              {t('it.maintenance.addPart')}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('it.maintenance.noPartsUsed')}
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row, index) => {
                const qty = Number(row.qty);
                const tooMany =
                  row.onHandQty !== null && Number.isFinite(qty) && qty > row.onHandQty;
                return (
                  <li key={index} className="flex items-end gap-2">
                    <div className="flex-1">
                      <SparePartPicker
                        ariaLabel={t('it.maintenance.fields.part')}
                        value={row.partId}
                        onChange={(partId, part) =>
                          setRow(index, {
                            partId,
                            onHandQty: part === null ? null : part.onHandQty,
                            unit: part === null ? '' : part.unit,
                          })
                        }
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        type="number"
                        min="1"
                        aria-label={t('it.maintenance.fields.qty')}
                        value={row.qty}
                        onChange={(e) => setRow(index, { qty: e.target.value })}
                        dir="ltr"
                        {...(tooMany ? { 'aria-invalid': true } : {})}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={t('it.maintenance.removePart')}
                      title={t('it.maintenance.removePart')}
                      className="mb-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {overdrawn && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {t('it.maintenance.overdrawn')}
            </p>
          )}
        </div>

        <Note>
          {order.assetStatusBefore === null
            ? t('it.maintenance.completeAssetNote')
            : t('it.maintenance.completeRestores', {
                status: t(`it.assets.status.${order.assetStatusBefore}`),
              })}
        </Note>
      </div>
    </Dialog>
  );
};

// ── Cancel ──────────────────────────────────────────────────────────────────

export const CancelMaintenanceOrderDialog = ({
  open,
  onClose,
  order,
}: {
  open: boolean;
  onClose: () => void;
  order: ItMaintenanceOrderDto;
}): JSX.Element => {
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelItMaintenanceOrder();

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await cancel.mutateAsync({ id: order.id, body: { reason: reason.trim() } });
      toast.success(t('it.maintenance.cancelled'));
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.maintenance.cancel')}
      description={t('it.maintenance.cancelHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim() === ''}
            onClick={() => void submit()}
          >
            {t('it.maintenance.cancel')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.maintenance.fields.reason')} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Note>{t('it.maintenance.cancelTerminal')}</Note>
      </div>
    </Dialog>
  );
};
