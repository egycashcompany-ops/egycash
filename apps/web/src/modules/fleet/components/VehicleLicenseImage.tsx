// The vehicle license scan: the cell in the registry table, the preview dialog, and the hook that
// turns authorized bytes into something an `<img>` can show.
//
// Why bytes and not a URL: the file is guarded (ADR-023), so the platform's signed URL requires a
// bearer token — and an `<img src>` sends none. The image is fetched through the authenticated
// endpoint and handed to the browser as an object URL, which is also what makes the print view
// possible (the same blob becomes a data URL there).
import { useEffect, useState } from 'react';
import { type FleetVehicleDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, TrashIcon, UploadIcon } from '../../../shared/ui/icons';
import { fetchVehicleLicenseImage } from '../api/fleet-api';
import {
  useDeleteVehicleLicenseImage,
  useUploadVehicleLicenseImage,
} from '../api/fleet-queries';

/** What the file picker offers and what the server's category accepts — kept in step deliberately. */
export const LICENSE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Load the vehicle's license bytes as an object URL, revoking the previous one on every change.
 *
 * Keyed on `fileId` rather than the vehicle: replacing the image mints a new file, and that is
 * exactly when the browser must be told to stop showing the old one.
 */
export const useLicenseImageUrl = (
  vehicleId: string,
  fileId: string | null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; failed: boolean }>({
    url: null,
    loading: false,
    failed: false,
  });

  useEffect(() => {
    if (fileId === null || vehicleId === '') {
      setState({ url: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: false });
    void fetchVehicleLicenseImage(vehicleId)
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
  }, [vehicleId, fileId]);

  return state;
};

/**
 * The delete confirmation, shared by the preview and the table cell so both routes to "remove this
 * scan" ask the same question and say the same thing about what is (and is not) removed.
 */
export const LicenseImageDeleteDialog = ({
  open,
  onClose,
  vehicle,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: FleetVehicleDto | null;
}): JSX.Element => {
  const t = useT();
  const remove = useDeleteVehicleLicenseImage();

  const confirm = async (): Promise<void> => {
    if (vehicle === null) return;
    await remove.mutateAsync(vehicle.id);
    toast.success(t('fleet.vehicles.licenseImage.deleted'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.vehicles.licenseImage.deleteTitle')}
      description={vehicle === null ? '' : `${vehicle.code} — ${vehicle.plateNumber}`}
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
        {t('fleet.vehicles.licenseImage.deleteBody')}
      </p>
    </Dialog>
  );
};

/**
 * The preview (§8). Its header is the vehicle's identity because a scan of a license is only
 * meaningful next to the car it belongs to — code and make, from the real record.
 */
export const LicenseImagePreviewDialog = ({
  open,
  onClose,
  vehicle,
  typeName,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: FleetVehicleDto | null;
  /** The vehicle TYPE's localized name — what the registry means by "make". */
  typeName: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const fileId = vehicle?.licenseImage?.fileId ?? null;
  const { url, loading, failed } = useLicenseImageUrl(vehicle?.id ?? '', open ? fileId : null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={t('fleet.vehicles.licenseImage.previewTitle')}
        description={
          vehicle === null
            ? ''
            : t('fleet.vehicles.licenseImage.previewSubtitle', {
                code: vehicle.code,
                make: typeName,
              })
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {can('fleetVehicle.edit') && vehicle?.status !== 'disposed' && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('fleet.vehicles.licenseImage.delete')}
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
        {url !== null && (
          <img
            src={url}
            alt={t('fleet.vehicles.licenseImage.previewTitle')}
            className="mx-auto max-h-[60vh] w-auto max-w-full rounded-lg border border-slate-200 object-contain dark:border-slate-800"
          />
        )}
      </Dialog>

      <LicenseImageDeleteDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          onClose();
        }}
        vehicle={vehicle}
      />
    </>
  );
};

const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/**
 * The registry table's license-image cell (§8): one upload action when there is no scan, view +
 * delete when there is. Upload posts straight from the cell and the row repaints from the
 * invalidated subtree — no page reload, and no dialog for a one-step action.
 */
export const VehicleLicenseImageCell = ({
  vehicle,
  onPreview,
}: {
  vehicle: FleetVehicleDto;
  onPreview: (vehicle: FleetVehicleDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const upload = useUploadVehicleLicenseImage();
  const [inputKey, setInputKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Editing a disposed vehicle is refused by the API (§4.1), so the action is not offered either.
  const mayEdit = can('fleetVehicle.edit') && vehicle.status !== 'disposed';

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: vehicle.id, file });
    toast.success(t('fleet.vehicles.licenseImage.uploaded'));
    // Remount the input so picking the SAME file again still fires a change event.
    setInputKey((k) => k + 1);
  };

  if (vehicle.licenseImage === null) {
    if (!mayEdit) return <span className="text-slate-400">—</span>;
    return (
      <label className={`${actionButton} inline-flex cursor-pointer`}>
        <UploadIcon className="h-4 w-4" />
        <span className="sr-only">{t('fleet.vehicles.licenseImage.upload')}</span>
        <input
          key={inputKey}
          type="file"
          accept={LICENSE_IMAGE_ACCEPT}
          className="hidden"
          disabled={upload.isPending}
          aria-label={t('fleet.vehicles.licenseImage.upload')}
          title={t('fleet.vehicles.licenseImage.upload')}
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
        aria-label={t('fleet.vehicles.licenseImage.view')}
        title={t('fleet.vehicles.licenseImage.view')}
        onClick={() => onPreview(vehicle)}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      {mayEdit && (
        <button
          type="button"
          className={actionButton}
          aria-label={t('fleet.vehicles.licenseImage.delete')}
          title={t('fleet.vehicles.licenseImage.delete')}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <LicenseImageDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        vehicle={vehicle}
      />
    </span>
  );
};
