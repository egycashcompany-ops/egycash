// How the owner reaches «تصحيح أرقام الكروت» (6d, sample 00): «مطابقة أرصدة الكروت» shows, while
// the repair is not done, one yellow box above the upload card — what is wrong, in numbers, and
// «مراجعة التصحيح». It is asked only of a reader who may read the dry run (`fleetFuelCard.view`),
// takes no room while it loads or if it fails, and goes away once the repair has run — or where
// none of its 17 cards exist (a development database reads every unit held, «pending» for ever).
import { Link } from 'react-router-dom';
import { type FleetFuelNumberRepairDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { BoardIcon, NUM } from '../FuelCardBoard';
import { Filled } from '../fuel-reconcile/reconcile-cells';
import { useNumberRepair } from '../../api/fuel-number-repair-queries';
import { NUMBER_REPAIR_PATH, entryShows } from '../../lib/fuel-number-repair';
import { N } from '../../lib/fuel-number-repair-words';
import { ICON, ymdOf } from './repair-parts';

/** The box itself, for a dry run that calls for it. */
export const NumberRepairEntryBox = ({
  repair,
}: {
  repair: FleetFuelNumberRepairDto;
}): JSX.Element => {
  const t = useT();
  return (
    <section
      data-repair-entry={repair.state}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/[0.08]"
    >
      <span className="flex min-w-0 flex-1 items-start gap-3">
        <span className="rounded-lg bg-amber-500/15 p-2 text-amber-700 dark:text-amber-300">
          <BoardIcon d={ICON.fix} className="h-5 w-5" />
        </span>
        <span className="min-w-0 space-y-1">
          <b className="block text-[15px] text-amber-950 dark:text-amber-100">
            {t(`${N}entry.title`)}
          </b>
          <span className="block text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">
            <Filled
              template={t(`${N}entry.body`)}
              values={{
                records: String(repair.counts.records),
                crossed: String(repair.counts.crossed),
                day: (
                  <span dir="ltr" className={NUM}>
                    {ymdOf(repair.goLiveDay)}
                  </span>
                ),
              }}
            />
          </span>
        </span>
      </span>
      <Link
        to={NUMBER_REPAIR_PATH}
        data-repair-entry-open="true"
        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_6px_22px_rgba(245,158,11,0.35)] transition hover:bg-amber-400 dark:bg-amber-500 dark:text-slate-950"
      >
        {t(`${N}entry.open`)}
        {/* «onwards»: pointing the way the line reads (mirrored in Arabic). */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 rtl:-scale-x-100"
          aria-hidden
          data-repair-arrow="true"
        >
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      </Link>
    </section>
  );
};

/** The box on «مطابقة أرصدة الكروت» — or nothing at all. */
export const NumberRepairEntry = (): JSX.Element | null => {
  const can = useCan();
  const allowed = can('fleetFuelCard.view');
  const repair = useNumberRepair(allowed);
  if (!allowed || !entryShows(repair.data)) return null;
  return repair.data === undefined ? null : <NumberRepairEntryBox repair={repair.data} />;
};
