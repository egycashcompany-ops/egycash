// Tab 8 «ترتيب السيارات» — the approved Phase-1 sample (zz-fleetdash-p1.tsx, `PRanking`) over R2's
// `km` (T8.1–T8.3, R-16, R-17), in the system palette. Vehicles only: the driver rankings are
// Phase 2 and are not drawn.
//
// Only cars with valid readings are ranked (the server's `top5` / `bottom5`, ties by the smaller
// code); the bottom five are cars active NOW; every car of the set without a valid reading is listed
// under the bottom card with its one reason, and is never ranked.
import {
  daysBetweenYmd,
  type FleetDashboardNoReadingReason,
  type FleetDashboardPeriodKmDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import {
  AMBER,
  Card,
  CardHead,
  CarChip,
  DIVIDE,
  Fig,
  MUTED,
  N,
  NOTE,
  NUM,
  STRONG,
  WELL,
  cn,
} from './dash-kit';
import { Phrase, SectionError, count, useNoun } from './dash-shell';
import { kmText, sectionFailed, type PeriodBodyProps } from './tab-period';

/** The reasons in the plan's order, (a) … (f), with «قراءاتها تحتاج مراجعة» after (c). */
const REASONS: readonly FleetDashboardNoReadingReason[] = [
  'noRow',
  'onlyOpen',
  'onlyNoCounter',
  'onlyInvalid',
  'inWorkshop',
  'notActive',
  'joinedAfter',
];

const PLACE = {
  top: { dot: 'bg-emerald-500', bar: 'bg-emerald-500/80' },
  bottom: { dot: 'bg-amber-500', bar: 'bg-amber-500/80' },
} as const;

const RankRow = ({
  place,
  code,
  km,
  max,
  side,
  carLink,
  kmLink,
  extra,
}: {
  place: number;
  code: string;
  km: number;
  max: number;
  side: keyof typeof PLACE;
  carLink: DashLink | null;
  kmLink: DashLink;
  extra?: JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  return (
    <li data-rank={`${side}-${place}`} className="px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={cn(
            'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
            NUM,
            PLACE[side].dot,
          )}
        >
          {place}
        </span>
        <CarChip code={code} link={carLink} />
        <span className="ms-auto shrink-0 whitespace-nowrap">
          <Fig link={kmLink} className={cn('font-bold', STRONG)}>
            <N>{kmText(km)}</N>
          </Fig>
          <span className={cn('ms-1 text-[11px]', MUTED)}>{t('fleet.dash.km.unit')}</span>
        </span>
      </div>
      {extra !== undefined && extra !== null && (
        <div className={cn('mt-0.5 ps-7 text-[11px]', MUTED)}>{extra}</div>
      )}
      <div className="mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-[#162135]">
        <div
          className={cn('h-1 rounded-full', PLACE[side].bar)}
          style={{ width: `${max > 0 ? (km / max) * 100 : 0}%` }}
        />
      </div>
    </li>
  );
};

const WithoutReadings = ({
  rows,
  carLink,
}: {
  rows: FleetDashboardPeriodKmDto['withoutReadings'];
  carLink: (row: { vehicleId: string }) => DashLink | null;
}): JSX.Element | null => {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <div
      data-without-readings="true"
      className="mt-3 space-y-1 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/[0.07] dark:text-amber-200"
    >
      <div className="font-bold">{t('fleet.dash.ranking.outTitle')}</div>
      {REASONS.map((reason) => {
        const cars = rows.filter((row) => row.reason === reason);
        if (cars.length === 0) return null;
        return (
          <div
            key={reason}
            data-reason={reason}
            className="flex flex-wrap items-center gap-x-1 gap-y-1"
          >
            {cars.map((row) => (
              <CarChip key={row.vehicleId} code={row.code} link={carLink(row)} />
            ))}
            <span>{t(`fleet.dash.ranking.reason.${reason}`)}</span>
          </div>
        );
      })}
    </div>
  );
};

export const RankingTab = ({ data, links, can, onRetry }: PeriodBodyProps): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const km = data.km;
  if (sectionFailed(data, 'km')) {
    return (
      <div data-dash-tab-body="ranking">
        <SectionError section="km" onRetry={onRetry} />
      </div>
    );
  }
  if (km === null) return <div data-dash-tab-body="ranking" />;

  const carLink = (row: { vehicleId: string }, metric: string): DashLink | null =>
    can('fleetVehicle.view') ? links.vehicle(row.vehicleId, metric) : null;
  const topMax = Math.max(0, ...km.top5.map((row) => row.km));
  const bottomMax = Math.max(0, ...km.bottom5.map((row) => row.km));
  const none = <p className={NOTE}>{t('fleet.dash.ranking.none')}</p>;

  return (
    <div data-dash-tab-body="ranking" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="p-5" data-period-card="km.top">
        <CardHead title={t('fleet.dash.ranking.top')} className="mb-4" />
        {km.top5.length === 0 ? (
          none
        ) : (
          <ul className={cn(WELL, DIVIDE)}>
            {km.top5.map((row, i) => (
              <RankRow
                key={row.vehicleId}
                place={i + 1}
                code={row.code}
                km={row.km}
                max={topMax}
                side="top"
                carLink={carLink(row, 'km.topVehicle')}
                kmLink={links.carKm(row.code, 'km.top')}
              />
            ))}
          </ul>
        )}
        <p className={cn(NOTE, 'mt-3')}>{t('fleet.dash.ranking.note')}</p>
      </Card>
      <Card className="p-5" data-period-card="km.bottom">
        <CardHead title={t('fleet.dash.ranking.bottom')} className="mb-4" />
        {km.bottom5.length === 0 ? (
          none
        ) : (
          <ul className={cn(WELL, DIVIDE)}>
            {km.bottom5.map((row, i) => {
              const since = row.inWorkshopSince;
              const days = since === null ? 0 : Math.max(0, daysBetweenYmd(since, data.today));
              return (
                <RankRow
                  key={row.vehicleId}
                  place={i + 1}
                  code={row.code}
                  km={row.km}
                  max={bottomMax}
                  side="bottom"
                  carLink={carLink(row, 'km.bottomVehicle')}
                  kmLink={links.carKm(row.code, 'km.bottom')}
                  extra={
                    since === null ? null : (
                      <span data-in-workshop={since} className={AMBER}>
                        {days === 0 ? (
                          t('fleet.dash.ranking.inWorkshopToday')
                        ) : (
                          <Phrase
                            text={t('fleet.dash.ranking.inWorkshopDays')}
                            parts={{ count: <N>{count(days)}</N>, noun: noun('day', days) }}
                          />
                        )}
                      </span>
                    )
                  }
                />
              );
            })}
          </ul>
        )}
        <WithoutReadings
          rows={km.withoutReadings}
          carLink={(row) => carLink(row, 'km.withoutReadings')}
        />
      </Card>
    </div>
  );
};
