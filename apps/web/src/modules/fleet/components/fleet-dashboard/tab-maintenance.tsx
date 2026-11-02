// Tab 9 «الصيانة» — the approved Phase-1 sample (zz-fleetdash-p1.tsx, `PMaintenance`) over R2's
// `visits` (T9.1–T9.4, R-17, R-18, R-26), in the system palette.
//
// Visits of the period by work type, by workshop, and the cars that came in most — each bar opens
// the maintenance screen over the same period and filters with that work type / workshop / car, so
// the screen's count is the bar. A visit carries no amount: nothing here is money (R-26); the
// maintenance cost is in the receipts and the dealership invoices, and the footer says so.
//
// Also `HBars`, the named horizontal bars tab 7 draws its branches and types with.
import { type ReactNode } from 'react';
import { type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { shareText, slashDay } from '../../lib/fleet-dashboard-tabs';
import {
  Card,
  CardHead,
  CarChip,
  DIVIDE,
  Fig,
  HEAD_CHIP,
  MUTED,
  N,
  NOTE,
  STRONG,
  TONE,
  WELL,
  cn,
  type Tone,
} from './dash-kit';
import { Phrase, SectionError, count, useNoun } from './dash-shell';
import { sectionFailed, type PeriodBodyProps } from './tab-period';

// ── Named bars ────────────────────────────────────────────────────────────────────────────────

export interface HBarRow {
  key: string;
  name: string;
  /** The figure as written («55,780»). */
  value: string;
  /** The figure as a number, for the bar's length. */
  n: number;
  unit?: string;
  /** The share beside the figure («44%»). */
  extra?: string;
  link: DashLink | null;
}

/** A horizontal bar per row: the name, the figure (a link), its share; lengths against the largest. */
export const HBars = ({ rows, tone }: { rows: readonly HBarRow[]; tone: Tone }): JSX.Element => {
  const max = Math.max(0, ...rows.map((row) => row.n));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} data-bar={row.key}>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">
              {row.name}
            </span>
            <span className="shrink-0 whitespace-nowrap">
              <Fig link={row.link} className={cn('font-bold', STRONG)}>
                <N>{row.value}</N>
              </Fig>
              {row.unit !== undefined && (
                <span className={cn('ms-1 text-xs', MUTED)}>{row.unit}</span>
              )}
              {row.extra !== undefined && (
                <N className="ms-1.5 rounded bg-slate-100 px-1 text-[11px] text-slate-600 dark:bg-[#162135] dark:text-slate-300">
                  {row.extra}
                </N>
              )}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
            <div
              className={cn('h-2 rounded-full', TONE[tone].bar)}
              style={{ width: `${max > 0 ? (row.n / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};

/** A title chip that opens its screen. */
export const HeadChip = ({
  link,
  children,
}: {
  link: DashLink | null;
  children: ReactNode;
}): JSX.Element => (
  <Fig link={link} className={HEAD_CHIP} linkedClassName="">
    {children}
  </Fig>
);

// ── Tab 9 ─────────────────────────────────────────────────────────────────────────────────────

const nameOf = (name: LocalizedString | null, locale: Locale, unnamed: string): string =>
  name === null ? unnamed : localized(name, locale);

export const MaintenanceTab = ({ data, links, can, onRetry }: PeriodBodyProps): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const visits = data.visits;
  if (sectionFailed(data, 'visits')) {
    return (
      <div data-dash-tab-body="maintenance">
        <SectionError section="visits" onRetry={onRetry} />
      </div>
    );
  }
  if (visits === null) return <div data-dash-tab-body="maintenance" />;

  const unnamed = t('fleet.dash.maintenance.unnamed');
  const chip = (
    <HeadChip link={links.visits('visits.count')}>
      <N>{count(visits.count)}</N> {noun('visit', visits.count)}
    </HeadChip>
  );
  const empty = <p className={NOTE}>{t('fleet.dash.maintenance.empty')}</p>;

  return (
    <div data-dash-tab-body="maintenance" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="p-5" data-period-card="visits.byWorkType">
        <CardHead title={t('fleet.dash.maintenance.byWorkType')} end={chip} className="mb-4" />
        {visits.byWorkType.length === 0 ? (
          empty
        ) : (
          <HBars
            tone="sky"
            rows={visits.byWorkType.map((row) => ({
              key: row.id,
              name: nameOf(row.name, locale, unnamed),
              value: count(row.count),
              n: row.count,
              extra: shareText(row.count, visits.count),
              link: links.visits('visits.byWorkType', { workTypes: [row.id] }),
            }))}
          />
        )}
      </Card>
      <Card className="p-5" data-period-card="visits.byWorkshop">
        <CardHead title={t('fleet.dash.maintenance.byWorkshop')} end={chip} className="mb-4" />
        {visits.byWorkshop.length === 0 ? (
          empty
        ) : (
          <HBars
            tone="teal"
            rows={visits.byWorkshop.map((row) => ({
              key: row.id,
              name: nameOf(row.name, locale, unnamed),
              value: count(row.count),
              n: row.count,
              extra: shareText(row.count, visits.count),
              link: links.visits('visits.byWorkshop', { workshops: [row.id] }),
            }))}
          />
        )}
      </Card>
      <Card className="p-5 lg:col-span-2" data-period-card="visits.topVehicles">
        <CardHead title={t('fleet.dash.maintenance.topVehicles')} className="mb-4" />
        {visits.topVehicles.length === 0 ? (
          empty
        ) : (
          <ul className={cn(WELL, DIVIDE, 'grid grid-cols-1 lg:grid-cols-2 lg:divide-y-0')}>
            {visits.topVehicles.map((row) => (
              <li
                key={row.code}
                data-top-vehicle={row.code}
                className="flex items-center gap-2.5 border-slate-100 px-3 py-2.5 text-[13px] lg:border-b dark:border-[#1a2538]"
              >
                <CarChip
                  code={row.code}
                  link={
                    row.vehicleId !== null && can('fleetVehicle.view')
                      ? links.vehicle(row.vehicleId, 'visits.vehicle')
                      : null
                  }
                />
                <Fig
                  link={links.visits('visits.topVehicle', { vehicleCodes: [row.code] })}
                  className="font-bold text-slate-800 dark:text-slate-100"
                >
                  <N>{count(row.visits)}</N> {noun('visit', row.visits)}
                </Fig>
                <span className={cn('ms-auto text-[11px]', MUTED)}>
                  {row.lastInDate === data.today ? (
                    t('fleet.dash.maintenance.lastToday')
                  ) : (
                    <Phrase
                      text={t('fleet.dash.maintenance.last')}
                      parts={{ day: <N>{slashDay(row.lastInDate)}</N> }}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={cn(NOTE, 'mt-3')}>
          <Phrase
            text={t('fleet.dash.maintenance.stillIn')}
            parts={{ count: <N className="font-bold">{count(visits.open)}</N> }}
          />{' '}
          {visits.unregistered !== null && visits.unregistered > 0 && (
            <>
              <Phrase
                text={t('fleet.dash.maintenance.unregistered')}
                parts={{ count: <N>{count(visits.unregistered)}</N> }}
              />{' '}
            </>
          )}
          <span data-no-money="true">{t('fleet.dash.maintenance.noMoney')}</span>
        </p>
      </Card>
    </div>
  );
};
