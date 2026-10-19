// The bottom bar of a placement or a move (docs/12-planning/atm-map-zones.md §8.8 `MovePinBar`):
// «اسحب العلامة إلى الموقع الصحيح · القطاع: X», «تأكيد الموقع», «إلغاء».
//
// THE VERSION COMES FROM THE DETAIL. A point on the map carries no `version`, so the bar reads the
// machine's location first and sends that `__v` with the write; a write that lost a race answers
// 409 `STALE_DOCUMENT`, and the bar refetches, keeps the pin where the person dragged it, and asks
// again. A move of a located pin by more than 1 km goes through `MoveConfirmDialog` for its reason
// (DM-18).
//
// TEXT OR PIN. A point read from a pasted text and confirmed untouched is sent as that text with
// the previewed point (`mode: 'text'`, DM-45), so the server re-reads it and refuses a reading
// that moved; a pin the person dragged or nudged is sent as the point itself.
import { useState } from 'react';
import {
  ATM_MAP_MOVE_REASON_METERS,
  ErrorCodes,
  type AtmMapLatLng,
  type Locale,
  type PlaceAtmMachineLocation,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { Spinner } from '../../../../shared/ui/Spinner';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useMachineLocation, usePlaceLocation } from '../../api/map-queries';
import { haversineMeters, kilometresText } from '../../lib/map-view';
import { locatedToast } from '../../lib/map-toasts';
import { MoveConfirmDialog } from './MoveConfirmDialog';
import { CONFIRM_BUTTON } from './map-buttons';

/** The reasons a parse refuses a text — each has its `atm.map.parse.*` message (§8.12). */
const PARSE_REASONS: readonly string[] = [
  'shortLink',
  'noCoordinates',
  'invalidCoordinates',
  'unreadable',
  'shortPlusCodeNoReference',
];

export const MovePinBar = ({
  machine,
  at,
  text,
  locale,
  zoneNameAt,
  onDone,
  onCancel,
  onParseChanged,
}: {
  machine: { machineId: string; code: string };
  /** Where the pin is now. */
  at: AtmMapLatLng;
  /** The pasted text, while the pin still stands on the point it was read as. */
  text: { text: string; expected: AtmMapLatLng } | null;
  locale: Locale;
  /** «القطاع: …» for a point — the shared membership over the branch's zones. */
  zoneNameAt: (point: AtmMapLatLng | null) => string;
  onDone: () => void;
  onCancel: () => void;
  /** 409 `ATM_MAP_PARSE_CHANGED`: the page reads the text again and shows the new preview. */
  onParseChanged?: () => void;
}): JSX.Element => {
  const t = useT();
  const detail = useMachineLocation(machine.machineId);
  const place = usePlaceLocation();
  const [asking, setAsking] = useState(false);

  const origin =
    detail.data !== undefined &&
    detail.data.state !== 'unlocated' &&
    detail.data.lat !== null &&
    detail.data.lng !== null
      ? { lat: detail.data.lat, lng: detail.data.lng }
      : null;
  const meters = origin === null ? 0 : haversineMeters(origin, at);

  const submit = (reason?: string): void => {
    if (detail.data === undefined) return;
    const version = detail.data.version;
    const extra = reason === undefined ? {} : { reason };
    const body: PlaceAtmMachineLocation =
      text !== null
        ? { mode: 'text', text: text.text, expected: text.expected, version, ...extra }
        : { mode: 'pin', lat: at.lat, lng: at.lng, version, ...extra };
    place.mutate(
      { machineId: machine.machineId, body },
      {
        onSuccess: () => {
          setAsking(false);
          const words = locatedToast(machine.code, zoneNameAt(at), t);
          toast.success(words.title, words.description);
          onDone();
        },
        onError: (error) => {
          setAsking(false);
          if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {
            toast.error(errorMessage(error, locale));
            void detail.refetch();
            return;
          }
          if (error instanceof ApiError && error.code === ErrorCodes.ATM_MAP_PARSE_CHANGED) {
            toast.warning(t('atm.map.parse.changed'));
            onParseChanged?.();
            return;
          }
          if (
            error instanceof ApiError &&
            (error.details ?? []).some((d) => d.field === 'body.reason' && d.code === 'REQUIRED')
          ) {
            setAsking(true);
            return;
          }
          // A text the server can no longer read says why, in the paste box's own words (§8.10).
          const unread =
            error instanceof ApiError
              ? (error.details ?? []).find(
                  (d) => d.field === 'body.text' && PARSE_REASONS.includes(d.code),
                )
              : undefined;
          if (unread !== undefined) {
            toast.error(t(`atm.map.parse.${unread.code}`));
            return;
          }
          toast.error(errorMessage(error, locale));
        },
      },
    );
  };

  return (
    <>
      <div
        data-move-pin-bar={machine.machineId}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        className="absolute bottom-6 left-1/2 z-[1100] flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-800 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
      >
        <span aria-live="polite">
          {t('atm.map.move.hint')}{' '}
          <span className="text-slate-500">{t('atm.map.move.zone', { zone: zoneNameAt(at) })}</span>
        </span>
        <button
          type="button"
          className={CONFIRM_BUTTON}
          disabled={detail.data === undefined || place.isPending}
          onClick={() => {
            if (origin !== null && meters > ATM_MAP_MOVE_REASON_METERS) setAsking(true);
            else submit();
          }}
        >
          {place.isPending && <Spinner className="h-4 w-4" />}
          {t('atm.map.move.confirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={place.isPending}
          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {t('atm.map.move.cancel')}
        </button>
      </div>
      <MoveConfirmDialog
        open={asking}
        km={kilometresText(meters, locale)}
        from={zoneNameAt(origin)}
        to={zoneNameAt(at)}
        saving={place.isPending}
        onBack={() => setAsking(false)}
        onConfirm={(reason) => submit(reason)}
      />
    </>
  );
};
