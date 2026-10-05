// The photo of a receipt — the dealership invoice's cell (`DealershipImageCell`) for the receipts
// table: no photo → an upload control; a photo → view, print, delete. The bytes are guarded, so
// they are fetched with the session and shown as an object URL.
import { useEffect, useState } from 'react';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { type FleetReceiptDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, PrinterIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { ZoomableImage } from './ZoomableImage';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { printLicenceRecord } from './vehicle-print';
import { fetchReceiptImage } from '../api/fleet-api';
import { useDeleteReceiptImage, useUploadReceiptImage } from '../api/fleet-queries';

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

const useReceiptImageUrl = (
  rowId: string,
  fileId: string | null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; failed: boolean }>({
    url: null,
    loading: false,
    failed: false,
  });
  useEffect(() => {
    if (fileId === null || rowId === '') {
      setState({ url: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: false });
    void fetchReceiptImage(rowId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [rowId, fileId]);
  return state;
};

type T = (key: string, vars?: Record<string, string | number>) => string;

/** What the preview and the printed sheet call the row: car, date, kind. */
const identity = (
  row: FleetReceiptDto,
  locale: Locale,
  t: T,
): { code: string; date: string; kind: string } => ({
  code: row.vehicleCode ?? '—',
  date: formatDate(row.date, locale),
  kind: t(`fleet.receipts.kind.${row.kind}`),
});

export const ReceiptImageDeleteDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetReceiptDto | null;
}): JSX.Element => {
  const t = useT();
  const remove = useDeleteReceiptImage();
  const confirm = async (): Promise<void> => {
    if (row === null) return;
    await remove.mutateAsync(row.id);
    toast.success(t('fleet.receipts.image.deleted'));
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.receipts.image.deleteTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('fleet.receipts.image.deleteBody')}
      </p>
    </Dialog>
  );
};

export const ReceiptImagePreviewDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetReceiptDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fileId = row?.image?.fileId ?? null;
  const { url, loading, failed } = useReceiptImageUrl(row?.id ?? '', open ? fileId : null);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t('fleet.receipts.image.title')}
        description={
          row === null ? '' : t('fleet.receipts.image.subtitle', identity(row, locale, t))
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {can('fleetReceipt.edit') && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('fleet.receipts.image.delete')}
              </Button>
            )}
          </>
        }
      >
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}
        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('fleet.vehicles.licenseImage.loadFailed')}
          </p>
        )}
        {url !== null && <ZoomableImage src={url} alt={t('fleet.receipts.image.title')} />}
      </Dialog>
      <ReceiptImageDeleteDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          onClose();
        }}
        row={row}
      />
    </>
  );
};

/** Print the photo with the row's identity above it — the licence sheet's own builder. */
export const printReceipt = async (row: FleetReceiptDto, locale: Locale, t: T): Promise<void> => {
  const who = identity(row, locale, t);
  await printLicenceRecord({
    locale,
    title: t('fleet.receipts.image.title'),
    subtitle: t('fleet.receipts.image.subtitle', who),
    rows: [
      { label: t('fleet.odometer.columns.vehicle'), value: who.code },
      { label: t('fleet.receipts.columns.date'), value: who.date },
      { label: t('fleet.receipts.columns.kind'), value: who.kind },
      { label: t('fleet.receipts.columns.driver'), value: row.driverName ?? '—' },
      { label: t('fleet.receipts.columns.amount'), value: row.amount.toFixed(2) },
    ],
    licenseImage:
      row.image === null
        ? null
        : {
            fetch: () => fetchReceiptImage(row.id),
            heading: t('fleet.receipts.image.title'),
            caption: t('fleet.receipts.image.subtitle', who),
          },
  });
};

export const ReceiptImageCell = ({
  row,
  onPreview,
}: {
  row: FleetReceiptDto;
  onPreview: (row: FleetReceiptDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const upload = useUploadReceiptImage();
  const [confirming, setConfirming] = useState(false);
  const mayEdit = can('fleetReceipt.edit');

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: row.id, file });
    toast.success(t('fleet.receipts.image.uploaded'));
  };

  if (row.image === null) {
    if (!mayEdit) return <span className="text-slate-400">—</span>;
    return (
      <PhotoPickButton
        accept={LICENSE_IMAGE_ACCEPT}
        className={`${actionButton} inline-flex`}
        disabled={upload.isPending}
        label={t('fleet.receipts.image.upload')}
        onFile={(file) => void pick(file)}
      >
        <UploadIcon className="h-4 w-4" />
      </PhotoPickButton>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className={actionButton}
        aria-label={t('fleet.receipts.image.view')}
        title={t('fleet.receipts.image.view')}
        onClick={() => onPreview(row)}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-receipt-print={row.id}
        className={actionButton}
        aria-label={t('common.print')}
        title={t('common.print')}
        onClick={() => void printReceipt(row, locale, t)}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {mayEdit && (
        <button
          type="button"
          data-receipt-image-delete={row.id}
          className={actionButton}
          aria-label={t('fleet.receipts.image.delete')}
          title={t('fleet.receipts.image.delete')}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <ReceiptImageDeleteDialog open={confirming} onClose={() => setConfirming(false)} row={row} />
    </span>
  );
};
