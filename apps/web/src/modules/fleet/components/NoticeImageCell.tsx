// A notice's two scans on the notices table — «الصور والاجراءات تكون نفس شاشه السيارات»: the same
// cell the vehicle licence and the dealership invoice have. No scan → an upload control (on a
// phone: the camera, or a picture already on it); a scan → view, print, delete. The bytes are
// guarded, so they are fetched with the session and shown as an object URL.
import { useEffect, useState } from 'react';
import { type FleetNoticeDto, type FleetNoticeImageKind, type Locale } from '@ecms/contracts';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { EyeIcon, PrinterIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { ZoomableImage } from './ZoomableImage';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { printLicenceRecord } from './vehicle-print';
import { fetchNoticeImage } from '../api/fleet-api';
import { useDeleteNoticeImage, useUploadNoticeImage } from '../api/fleet-queries';
import { noticeTemplate } from '../lib/notice-templates';

export const NOTICE_ACTION_BUTTON =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/**
 * What identifies the image a row shows for a kind — the file, or for a licence where it comes
 * from — `null` when there is none. Keys the fetched picture, so a new upload is fetched anew.
 */
const imageKey = (row: FleetNoticeDto, kind: FleetNoticeImageKind): string | null => {
  switch (kind) {
    case 'check':
      return row.checkImage?.fileId ?? null;
    case 'notice':
      return row.noticeImage?.fileId ?? null;
    case 'vehicleLicense':
      return row.vehicleLicense;
    case 'driverLicense':
      return row.driverLicense;
  }
};

/**
 * Whether the image is the NOTICE's own — only that can be removed from here. A licence the
 * registry holds belongs to the vehicles or the drivers screen.
 */
export const ownNoticeImage = (row: FleetNoticeDto, kind: FleetNoticeImageKind): boolean =>
  kind === 'vehicleLicense'
    ? row.vehicleLicense === 'notice'
    : kind === 'driverLicense'
      ? row.driverLicense === 'notice'
      : imageKey(row, kind) !== null;

/** The scan as an object URL, revoked on every change — keyed on the file, not the row. */
const useNoticeImageUrl = (
  rowId: string,
  kind: FleetNoticeImageKind,
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
    void fetchNoticeImage(rowId, kind)
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
  }, [rowId, kind, fileId]);
  return state;
};

/** What the preview and the printed sheet call the notice: car, number, date, insurer. */
const identity = (row: FleetNoticeDto) => ({
  code: row.vehicleCode ?? '—',
  number: row.noticeNumber ?? '—',
  date: row.noticeDate === null ? '—' : row.noticeDate.slice(0, 10).replace(/-/gu, '/'),
  insurer: noticeTemplate(row.template)?.insurer ?? row.template,
});

export interface NoticeImageTarget {
  row: FleetNoticeDto;
  kind: FleetNoticeImageKind;
}

export const NoticeImageDeleteDialog = ({
  target,
  onClose,
}: {
  target: NoticeImageTarget | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const remove = useDeleteNoticeImage();
  const confirm = async (): Promise<void> => {
    if (target === null) return;
    try {
      await remove.mutateAsync({ id: target.row.id, kind: target.kind });
      toast.success(t('fleet.notices.image.deleted'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t(`fleet.notices.image.${target?.kind ?? 'notice'}.deleteTitle`)}
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
        {t('fleet.notices.image.deleteBody')}
      </p>
    </Dialog>
  );
};

export const NoticeImagePreviewDialog = ({
  target,
  onClose,
}: {
  target: NoticeImageTarget | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const row = target?.row ?? null;
  const kind = target?.kind ?? 'notice';
  const fileId = row === null ? null : imageKey(row, kind);
  const { url, loading, failed } = useNoticeImageUrl(row?.id ?? '', kind, fileId);
  const [confirming, setConfirming] = useState<NoticeImageTarget | null>(null);
  return (
    <>
      <Dialog
        open={target !== null}
        onClose={onClose}
        size="xl"
        title={t(`fleet.notices.image.${kind}.title`)}
        description={row === null ? '' : t('fleet.notices.image.subtitle', identity(row))}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {can('fleetNotice.edit') && target !== null && ownNoticeImage(target.row, kind) && (
              <Button variant="danger" onClick={() => setConfirming(target)}>
                {t(`fleet.notices.image.${kind}.delete`)}
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
        {url !== null && <ZoomableImage src={url} alt={t(`fleet.notices.image.${kind}.title`)} />}
      </Dialog>
      <NoticeImageDeleteDialog
        target={confirming}
        onClose={() => {
          setConfirming(null);
          onClose();
        }}
      />
    </>
  );
};

/** Print the scan with the notice's identity above it — the licence sheet's own builder. */
export const printNoticeImage = async (
  row: FleetNoticeDto,
  kind: FleetNoticeImageKind,
  locale: Locale,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<void> => {
  const who = identity(row);
  await printLicenceRecord({
    locale,
    title: t(`fleet.notices.image.${kind}.title`),
    subtitle: t('fleet.notices.image.subtitle', who),
    rows: [
      { label: t('fleet.notices.columns.code'), value: who.code },
      { label: t('fleet.notices.columns.number'), value: who.number },
      { label: t('fleet.notices.columns.date'), value: who.date },
      { label: t('fleet.notices.columns.template'), value: who.insurer },
    ],
    licenseImage:
      imageKey(row, kind) === null
        ? null
        : {
            fetch: () => fetchNoticeImage(row.id, kind),
            heading: t(`fleet.notices.image.${kind}.title`),
            caption: t('fleet.notices.image.subtitle', who),
          },
  });
};

export const NoticeImageCell = ({
  row,
  kind,
  onPreview,
}: {
  row: FleetNoticeDto;
  kind: FleetNoticeImageKind;
  onPreview: (target: NoticeImageTarget) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const upload = useUploadNoticeImage();
  const [confirming, setConfirming] = useState<NoticeImageTarget | null>(null);
  const mayEdit = can('fleetNotice.edit');

  const pick = async (file: File): Promise<void> => {
    try {
      await upload.mutateAsync({ id: row.id, kind, file });
      toast.success(t('fleet.notices.image.uploaded'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  if (imageKey(row, kind) === null) {
    if (!mayEdit) return <span className="text-slate-400">—</span>;
    return (
      <PhotoPickButton
        accept={LICENSE_IMAGE_ACCEPT}
        className={`${NOTICE_ACTION_BUTTON} inline-flex`}
        disabled={upload.isPending}
        label={t(`fleet.notices.image.${kind}.upload`)}
        data-notice-image-upload={`${kind}:${row.id}`}
        onFile={(file) => void pick(file)}
      >
        <UploadIcon className="h-4 w-4" />
      </PhotoPickButton>
    );
  }

  return (
    <span className="flex items-center justify-center gap-1">
      <button
        type="button"
        className={NOTICE_ACTION_BUTTON}
        aria-label={t(`fleet.notices.image.${kind}.view`)}
        title={t(`fleet.notices.image.${kind}.view`)}
        onClick={() => onPreview({ row, kind })}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={NOTICE_ACTION_BUTTON}
        aria-label={t('common.print')}
        title={t('common.print')}
        onClick={() => void printNoticeImage(row, kind, locale, t)}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {mayEdit && (
        <button
          type="button"
          data-notice-image-delete={`${kind}:${row.id}`}
          className={NOTICE_ACTION_BUTTON}
          aria-label={t(`fleet.notices.image.${kind}.delete`)}
          title={t(`fleet.notices.image.${kind}.delete`)}
          onClick={() => setConfirming({ row, kind })}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <NoticeImageDeleteDialog target={confirming} onClose={() => setConfirming(null)} />
    </span>
  );
};
