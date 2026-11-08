// «الصور» on the phone form — optional, up to five (docs/12-planning/it-vehicle-checks-design.md §2
// item 5). The dealership invoice's photo box, for several:
//   • each photo is a row with its thumbnail, its place in the report («صورة 2») and its size, and a
//     ✕ that drops it before sending — never the camera's own file name («IMG_20261108_…»);
//   • a dashed box «اضغط لإضافة صورة» opens the file dialog on any screen, so a computer can add
//     photos too;
//   • on a touch screen, «تصوير بالكاميرا» and «اختيار من الجهاز» under it (`PhotoSourceButtons`).
// Taking a photo — re-drawing it small, or refusing it — is the page's; this only shows them.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CloseIcon, ImageIcon } from '../../../shared/ui/icons';
import { PhotoSourceButtons } from '../../../shared/ui/PhotoPick';
import {
  VEHICLE_CHECK_MAX_PHOTOS,
  VEHICLE_CHECK_PHOTO_ACCEPT,
  photoMegabytes,
} from '../lib/vehicle-check-photos';
import { CARD, CARD_TITLE } from './vehicle-check-looks';

/** One photo taken onto the form: the bytes that will go up, and a preview of them. */
export interface VehicleCheckPickedPhoto {
  clientPhotoId: string;
  file: Blob;
  fileName: string;
  /** An object URL of `file`, for the thumbnail; revoked when the photo leaves the form. */
  url: string;
}

export const VehicleCheckPhotos = ({
  photos,
  onAdd,
  onRemove,
  disabled,
}: {
  photos: readonly VehicleCheckPickedPhoto[];
  onAdd: (files: readonly File[]) => void;
  onRemove: (clientPhotoId: string) => void;
  disabled: boolean;
}): JSX.Element => {
  const t = useT();
  // A new input after every pick, so the same picture can be picked again after it was removed.
  const [inputKey, setInputKey] = useState(0);
  const full = photos.length >= VEHICLE_CHECK_MAX_PHOTOS;
  return (
    <section className={cn(CARD, 'space-y-3 p-4')} data-vehicle-check-photos="true">
      <h2 className={CARD_TITLE}>{t('it.vehicleCheck.photos')}</h2>
      {photos.map((photo, index) => (
        <div
          key={photo.clientPhotoId}
          data-vehicle-check-photo="true"
          className="relative rounded-xl border-2 border-dashed border-brand-500/60 bg-brand-500/5 p-3 dark:bg-brand-500/10"
        >
          <div className="flex items-center gap-3 pe-11">
            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl border border-brand-500/20 bg-brand-500/10">
              <img
                src={photo.url}
                alt={t('it.vehicleCheck.photos.alt')}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                {t('it.vehicleCheck.photos.number', { n: index + 1 })}
              </p>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('it.vehicleCheck.photos.size', { size: photoMegabytes(photo.file.size) })}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('it.vehicleCheck.photos.remove')}
            title={t('it.vehicleCheck.photos.remove')}
            disabled={disabled}
            onClick={() => onRemove(photo.clientPhotoId)}
            className="absolute end-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
      ))}
      {full ? (
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {t('it.vehicleCheck.photos.full', { max: VEHICLE_CHECK_MAX_PHOTOS })}
        </p>
      ) : (
        <>
          {/* The whole dashed box is the file picker, as on the invoice form; several at a time. */}
          <div className="group relative cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-3 transition-all hover:border-brand-500/50 dark:border-slate-700 dark:bg-slate-950/60">
            <input
              key={inputKey}
              type="file"
              multiple
              accept={VEHICLE_CHECK_PHOTO_ACCEPT}
              aria-label={t('it.vehicleCheck.photos')}
              title={t('it.vehicleCheck.photos')}
              disabled={disabled}
              data-vehicle-check-photo-input="true"
              onChange={(e) => {
                onAdd([...(e.target.files ?? [])]);
                setInputKey((k) => k + 1);
              }}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
            <div className="pointer-events-none flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-600 dark:text-brand-300">
                <ImageIcon className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {photos.length === 0
                    ? t('it.vehicleCheck.photos.pickTitle')
                    : t('it.vehicleCheck.photos.pickAnother')}
                </p>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t('it.vehicleCheck.photos.pickHint', { max: VEHICLE_CHECK_MAX_PHOTOS })}
                </p>
              </div>
              {/* On a phone the two buttons under the box say it; a computer keeps the pill. */}
              <span className="hidden shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition group-hover:border-brand-500/50 sm:inline-block dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                {t('it.vehicleCheck.photos.choose')}
              </span>
            </div>
          </div>
          {/* On a touch screen: the camera, or a picture already on the phone. */}
          <PhotoSourceButtons
            accept={VEHICLE_CHECK_PHOTO_ACCEPT}
            onFile={(file) => onAdd([file])}
            disabled={disabled}
          />
        </>
      )}
    </section>
  );
};
