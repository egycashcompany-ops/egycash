// «صوره كل فيزا» — the photo of a fuel card: on the card's line a frame with the eye (or the upload
// for a card with none), and the dialog that shows it large, replaces it and deletes it. The bytes
// are guarded, so they are fetched with the session and shown as an object URL.
//
// 6d: the photo shows the PIN written on the card's sticker, so the FULL photo opens only for a
// holder of `fleetFuelCard.reveal` («إظهار كلمة سر بطاقة الوقود») — the server refuses it to anyone
// else (403 on the card's endpoint, 404 through the Files screens), and this screen never asks for
// it without the grant. Everyone else sees the small blurred thumbnail (`GET …/image/thumb`,
// `fleetFuelCard.view`), not zoomable, with a line saying who sees the full photo. A photo uploaded
// before 6d has no thumbnail until an edit + reveal holder opens it; it is then made from the full
// photo and sent back once, silently.
import { useEffect, useRef, useState } from 'react';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, ImageIcon, UploadIcon } from '../../../shared/ui/icons';
import { IMAGE_EMPTY_BOX, IMAGE_GROUP, actionTone } from './row-actions-look';
import { CloudUploadIcon } from './row-action-icons';
import { ZoomableImage } from './ZoomableImage';
import { LICENSE_IMAGE_ACCEPT } from './VehicleLicenseImage';
import { fetchFuelCardImage } from '../api/fleet-api';
import {
  useBackfillFuelCardThumb,
  useDeleteFuelCardImage,
  useFuelCardThumb,
  useUploadFuelCardImage,
} from '../api/fleet-queries';
import { makeFuelCardThumb } from '../lib/fuel-card-thumb';

/** The grant that opens the FULL card photo — the one that shows the PIN. */
export const FULL_PHOTO_GRANT = 'fleetFuelCard.reveal';

/**
 * The FULL photo's bytes as an object URL — fetched only while `allowed` (the reader holds
 * `fleetFuelCard.reveal`) and a photo is there; `blob` is kept for the thumbnail back-fill.
 */
export const useFuelCardImageUrl = (
  cardId: string,
  fileId: string | null,
  allowed: boolean,
): { url: string | null; blob: Blob | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{
    url: string | null;
    blob: Blob | null;
    loading: boolean;
    failed: boolean;
  }>({ url: null, blob: null, loading: false, failed: false });
  useEffect(() => {
    if (!allowed || fileId === null || cardId === '') {
      setState({ url: null, blob: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, blob: null, loading: true, failed: false });
    void fetchFuelCardImage(cardId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, blob, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, blob: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [cardId, fileId, allowed]);
  return state;
};

/** A blob as an object URL for as long as it is shown; revoked when it changes or goes. */
const useObjectUrl = (blob: Blob | null | undefined): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (blob === undefined || blob === null) {
      setUrl(null);
      return undefined;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return url;
};

/**
 * The thumbnail as an object URL (`fleetFuelCard.view`) — `cardId` null, or `enabled` false: none;
 * none either when the card has no thumbnail (any more). The bytes are cached under the cards'
 * subtree and the photo's file id (`photoKey`), so the same photo's thumbnail is fetched once.
 */
export const useFuelCardThumbUrl = (
  cardId: string | null,
  enabled = true,
  photoKey: string | null = null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const thumb = useFuelCardThumb(cardId, enabled, photoKey);
  const url = useObjectUrl(thumb.data);
  return { url, loading: thumb.isLoading, failed: thumb.isError };
};

/**
 * 6d: a photo uploaded before this release has no thumbnail. When an edit + reveal holder has its
 * full photo open, the thumbnail is made from it and sent once — best effort, silent.
 */
const useThumbBackfill = (card: FleetFuelCardDto | null, blob: Blob | null): void => {
  const can = useCan();
  const backfill = useBackfillFuelCardThumb();
  const tried = useRef<string | null>(null);
  const needed =
    card !== null &&
    card.image !== null &&
    card.imageThumb === false &&
    blob !== null &&
    can('fleetFuelCard.edit') &&
    can(FULL_PHOTO_GRANT);
  const key = card === null ? null : `${card.id}:${card.image?.fileId ?? ''}`;
  useEffect(() => {
    if (!needed || card === null || blob === null || tried.current === key) return;
    tried.current = key;
    void makeFuelCardThumb(blob).then((thumb) => {
      if (thumb !== null) backfill.mutate({ id: card.id, thumb });
    });
    // `backfill` changes identity on every render; the guard above keeps this to once per photo.
  }, [needed, key, blob]);
};

/** The small thumbnail alone — what a reader without `fleetFuelCard.reveal` sees of the photo. */
export const FuelCardThumbOnly = ({ card }: { card: FleetFuelCardDto }): JSX.Element => {
  const t = useT();
  const { url, loading } = useFuelCardThumbUrl(
    card.id,
    card.image !== null && card.imageThumb === true,
    card.image?.fileId ?? null,
  );
  return (
    <div className="flex flex-col items-center gap-3 py-2" data-fuel-image-thumb-only={card.id}>
      {url !== null ? (
        <img
          src={url}
          alt={t('fleet.fuelCards.image.thumbAlt')}
          data-fuel-image-thumb={card.id}
          className="h-[100px] w-[160px] rounded-lg border border-slate-200 object-cover shadow-sm dark:border-slate-700"
        />
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      ) : (
        <p
          className="text-sm text-slate-500 dark:text-slate-400"
          data-fuel-image-no-thumb={card.id}
        >
          {t('fleet.fuelCards.image.noThumb')}
        </p>
      )}
      <p className="text-center text-[13px] text-slate-500 dark:text-slate-400">
        {t('fleet.fuelCards.image.thumbOnly')}
      </p>
    </div>
  );
};

/** A file input dressed as a button: picking a file uploads it onto the card. */
export const FuelCardImageUpload = ({
  card,
  label,
  className,
  children,
}: {
  card: FleetFuelCardDto;
  label: string;
  className?: string;
  children: JSX.Element | string;
}): JSX.Element => {
  const t = useT();
  const upload = useUploadFuelCardImage();
  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: card.id, file });
    toast.success(t('fleet.fuelCards.image.uploaded'));
  };
  return (
    <PhotoPickButton
      data-fuel-image-upload={card.id}
      accept={LICENSE_IMAGE_ACCEPT}
      className={className ?? IMAGE_EMPTY_BOX}
      disabled={upload.isPending}
      label={label}
      onFile={(file) => void pick(file)}
    >
      {children}
    </PhotoPickButton>
  );
};

/** The photo, large — with «تغيير الصورة» and «حذف الصورة» for a reader who may edit the card. */
export const FuelCardImageDialog = ({
  open,
  onClose,
  card,
  code,
}: {
  open: boolean;
  onClose: () => void;
  card: FleetFuelCardDto | null;
  /** What the tile calls the card's place — the car's code, or the label of a card on no car. */
  code: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const mayEdit = can('fleetFuelCard.edit');
  // 6d: the full photo (it shows the PIN) only for a holder of the reveal grant.
  const mayReveal = can(FULL_PHOTO_GRANT);
  const fileId = card?.image?.fileId ?? null;
  const { url, blob, loading, failed } = useFuelCardImageUrl(
    card?.id ?? '',
    open ? fileId : null,
    mayReveal,
  );
  useThumbBackfill(open ? card : null, blob);
  const remove = useDeleteFuelCardImage();
  const [confirming, setConfirming] = useState(false);
  const confirmDelete = async (): Promise<void> => {
    if (card === null) return;
    await remove.mutateAsync(card.id);
    toast.success(t('fleet.fuelCards.image.deleted'));
    setConfirming(false);
    onClose();
  };
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t('fleet.fuelCards.image.title')}
        description={
          card === null
            ? ''
            : t('fleet.fuelCards.image.subtitle', {
                code,
                company: t(`fleet.fuelCards.company.${card.company}`),
                number: card.number,
              })
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {mayEdit && card !== null && (
              <FuelCardImageUpload
                card={card}
                label={t('fleet.fuelCards.image.replace')}
                className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('fleet.fuelCards.image.replace')}
              </FuelCardImageUpload>
            )}
            {mayEdit && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('fleet.fuelCards.image.delete')}
              </Button>
            )}
          </>
        }
      >
        {!mayReveal && card !== null && card.image !== null && <FuelCardThumbOnly card={card} />}
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}
        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('fleet.vehicles.licenseImage.loadFailed')}
          </p>
        )}
        {url !== null && <ZoomableImage src={url} alt={t('fleet.fuelCards.image.title')} />}
      </Dialog>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('fleet.fuelCards.image.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.fuelCards.image.deleteBody')}
        </p>
      </Dialog>
    </>
  );
};

/**
 * The card's photo on its line: the eye, in the owner's image box, opens it; a card with none
 * offers the dashed box with the cloud upload to a reader who may edit, and «—» to anyone else.
 */
export const FuelCardImageControl = ({
  card,
  onOpen,
}: {
  card: FleetFuelCardDto;
  onOpen: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  if (card.image === null) {
    if (!can('fleetFuelCard.edit')) return <span>—</span>;
    return (
      <FuelCardImageUpload card={card} label={t('fleet.fuelCards.image.upload')}>
        <CloudUploadIcon className="h-4 w-4" />
      </FuelCardImageUpload>
    );
  }
  return (
    <span className={IMAGE_GROUP}>
      <button
        type="button"
        data-fuel-image={card.id}
        aria-label={t('fleet.fuelCards.image.view')}
        title={t('fleet.fuelCards.image.view')}
        onClick={() => onOpen(card)}
        className={actionTone('view')}
      >
        <EyeIcon className="h-4 w-4" />
      </button>
    </span>
  );
};

/**
 * The photo inside the card form, as the owner's design draws it — a thumbnail, the file and
 * «تم التحميل مسبقاً» with its size, then «معاينة» and «تغيير الصورة». A card with none offers the
 * upload alone.
 */
export const FuelCardPhotoPanel = ({
  card,
  onOpen,
}: {
  card: FleetFuelCardDto;
  onOpen: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  // 6d: the preview box is always the blurred thumbnail (or the icon) — never the full photo.
  const { url } = useFuelCardThumbUrl(
    card.id,
    card.image !== null && card.imageThumb === true,
    card.image?.fileId ?? null,
  );
  const image = card.image;
  return (
    <div
      data-fuel-photo-panel={card.id}
      className="flex flex-col items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-[#2b3b6b] bg-slate-50 dark:bg-[#0a1233] p-3.5 sm:flex-row"
    >
      <div className="flex w-full items-center gap-3 sm:w-auto">
        <div className="relative flex h-10 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-gradient-to-br from-indigo-900 via-slate-800 to-slate-900 shadow-inner">
          {url !== null ? (
            <img
              src={url}
              alt={t('fleet.fuelCards.image.thumbAlt')}
              data-fuel-photo-thumb={card.id}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-4 w-4 text-slate-500" />
          )}
        </div>
        <div className="min-w-0">
          {image === null ? (
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {t('fleet.fuelCards.image.none')}
            </div>
          ) : (
            <>
              <div
                className="truncate text-right text-sm font-semibold text-slate-900 dark:text-white"
                dir="ltr"
              >
                {image.fileName}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t('fleet.fuelCards.image.stored', {
                  // Latin digits, as the design writes «1.2 MB».
                  size: String(Math.round((image.size / 1024 / 1024) * 10) / 10),
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {image !== null && (
          <button
            type="button"
            data-fuel-image={card.id}
            onClick={() => onOpen(card)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-[#2b3b6b] bg-white dark:bg-[#1a2550] px-3 py-1.5 text-[13px] font-bold text-slate-900 dark:text-white transition hover:bg-[#223066]"
          >
            <EyeIcon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
            {t('fleet.fuelCards.image.preview')}
          </button>
        )}
        {can('fleetFuelCard.edit') && (
          <FuelCardImageUpload
            card={card}
            label={
              image === null
                ? t('fleet.fuelCards.image.upload')
                : t('fleet.fuelCards.image.replace')
            }
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#6c63ff]/60 bg-[#4f3dff]/30 px-3 py-1.5 text-[13px] font-bold text-[#c9c5ff] transition hover:bg-[#4f3dff]/45 hover:text-slate-900 dark:hover:text-white"
          >
            <>
              <UploadIcon className="h-4 w-4" />
              {image === null
                ? t('fleet.fuelCards.image.upload')
                : t('fleet.fuelCards.image.replace')}
            </>
          </FuelCardImageUpload>
        )}
      </div>
    </div>
  );
};
