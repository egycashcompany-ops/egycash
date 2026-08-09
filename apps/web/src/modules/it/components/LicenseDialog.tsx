// Create/edit a licence (design §2.8, §13-Q5).
//
// Two nulls carry meaning and the form says so rather than leaving them blank-looking: an empty
// seats field is UNLIMITED, and an empty expiry is PERPETUAL. Both are business facts, not missing
// data, and a user who reads them as "not filled in yet" will keep trying to fill them.
//
// The licence key is a plain field. §13-Q5 adopted plain text under `itLicense.view`, so masking it
// here would be theatre — the permission is the boundary, and pretending otherwise teaches the
// wrong lesson about where the protection lives.
import { useEffect, useState } from 'react';
import { type ItLicenseDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItLicense, useUpdateItLicense } from '../api/it-queries';
import { SoftwareProductPicker } from './SoftwareProductPicker';
import { VendorPicker } from './VendorPicker';

const asInt = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
};

const asDateInput = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

export const LicenseDialog = ({
  open,
  onClose,
  license,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  license: ItLicenseDto | null;
}): JSX.Element => {
  const t = useT();
  const [productId, setProductId] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [seats, setSeats] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProductId(license?.productId ?? '');
    setLicenseKey(license?.licenseKey ?? '');
    setSeats(license?.seats === null || license === null ? '' : String(license.seats));
    setExpiresAt(asDateInput(license?.expiresAt ?? null));
    setVendorId(license?.purchase?.vendorId ?? '');
    setInvoiceRef(license?.purchase?.invoiceRef ?? '');
    setCost(license?.purchase?.cost === undefined || license?.purchase?.cost === null ? '' : String(license.purchase.cost));
    setNotes(license?.notes ?? '');
    setError(null);
  }, [open, license]);

  const create = useCreateItLicense();
  const update = useUpdateItLicense();
  const busy = create.isPending || update.isPending;

  const seatCount = seats.trim() === '' ? null : asInt(seats);
  const costValue = cost.trim() === '' ? null : Number(cost);
  const valid =
    (license !== null || productId !== '') &&
    (seatCount === null || (Number.isFinite(seatCount) && seatCount >= 1));

  const purchase = (): { vendorId: string | null; invoiceRef: string | null; cost: number | null } => ({
    vendorId: vendorId === '' ? null : vendorId,
    invoiceRef: invoiceRef.trim() === '' ? null : invoiceRef.trim(),
    cost: costValue !== null && Number.isFinite(costValue) ? costValue : null,
  });
  const hasPurchase = vendorId !== '' || invoiceRef.trim() !== '' || cost.trim() !== '';

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (license === null) {
        await create.mutateAsync({
          productId,
          ...(licenseKey.trim() === '' ? {} : { licenseKey: licenseKey.trim() }),
          ...(seatCount === null ? {} : { seats: seatCount }),
          ...(expiresAt === '' ? {} : { expiresAt: new Date(expiresAt) }),
          ...(hasPurchase ? { purchase: purchase() } : {}),
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        });
        toast.success(t('it.licenses.created'));
      } else {
        await update.mutateAsync({
          id: license.id,
          body: {
            licenseKey: licenseKey.trim() === '' ? null : licenseKey.trim(),
            seats: seatCount,
            expiresAt: expiresAt === '' ? null : new Date(expiresAt),
            purchase: hasPurchase ? purchase() : null,
            notes: notes.trim() === '' ? null : notes.trim(),
            version: license.version,
          },
        });
        toast.success(t('it.licenses.updated'));
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
      title={license === null ? t('it.licenses.add') : t('it.licenses.edit')}
      description={t('it.licenses.dialogHint')}
      size="lg"
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
        {/* Fixed at creation: re-pointing a licence would move every seat it has already issued
            to a product those installations never used. */}
        {license === null && (
          <div className="sm:col-span-2">
            <Field label={t('it.licenses.fields.product')} required>
              <SoftwareProductPicker value={productId} onChange={setProductId} />
            </Field>
          </div>
        )}
        <Field label={t('it.licenses.fields.seats')} hint={t('it.licenses.seatsHint')}>
          <Input
            type="number"
            min="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('it.licenses.fields.expiresAt')} hint={t('it.licenses.expiryHint')}>
          <Input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.licenses.fields.licenseKey')} hint={t('it.licenses.keyHint')}>
            <Input value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} dir="ltr" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('it.licenses.fields.vendor')}>
            <VendorPicker value={vendorId} onChange={setVendorId} />
          </Field>
        </div>
        <Field label={t('it.licenses.fields.invoiceRef')}>
          <Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('it.licenses.fields.cost')}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('it.licenses.fields.notes')}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.licenses.derivedNote')}
        </p>
      </div>
    </Dialog>
  );
};
