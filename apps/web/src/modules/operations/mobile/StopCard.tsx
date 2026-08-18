// One stop on the captain's route.
//
// THREE APPEARANCES, ONE SOURCE. `completed`, `current` and `locked` come from the server's
// `progress` field and are never computed here — the sequential lock is a domain rule
// (`isStopSettled`, execution-state.ts) and a phone that decided for itself would eventually
// disagree with the API that has to honour it.
//
// They are told apart by more than colour: the current stop is raised, ringed and carries its
// heading; a locked one is dimmed AND carries a padlock with a text reason; a completed one is
// dimmed AND carries a check. Colour alone would leave the distinction invisible to a colour-blind
// captain in daylight, which is the condition this screen is actually used in.
import { Link } from 'react-router-dom';
import { type OperationsMobileStopDto, type OperationsRouteStopLocationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CheckIcon, LockIcon, PinIcon } from '../../../shared/ui/icons';
import { ShipmentTypeBadge } from '../components/ShipmentBadges';

/** One end of the leg — where the cash is taken from, or handed to. */
const Endpoint = ({
  label,
  place,
}: {
  label: string;
  place: OperationsRouteStopLocationDto;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
        {place.branchName}
      </p>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {place.bankName}
        {place.areaName !== null && ` — ${place.areaName}`}
      </p>
      {/* Whether this end can be navigated to at all. Legacy carried no geography, so a blank is
          the common case and has to read as information rather than as a bug. */}
      {place.location?.coordinates == null ? (
        <p className="mt-0.5 text-xs text-slate-400">{t('operations.mobile.noLocation')}</p>
      ) : (
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
          <PinIcon className="h-3 w-3" />
          {t('operations.mobile.hasLocation')}
        </p>
      )}
    </div>
  );
};

export const StopCard = ({
  stop,
  href,
}: {
  stop: OperationsMobileStopDto;
  href: string;
}): JSX.Element => {
  const t = useT();
  const isCurrent = stop.progress === 'current';
  const isLocked = stop.progress === 'locked';
  const isDone = stop.progress === 'completed';

  return (
    // A LINK, not a button: opening a stop is navigation, so it gets a real URL that survives a
    // reload, a share and the browser's own back gesture — which on a phone is how people go back.
    //
    // A locked stop is still readable; the captain needs to see what is coming. What it does not
    // get is an execution action, and that refusal is stated on the detail screen next to the
    // reason rather than by making the card inert.
    <Link
      to={href}
      aria-current={isCurrent ? 'step' : undefined}
      className={cn(
        'block w-full rounded-xl border p-4 text-start transition-colors',
        isCurrent
          ? 'border-brand-400 bg-white shadow-sm ring-2 ring-brand-200 dark:border-brand-500 dark:bg-slate-900 dark:ring-brand-900'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
        (isLocked || isDone) && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        {/* The sequence, as the server established it. The client never sorts and never renumbers. */}
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
            isCurrent
              ? 'bg-brand-500 text-white'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
          )}
          aria-hidden="true"
        >
          {isDone ? <CheckIcon className="h-4 w-4" /> : stop.sequence}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {t('operations.mobile.stopNumber', { sequence: stop.sequence })}
            </span>
            <ShipmentTypeBadge shipmentType={stop.shipmentType} />
            {/* The leg — a secured shipment is two stops, and which one this is matters. */}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t(`operations.mobile.leg.${stop.leg}`)}
            </span>
          </div>

          {stop.referenceNumber !== null && (
            <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {stop.referenceNumber}
            </p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Endpoint label={t('operations.mobile.pickupFrom')} place={stop.pickup} />
            <Endpoint label={t('operations.mobile.deliverTo')} place={stop.delivery} />
          </div>

          {/*
            WHICH STOP THIS IS, always in words — a ring and a colour are invisible to a
            colour-blind captain in daylight, which is the condition this screen is used in. The
            current stop then adds HOW FAR ALONG it is, which is the fact that changes as he works.
          */}
          <p
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 text-xs font-medium',
              isCurrent && 'text-brand-600 dark:text-brand-400',
              isLocked && 'text-slate-500 dark:text-slate-400',
              isDone && 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {isLocked && <LockIcon className="h-3.5 w-3.5" />}
            {isDone && <CheckIcon className="h-3.5 w-3.5" />}
            {t(`operations.mobile.progress.${stop.progress}`)}
          </p>
          {isCurrent && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t(`operations.mobile.execution.${stop.executionStatus}`)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
};
