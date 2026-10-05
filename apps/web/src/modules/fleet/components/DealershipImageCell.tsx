// The scan of a dealership invoice — «الصوره اللى فى الجدول تكون زى شاشة السيارات زى صوره
// الرخصه بالظبط»: the same cell the vehicle licence has. No scan → an upload control; a scan →
// view, print, delete. The bytes are guarded, so they are fetched with the session and shown as
// an object URL, exactly as the licence image is.
import { useEffect, useState } from 'react';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
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
import { fetchDealershipImage } from '../api/fleet-api';
import { useDeleteDealershipImage, useUploadDealershipImage } from '../api/fleet-queries';

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** The row's scan as an object URL, revoked on every change — keyed on the file, not the row. */
const useInvoiceImageUrl = (
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
    void fetchDealershipImage(rowId)
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

/** What the preview and the printed sheet call the row: car, exit date, work. */
const identity = (
  row: FleetDealershipInvoiceDto,
  locale: Locale,
): { code: string; date: string; work: string } => ({
  code: row.vehicleCode ?? '—',
  date: formatDate(row.outDate, locale),
  work: row.workTypeLabel,
});

export const DealershipImageDeleteDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetDealershipInvoiceDto | null;
}): JSX.Element => {
  const t = useT();
  const remove = useDeleteDealershipImage();
  const confirm = async (): Promise<void> => {
    if (row === null) return;
    await remove.mutateAsync(row.id);
    toast.success(t('fleet.dealership.image.deleted'));
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.dealership.image.deleteTitle')}
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
        {t('fleet.dealership.image.deleteBody')}
      </p>
    </Dialog>
  );
};

export const DealershipImagePreviewDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: FleetDealershipInvoiceDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fileId = row?.image?.fileId ?? null;
  const { url, loading, failed } = useInvoiceImageUrl(row?.id ?? '', open ? fileId : null);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t('fleet.dealership.image.title')}
        description={
          row === null ? '' : t('fleet.dealership.image.subtitle', identity(row, locale))
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {can('fleetDealership.edit') && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('fleet.dealership.image.delete')}
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
        {url !== null && <ZoomableImage src={url} alt={t('fleet.dealership.image.title')} />}
      </Dialog>
      <DealershipImageDeleteDialog
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

/** Print the scan with the row's identity above it — the licence sheet's own builder. */
export const printDealershipInvoice = async (
  row: FleetDealershipInvoiceDto,
  locale: Locale,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<void> => {
  const who = identity(row, locale);
  await printLicenceRecord({
    locale,
    title: t('fleet.dealership.image.title'),
    subtitle: t('fleet.dealership.image.subtitle', who),
    rows: [
      { label: t('fleet.odometer.columns.vehicle'), value: who.code },
      { label: t('fleet.dealership.columns.outDate'), value: who.date },
      { label: t('fleet.dealership.columns.workType'), value: who.work },
      { label: t('fleet.dealership.columns.invoiceNumber'), value: row.invoiceNumber ?? '—' },
    ],
    licenseImage:
      row.image === null
        ? null
        : {
            fetch: () => fetchDealershipImage(row.id),
            heading: t('fleet.dealership.image.title'),
            caption: t('fleet.dealership.image.subtitle', who),
          },
  });
};

export const DealershipImageCell = ({
  row,
  onPreview,
}: {
  row: FleetDealershipInvoiceDto;
  onPreview: (row: FleetDealershipInvoiceDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const upload = useUploadDealershipImage();
  const [confirming, setConfirming] = useState(false);
  const mayEdit = can('fleetDealership.edit');

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: row.id, file });
    toast.success(t('fleet.dealership.image.uploaded'));
  };

  if (row.image === null) {
    if (!mayEdit) return <span className="text-slate-400">—</span>;
    return (
      <PhotoPickButton
        accept={LICENSE_IMAGE_ACCEPT}
        className={`${actionButton} inline-flex`}
        disabled={upload.isPending}
        label={t('fleet.dealership.image.upload')}
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
        aria-label={t('fleet.dealership.image.view')}
        title={t('fleet.dealership.image.view')}
        onClick={() => onPreview(row)}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-dealership-print={row.id}
        className={actionButton}
        aria-label={t('common.print')}
        title={t('common.print')}
        onClick={() => void printDealershipInvoice(row, locale, t)}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {mayEdit && (
        <button
          type="button"
          data-dealership-image-delete={row.id}
          className={actionButton}
          aria-label={t('fleet.dealership.image.delete')}
          title={t('fleet.dealership.image.delete')}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <DealershipImageDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        row={row}
      />
    </span>
  );
};
