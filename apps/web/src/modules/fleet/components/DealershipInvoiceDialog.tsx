// «تسجيل فاتورة التوكيل» — writing the bill onto a row the workshop opened.
//
// The grey facts (exit date, car, work) came with the row and are not edited here. What the clerk
// writes: the invoice number and amount, whether the car is «ملاكي» (preset from its operation,
// theirs to change), the insurer, and the photo of the bill. «التوكيل لما بسجل فاتوره عاوز الحاجات
// دى تتحفظ زى ما هى ولا تنقص من الكروت ولا تنقص من العهدة»: what is written is saved as written, and
// nothing else moves — the form says no «الجهة» any more. «ملاكي» still lets a private car's
// invoice go without a number, as it always did.
//
// «الافتراضى بتاع الربي فى التامين لا يوجد حتى لو العربيه فيها تامين بس لو فيها تامين اقدر ادوس على
// السهم واختار»: the insurer opens on «لا يوجد» for every bill; the arrow offers the car's own
// insurer as شاشة السيارات records it, nothing typed. «وانا بسجل الفاتوره اعملى اوبشن ان اضيف صوره
// ولو تليفون يبقى كاميرا او اختار من الملفات»: the receipt form's photo box, the camera on a phone.
import { useEffect, useMemo, useState } from 'react';
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { MoneyInput } from '../../../shared/ui/MoneyInput';
import { PhotoSourceButtons } from '../../../shared/ui/PhotoPick';
import { CloseIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from './FuelCardBoard';
import { FILTER_ICON } from './FilterWithIcon';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { useUpdateDealershipInvoice, useUploadDealershipImage } from '../api/fleet-queries';
import {
  dealershipCarInsurer,
  dealershipInsurerOptions,
  dealershipPhotoProblem,
} from '../lib/dealership-invoice';

/** «حسن الفورم»: a section's name over its boxes. */
const SectionTitle = ({ children }: { children: string }): JSX.Element => (
  <h3 className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
    <span className="h-3.5 w-1 rounded-full bg-brand-500" />
    {children}
  </h3>
);

/** One fact the workshop wrote — read here, never edited: an icon, its name, its value. */
const Fact = ({
  icon,
  label,
  value,
  aside,
  valueClass,
}: {
  icon: readonly string[];
  label: string;
  value: string;
  aside?: JSX.Element;
  valueClass?: string;
}): JSX.Element => (
  <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-[#0c121e]">
    <span className="shrink-0 rounded-lg bg-brand-500/10 p-2 text-brand-600 dark:text-brand-300">
      <BoardIcon d={icon} className="h-4 w-4" />
    </span>
    <span className="min-w-0 flex-1 leading-tight">
      <span className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {aside}
      </span>
      <span
        className={cn(
          'block truncate text-base font-bold text-slate-900 dark:text-white',
          valueClass,
        )}
      >
        {value}
      </span>
    </span>
  </div>
);

/** The picked photo as an object URL for its thumbnail, revoked when it changes or goes. */
const usePreviewUrl = (file: File | null): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file === null) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
};

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export const DealershipInvoiceDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetDealershipInvoiceDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [invoiceNumber, setInvoiceNumber] = useState(row?.invoiceNumber ?? '');
  const [invoiceAmount, setInvoiceAmount] = useState(
    row === null || row.invoiceAmount === null ? '' : String(row.invoiceAmount),
  );
  const [privateCar, setPrivateCar] = useState(row?.privateCar ?? false);
  // The insurer the bill names, by id — '' is «لا يوجد».
  const [insurerId, setInsurerId] = useState(row?.insuranceCompanyId ?? '');
  // The bill's photo, held until the invoice is saved; the key empties the box after a refusal.
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const preview = usePreviewUrl(file);

  useEffect(() => {
    if (!open || row === null) return;
    setInvoiceNumber(row.invoiceNumber ?? '');
    setInvoiceAmount(row.invoiceAmount === null ? '' : String(row.invoiceAmount));
    setPrivateCar(row.privateCar);
    // «دلوقتى اخترت عربيه وعليها تامين يكون لا يوجد»: what the bill itself carries — «لا يوجد»
    // on every new one (the server opens them so), the stored insurer on one saved with it.
    setInsurerId(row.insuranceCompanyId ?? '');
    setFile(null);
    setInputKey((k) => k + 1);
  }, [open, row]);

  // «لما ادوس على السهم اقدر اختار التامين اللى فى شاشه السيارات»: the car's insurer under the
  // arrow, beside «لا يوجد», named in the reader's language — and a stored one that is not the
  // car's, so an edit still shows it.
  const insurerOptions = useMemo(
    () => (row === null ? [] : dealershipInsurerOptions(row, locale)),
    [row, locale],
  );
  // The hint says which it is: no insurer on the car, one archived in قوائم الحركة, or one offered.
  const carInsurer = row === null ? null : dealershipCarInsurer(row, locale);
  const insurerHint =
    carInsurer?.kind === 'none'
      ? t('fleet.dealership.insurerCarNone')
      : carInsurer?.kind === 'archived'
        ? t('fleet.dealership.insurerCarInactive', { name: carInsurer.name })
        : t('fleet.dealership.insurerHint');

  const update = useUpdateDealershipInvoice();
  const upload = useUploadDealershipImage();
  const pending = update.isPending || upload.isPending;

  const amount = Number(invoiceAmount);
  const amountOk = invoiceAmount !== '' && Number.isFinite(amount) && amount >= 0;
  const numberOk = privateCar || invoiceNumber.trim() !== '';
  // Save stays pressable: pressing it short of these names them and turns their boxes red
  // (`useRequiredFields`). Without a row there is nothing to save — `submit` returns on its own.
  const required = useRequiredFields(
    [
      { key: 'invoiceAmount', label: t('fleet.dealership.columns.invoiceAmount'), ok: amountOk },
      { key: 'invoiceNumber', label: t('fleet.dealership.columns.invoiceNumber'), ok: numberOk },
    ],
    open,
  );

  /** A pick from the box, the camera or the device — refused here when the upload would be. */
  const take = (picked: File | undefined): void => {
    if (picked === undefined) return;
    const problem = dealershipPhotoProblem(picked);
    if (problem !== null) {
      toast.error(t(`fleet.dealership.image.${problem}`));
      setInputKey((k) => k + 1);
      return;
    }
    setFile(picked);
  };
  const dropPhoto = (): void => {
    setFile(null);
    setInputKey((k) => k + 1);
  };

  const submit = async (): Promise<void> => {
    if (row === null) return;
    const storedInsurer = row.insuranceCompanyId ?? '';
    await update.mutateAsync({
      id: row.id,
      body: {
        invoiceNumber: invoiceNumber.trim() === '' ? null : invoiceNumber.trim(),
        invoiceAmount: amount,
        privateCar,
        // Sent only when the clerk changed it — a saved bill keeps what it was saved with.
        ...(insurerId === storedInsurer
          ? {}
          : { insuranceCompanyId: insurerId === '' ? null : insurerId }),
        version: row.version,
      },
    });
    // The photo goes up once the bill is saved, through the table's own endpoint — a bill holds
    // one photo, so a new one replaces the stored one.
    if (file !== null) {
      try {
        await upload.mutateAsync({ id: row.id, file });
      } catch {
        // The invoice IS saved (its version moved, so a second Save here would be refused): say
        // so and close — the reason itself was already toasted, and the column still uploads.
        toast.warning(t('fleet.dealership.image.notUploaded'));
        onClose();
        return;
      }
    }
    toast.success(t('fleet.dealership.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissOnOutsideClick={false}
      size="lg"
      title={t('fleet.dealership.recordTitle', { code: row?.vehicleCode ?? '—' })}
      description={t('fleet.dealership.recordHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={required.guard(submit)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {row !== null && (
        <div className="space-y-4">
          <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
          {/* The workshop's facts: what it knew. Read, not written — tiles, not greyed boxes. */}
          <section className="space-y-2">
            <SectionTitle>{t('fleet.dealership.form.workshop')}</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
              <Fact
                icon={PATH.calendar}
                label={t('fleet.dealership.columns.outDate')}
                value={formatDate(row.outDate, locale)}
                valueClass={NUM}
              />
              {/* «علامه ملاكى … فوق كود السياره»: the tick sits on the car code's own label line,
                  so it takes no column of its own. */}
              <Fact
                icon={FILTER_ICON.car}
                label={t('fleet.odometer.columns.vehicle')}
                value={row.vehicleCode ?? '—'}
                valueClass={NUM}
                aside={
                  // «مش عاجبنى شكل العربيه بعلامه صح جمبها»: a switch on the label line, purple
                  // when on, rather than a bare tick box.
                  <button
                    type="button"
                    role="switch"
                    aria-checked={privateCar}
                    data-dealership-private="true"
                    title={t('fleet.dealership.privateCarHint')}
                    onClick={() => setPrivateCar((on) => !on)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pe-2 ps-1 text-[11px] font-bold transition active:scale-95',
                      privateCar
                        ? 'border-brand-500/60 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                        : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
                    )}
                  >
                    <span
                      className={cn(
                        'relative h-3.5 w-6 rounded-full transition-colors',
                        privateCar ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all',
                          privateCar ? 'start-3' : 'start-0.5',
                        )}
                      />
                    </span>
                    {t('fleet.dealership.privateCar')}
                  </button>
                }
              />
              <Fact
                icon={FILTER_ICON.motor}
                label={t('fleet.dealership.columns.workType')}
                value={row.workTypeLabel}
              />
            </div>
          </section>
          <section className="space-y-2">
            <SectionTitle>{t('fleet.dealership.form.invoice')}</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('fleet.vehicles.fields.insuranceCompany')} hint={insurerHint}>
                <Select
                  value={insurerId}
                  onChange={(e) => setInsurerId(e.target.value)}
                  data-dealership-insurer="true"
                >
                  <option value="">{t('fleet.dealership.noInsurer')}</option>
                  {insurerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('fleet.dealership.columns.invoiceAmount')}
                required
                missing={required.isMissing('invoiceAmount')}
              >
                <MoneyInput value={invoiceAmount} onChange={setInvoiceAmount} />
              </Field>
              <Field
                label={t('fleet.dealership.columns.invoiceNumber')}
                required={!privateCar}
                missing={required.isMissing('invoiceNumber')}
              >
                {/* «اختياري لسيارة ملاكي» once, inside the empty box — no hint under it saying the
                    same words again. */}
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={privateCar ? t('fleet.dealership.invoiceNumberPrivate') : ''}
                  data-dealership-invoice-number="true"
                />
              </Field>
            </div>
          </section>
          {/* «اضيف صوره»: optional, as on the receipt form — the whole dashed box is the file
              picker; on a phone the camera and the device's pictures sit under it. */}
          <section className="space-y-2" data-dealership-photo="true">
            <SectionTitle>{t('fleet.dealership.image.title')}</SectionTitle>
            <div
              className={cn(
                'group relative cursor-pointer rounded-xl border-2 border-dashed p-3 transition-all',
                file === null
                  ? 'border-slate-200 bg-slate-50 hover:border-brand-500/50 dark:border-slate-700 dark:bg-[#0c121e]'
                  : 'border-brand-500/60 bg-brand-500/5 dark:bg-brand-500/10',
              )}
            >
              <input
                key={inputKey}
                type="file"
                accept={LICENSE_IMAGE_ACCEPT}
                aria-label={t('fleet.dealership.image.title')}
                title={t('fleet.dealership.image.title')}
                disabled={pending}
                onChange={(e) => take(e.target.files?.[0])}
                data-dealership-image="true"
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              />
              <div
                className={cn(
                  'pointer-events-none flex items-center gap-3',
                  // Room for the remove button drawn over the box's end.
                  file !== null && 'pe-9',
                )}
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  {preview === null ? (
                    <BoardIcon d={PATH.image} className="h-6 w-6" />
                  ) : (
                    <img
                      src={preview}
                      alt={t('fleet.dealership.image.title')}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-bold text-slate-900 dark:text-white"
                    data-dealership-photo-state={
                      file !== null ? 'picked' : row.image !== null ? 'stored' : 'none'
                    }
                  >
                    {file !== null
                      ? file.name
                      : row.image !== null
                        ? t('fleet.dealership.image.stored', { name: row.image.fileName })
                        : t('fleet.dealership.image.pickTitle')}
                  </p>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {file !== null
                      ? t('fleet.dealership.image.picked', { size: megabytes(file.size) })
                      : row.image !== null
                        ? t('fleet.dealership.image.replaceHint')
                        : t('fleet.dealership.image.pickHint')}
                  </p>
                </div>
                {file === null && (
                  <span className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition group-hover:border-brand-500/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    {t('fleet.fuelCards.image.pick')}
                  </span>
                )}
              </div>
              {/* Above the box's own picker, so a press removes the photo instead of re-picking. */}
              {file !== null && (
                <button
                  type="button"
                  data-dealership-photo-remove="true"
                  aria-label={t('fleet.dealership.image.remove')}
                  title={t('fleet.dealership.image.remove')}
                  disabled={pending}
                  onClick={dropPhoto}
                  className="absolute end-2 top-1/2 z-20 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            <PhotoSourceButtons accept={LICENSE_IMAGE_ACCEPT} onFile={take} disabled={pending} />
          </section>
        </div>
      )}
    </Dialog>
  );
};
