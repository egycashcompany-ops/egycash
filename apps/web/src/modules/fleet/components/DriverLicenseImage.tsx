// The driver's licence scan: the cell in the registry table, the preview dialog, and the hook that
// turns authorized bytes into something an `<img>` can show. It mirrors the vehicle's component
// deliberately — same actions, same wording, same failure modes — because a user who has learned
// the vehicle registry should not have to learn a second idiom on the drivers registry.
//
// Why bytes and not a URL: the file is guarded (ADR-023), so the platform's signed URL requires a
// bearer token — and an `<img src>` sends none. The image is fetched through the authenticated
// endpoint and handed to the browser as an object URL.
import { useEffect, useState } from 'react';
import { type FleetDriverProfileDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { fetchDriverLicenseImage } from '../api/fleet-api';
import { useDeleteDriverLicenseImage, useUploadDriverLicenseImage } from '../api/fleet-queries';
import { useEmployeeName } from './EmployeeName';

/** What the file picker offers and what the server's category accepts — kept in step deliberately. */
export const DRIVER_LICENSE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Load the driver's licence bytes as an object URL, revoking the previous one on every change.
 *
 * Keyed on `fileId` rather than the driver: replacing the image mints a new file, and that is
 * exactly when the browser must be told to stop showing the old one.
 */
export const useDriverLicenseImageUrl = (
  driverId: string,
  fileId: string | null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; failed: boolean }>({
    url: null,
    loading: false,
    failed: false,
  });

  useEffect(() => {
    if (fileId === null || driverId === '') {
      setState({ url: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: false });
    void fetchDriverLicenseImage(driverId)
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
  }, [driverId, fileId]);

  return state;
};

/**
 * The delete confirmation, shared by the preview, the table cell and the edit dialog so every
 * route to "remove this scan" asks the same question and says the same thing about what is (and
 * is not) removed.
 */
export const DriverLicenseImageDeleteDialog = ({
  open,
  onClose,
  driver,
}: {
  open: boolean;
  onClose: () => void;
  driver: FleetDriverProfileDto | null;
}): JSX.Element => {
  const t = useT();
  const remove = useDeleteDriverLicenseImage();
  const { name } = useEmployeeName(driver?.employeeId ?? '');

  const confirm = async (): Promise<void> => {
    if (driver === null) return;
    await remove.mutateAsync(driver.id);
    toast.success(t('fleet.drivers.licenseImage.deleted'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.drivers.licenseImage.deleteTitle')}
      description={driver === null ? '' : `${name ?? ''} — ${driver.licenseNumber}`.trim()}
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
        {t('fleet.drivers.licenseImage.deleteBody')}
      </p>
    </Dialog>
  );
};

/**
 * The preview. Its header is the DRIVER's identity — name, employee code and licence number —
 * because a scan of a driving licence is only meaningful next to the person it belongs to, and
 * those are the three facts that identify one driver among several with similar names.
 */
export const DriverLicenseImagePreviewDialog = ({
  open,
  onClose,
  driver,
}: {
  open: boolean;
  onClose: () => void;
  driver: FleetDriverProfileDto | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const fileId = driver?.licenseImage?.fileId ?? null;
  const { url, loading, failed } = useDriverLicenseImageUrl(driver?.id ?? '', open ? fileId : null);
  const { name, code } = useEmployeeName(driver?.employeeId ?? '');
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={t('fleet.drivers.licenseImage.previewTitle')}
        description={
          driver === null
            ? ''
            : t('fleet.drivers.licenseImage.previewSubtitle', {
                driver: name ?? '—',
                code: code ?? '—',
                license: driver.licenseNumber,
              })
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {can('fleetDriver.manage') && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('fleet.drivers.licenseImage.delete')}
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
            {t('fleet.drivers.licenseImage.loadFailed')}
          </p>
        )}
        {url !== null && (
          <img
            src={url}
            alt={t('fleet.drivers.licenseImage.previewTitle')}
            className="mx-auto max-h-[60vh] w-auto max-w-full rounded-lg border border-slate-200 object-contain dark:border-slate-800"
          />
        )}
      </Dialog>

      <DriverLicenseImageDeleteDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          onClose();
        }}
        driver={driver}
      />
    </>
  );
};

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/**
 * The registry table's licence-image cell: one upload action when there is no scan, view + delete
 * when there is. Upload posts straight from the cell and the row repaints from the invalidated
 * subtree — no page reload, and no dialog for a one-step action.
 */
export const DriverLicenseImageCell = ({
  driver,
  onPreview,
}: {
  driver: FleetDriverProfileDto;
  onPreview: (driver: FleetDriverProfileDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const upload = useUploadDriverLicenseImage();
  const [inputKey, setInputKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const mayManage = can('fleetDriver.manage');

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: driver.id, file });
    toast.success(t('fleet.drivers.licenseImage.uploaded'));
    // Remount the input so picking the SAME file again still fires a change event.
    setInputKey((k) => k + 1);
  };

  if (driver.licenseImage === null) {
    if (!mayManage) return <span className="text-slate-400">—</span>;
    return (
      <label className={`${actionButton} inline-flex cursor-pointer`}>
        <UploadIcon className="h-4 w-4" />
        <span className="sr-only">{t('fleet.drivers.licenseImage.upload')}</span>
        <input
          key={inputKey}
          type="file"
          accept={DRIVER_LICENSE_IMAGE_ACCEPT}
          className="hidden"
          disabled={upload.isPending}
          aria-label={t('fleet.drivers.licenseImage.upload')}
          title={t('fleet.drivers.licenseImage.upload')}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className={actionButton}
        aria-label={t('fleet.drivers.licenseImage.view')}
        title={t('fleet.drivers.licenseImage.view')}
        onClick={() => onPreview(driver)}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      {mayManage && (
        <button
          type="button"
          className={actionButton}
          aria-label={t('fleet.drivers.licenseImage.delete')}
          title={t('fleet.drivers.licenseImage.delete')}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <DriverLicenseImageDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        driver={driver}
      />
    </span>
  );
};

/**
 * The edit dialog's licence-image field: a thumbnail with view / delete / replace when a scan
 * exists, an upload button when it does not.
 *
 * It writes IMMEDIATELY rather than joining the form's save, and that is deliberate: the image is
 * a separate endpoint with its own version guard, so batching it into the profile PATCH would mean
 * one of the two writes silently winning. The user sees the result the moment it lands.
 */
export const DriverLicenseImageField = ({
  driver,
}: {
  driver: FleetDriverProfileDto;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const upload = useUploadDriverLicenseImage();
  const [inputKey, setInputKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const mayManage = can('fleetDriver.manage');
  const fileId = driver.licenseImage?.fileId ?? null;
  const { url, loading } = useDriverLicenseImageUrl(driver.id, fileId);

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: driver.id, file });
    toast.success(t('fleet.drivers.licenseImage.uploaded'));
    setInputKey((k) => k + 1);
  };

  const picker = (labelKey: string): JSX.Element => (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
      <UploadIcon className="h-4 w-4" />
      {t(labelKey)}
      <input
        key={inputKey}
        type="file"
        accept={DRIVER_LICENSE_IMAGE_ACCEPT}
        className="hidden"
        disabled={upload.isPending}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </label>
  );

  if (driver.licenseImage === null) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.drivers.licenseImage.none')}
        </span>
        {mayManage && picker('fleet.drivers.licenseImage.upload')}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {loading && (
        <span className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</span>
      )}
      {url !== null && (
        <button
          type="button"
          onClick={() => setPreviewing(true)}
          aria-label={t('fleet.drivers.licenseImage.view')}
          title={t('fleet.drivers.licenseImage.view')}
        >
          <img
            src={url}
            alt={t('fleet.drivers.licenseImage.previewTitle')}
            className="h-16 w-auto rounded-md border border-slate-200 object-contain dark:border-slate-800"
          />
        </button>
      )}
      <button
        type="button"
        className={actionButton}
        aria-label={t('fleet.drivers.licenseImage.view')}
        title={t('fleet.drivers.licenseImage.view')}
        onClick={() => setPreviewing(true)}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      {mayManage && (
        <>
          {picker('fleet.drivers.licenseImage.replace')}
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.drivers.licenseImage.delete')}
            title={t('fleet.drivers.licenseImage.delete')}
            onClick={() => setConfirming(true)}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </>
      )}
      <DriverLicenseImagePreviewDialog
        open={previewing}
        onClose={() => setPreviewing(false)}
        driver={driver}
      />
      <DriverLicenseImageDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        driver={driver}
      />
    </div>
  );
};
