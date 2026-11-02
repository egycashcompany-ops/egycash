// «تصحيح أرقام الكروت» (6d) — one card photo in a row, as the approved sample frames it: a 92×58
// card, ringed green when it shows this record's own card and red when it shows another car's, the
// «•••• last four» over it and the sticker's car code in its yellow chip, the verdict under it.
//
// Inside the frame is the REAL thumbnail of the photo (`GET /fleet/fuel-cards/:id/image/thumb`,
// `fleetFuelCard.view` — small and blurred: the photo's sticker carries the PIN), fetched from the
// live card that holds that go-live photo now. Without one, the card is drawn from what the photo
// shows (embossed name, «VALID THRU», sticker). A holder of `fleetFuelCard.reveal` may click it to
// see the full photo; for anyone else it is not a button at all.
import { useState } from 'react';
import { type FleetFuelNumberRepairPhotoDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { FUEL_CARD_LOGO } from '../FuelCardTiles';
import { DesignCancel, DesignDialog } from '../DesignDialog';
import { ZoomableImage } from '../ZoomableImage';
import { FULL_PHOTO_GRANT, useFuelCardImageUrl, useFuelCardThumbUrl } from '../FuelCardImage';
import { N } from '../../lib/fuel-number-repair-words';
import { Filled } from '../fuel-reconcile/reconcile-cells';
import { CarCode, ICON } from './repair-parts';

/** ✓ the photo shows this record's own card · ✗ another car's card · kept: it stays as it is. */
export type ThumbVerdict = 'ok' | 'no' | 'kept';

/** The full photo, for a holder of the reveal grant only — the dialog asks for nothing otherwise. */
const FullPhoto = ({
  cardId,
  open,
  onClose,
  photo,
}: {
  cardId: string;
  open: boolean;
  onClose: () => void;
  photo: FleetFuelNumberRepairPhotoDto;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const { url, loading, failed } = useFuelCardImageUrl(
    cardId,
    open ? cardId : null,
    can(FULL_PHOTO_GRANT),
  );
  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('fleet.fuelCards.image.title')}
      subtitle={
        <span dir="ltr" className={NUM}>
          548 •••• {photo.last4}
        </span>
      }
      icon={PATH.image}
      width="3xl"
      panelProps={{ 'data-repair-photo-dialog': cardId }}
      footer={<DesignCancel onClick={onClose} label={t('common.close')} />}
    >
      {loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      )}
      {failed && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t('fleet.vehicles.licenseImage.loadFailed')}
        </p>
      )}
      {url !== null && <ZoomableImage src={url} alt={t('fleet.fuelCards.image.title')} />}
    </DesignDialog>
  );
};

export const RepairThumb = ({
  photo,
  verdict,
}: {
  photo: FleetFuelNumberRepairPhotoDto;
  verdict: ThumbVerdict;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const { url } = useFuelCardThumbUrl(photo.thumb ? photo.cardId : null);
  const mayOpen = can(FULL_PHOTO_GRANT) && photo.cardId !== null;
  const frame = (
    <span
      className={cn(
        'relative block h-[58px] w-[92px] overflow-hidden rounded-md border shadow-sm',
        'bg-gradient-to-br from-emerald-700 via-emerald-800 to-slate-900',
        verdict === 'no'
          ? 'border-red-400 ring-1 ring-red-400/60 dark:border-red-500/70'
          : verdict === 'ok'
            ? 'border-emerald-400 ring-1 ring-emerald-400/60'
            : 'border-slate-300 dark:border-slate-600',
      )}
    >
      {url !== null ? (
        <img
          src={url}
          alt={t('fleet.fuelCards.image.thumbAlt')}
          data-repair-thumb-img={photo.cardId ?? ''}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <img
            src={FUEL_CARD_LOGO.wataniya}
            alt=""
            className="absolute end-1 top-1 h-3.5 w-3.5 rounded-full bg-white p-px"
          />
          <span
            dir="ltr"
            className={cn(
              NUM,
              'absolute start-1.5 top-[29px] whitespace-nowrap text-[6px] font-semibold tracking-tight text-white/80',
            )}
          >
            {photo.embossedName}
          </span>
          <span
            dir="ltr"
            className={cn(NUM, 'absolute start-1.5 top-[40px] text-[6px] text-white/70')}
          >
            {photo.validThru}
          </span>
        </>
      )}
      <span
        dir="ltr"
        className={cn(
          NUM,
          'absolute start-1.5 top-[17px] rounded-sm text-[8px] font-bold text-white/90',
          url !== null && 'bg-slate-900/60 px-0.5',
        )}
      >
        •••• {photo.last4}
      </span>
      <span
        dir="ltr"
        className={cn(
          NUM,
          'absolute bottom-1 end-1 rounded-sm bg-yellow-200 px-1 text-[9px] font-black leading-[13px] text-slate-900',
        )}
      >
        {photo.stickerCar}
      </span>
    </span>
  );
  return (
    <span className="inline-flex flex-col items-center gap-1" data-repair-thumb={verdict}>
      {mayOpen ? (
        <button
          type="button"
          data-repair-thumb-open={photo.cardId ?? ''}
          title={t(`${N}photo.open`)}
          aria-label={t(`${N}photo.open`)}
          onClick={() => setOpen(true)}
          className="rounded-md transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6c63ff]/60"
        >
          {frame}
        </button>
      ) : (
        frame
      )}
      {verdict === 'kept' ? (
        <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <Filled
            template={t(`${N}photo.sticker`)}
            values={{ car: <CarCode code={photo.stickerCar} /> }}
          />
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold',
            verdict === 'ok'
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-red-700 dark:text-red-300',
          )}
        >
          <BoardIcon d={verdict === 'ok' ? ICON.ok : ICON.no} className="h-3 w-3" />
          <Filled
            template={t(`${N}photo.ofCar`)}
            values={{ car: <CarCode code={photo.stickerCar} /> }}
          />
        </span>
      )}
      {mayOpen && photo.cardId !== null && (
        <FullPhoto cardId={photo.cardId} open={open} onClose={() => setOpen(false)} photo={photo} />
      )}
    </span>
  );
};
