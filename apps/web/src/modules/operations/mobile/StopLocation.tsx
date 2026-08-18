// Where a leg starts and where it ends, and how a captain gets there.
//
// COORDINATES ARE THE SOURCE OF TRUTH, not a stored URL. The branch record holds a POINT
// (`OperationsLocation.coordinates`, design §17.4) and the navigation link is generated from it
// every time — a URL that had been stored could be shortened, localized or revoked, and would
// eventually send a driver somewhere that no longer exists. `mapsUrl` is the same generator the
// desktop branch form uses to verify what it saved, so both surfaces point at the same place.
//
// NO MAP SDK HERE. The branch form loads Leaflet because somebody is choosing a point on a map;
// a captain is not choosing anything — he needs the address and a way to hand the point to the
// navigation app he already uses. Shipping a tile renderer to a phone on mobile data for a
// read-only pin would be a cost with no purchase.
import { type OperationsRouteStopLocationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PinIcon } from '../../../shared/ui/icons';
import { mapsUrl } from '../lib/maps-link';

export const StopLocation = ({
  label,
  place,
}: {
  label: string;
  place: OperationsRouteStopLocationDto;
}): JSX.Element => {
  const t = useT();
  const point = place.location?.coordinates ?? null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
        {place.branchName}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">{place.bankName}</p>
      <dl className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex gap-2">
          <dt>{t('operations.mobile.branchCode')}</dt>
          <dd className="font-mono" dir="ltr">
            {place.branchCode}
          </dd>
        </div>
        {place.areaName !== null && (
          <div className="flex gap-2">
            <dt>{t('operations.shipment.area')}</dt>
            <dd>{place.areaName}</dd>
          </div>
        )}
        {place.location?.addressLine != null && (
          <div className="flex gap-2">
            <dt>{t('operations.catalogs.branch.address')}</dt>
            <dd>{place.location.addressLine}</dd>
          </div>
        )}
      </dl>

      {point === null ? (
        // A blank would read as a bug. Legacy carried no geography at all, so most branches have
        // no point yet and the honest thing is to say which one this is.
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {t('operations.mobile.noLocation')}
        </p>
      ) : (
        <a
          href={mapsUrl(point)}
          target="_blank"
          rel="noreferrer"
          // A full-width, thumb-sized target: this is pressed one-handed, standing up, outdoors.
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          <PinIcon className="h-4 w-4" aria-hidden="true" />
          {t('operations.mobile.openLocation')}
        </a>
      )}
    </div>
  );
};
