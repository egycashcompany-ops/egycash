// Tab 7 «الكيلومترات» — the approved Phase-1 sample (zz-fleetdash-p1.tsx, `PKm`) over R2's `km`
// (T7.1–T7.7, R-14, R-15), in the system palette.
//
// The day-by-day chart (`km-chart.tsx`, R-15), then the period's kilometres by the car's CURRENT
// branch — with the rows of no registered car as «غير مسجّلة» — and, when a branch is chosen, by
// type. The total is the server's and equals the bars it is drawn beside (Σ branches + غير مسجّلة);
// the box under the bars splits it into the closed single-day distances and the distances over days
// without a reading, which the server also gives (total − spans = the single days).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { periodLinks } from '../../lib/fleet-dashboard-links';
import { shareText } from '../../lib/fleet-dashboard-tabs';
import { Card, CardHead, Fig, HEAD_CHIP, N, NOTE, STRONG, WELL, cn } from './dash-kit';
import { SectionError } from './dash-shell';
import { KmDayChart } from './km-chart';
import { HBars, HeadChip, type HBarRow } from './tab-maintenance';
import { kmText, sectionFailed, type PeriodBodyProps } from './tab-period';

const SPLIT_ROW = 'flex items-center justify-between gap-2';

export const KmTab = ({ data, links, onRetry }: PeriodBodyProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const km = data.km;
  if (sectionFailed(data, 'km')) {
    return (
      <div data-dash-tab-body="km">
        <SectionError section="km" onRetry={onRetry} />
      </div>
    );
  }
  if (km === null) return <div data-dash-tab-body="km" />;

  const unit = t('fleet.dash.km.unit');
  const daily = data.range.granularity === 'day';
  /** The period's links over a narrower set: one branch, or one type, of the cars the filters hold. */
  const narrowed = (over: Partial<typeof data.vehicleScope>) =>
    periodLinks({ range: data.range, vehicleScope: { ...data.vehicleScope, ...over } });

  const branchRows: HBarRow[] = km.byBranch.map((row) => ({
    key: row.branchId ?? 'none',
    name: row.name === null ? t('fleet.dash.km.noBranch') : localized(row.name, locale),
    value: kmText(row.km),
    n: row.km,
    unit,
    extra: shareText(row.km, km.total),
    // A car with no branch has no `branch` the screens could read: shown without a link.
    link: row.branchId === null ? null : narrowed({ branchId: row.branchId }).km('km.byBranch'),
  }));
  if (km.unregistered !== null && km.unregistered > 0) {
    branchRows.push({
      key: 'unregistered',
      name: t('fleet.dash.km.unregistered'),
      value: kmText(km.unregistered),
      n: km.unregistered,
      unit,
      extra: shareText(km.unregistered, km.total),
      link: null,
    });
  }
  const totalChip = (
    <HeadChip link={links.km('km.total')}>
      <N>{kmText(km.total)}</N> {unit}
    </HeadChip>
  );

  return (
    <div data-dash-tab-body="km" className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Card className="p-5 lg:col-span-7" data-period-card="km.days">
        <CardHead
          title={t(daily ? 'fleet.dash.km.chart.titleDaily' : 'fleet.dash.km.chart.titleMonthly')}
          end={
            <span className={HEAD_CHIP}>
              {t(daily ? 'fleet.dash.km.chart.daily' : 'fleet.dash.km.chart.monthly')}
            </span>
          }
          className="mb-4"
        />
        <KmDayChart km={km} data={data} />
      </Card>

      <Card className="p-5 lg:col-span-5" data-period-card="km.byBranch">
        <CardHead title={t('fleet.dash.km.byBranch')} end={totalChip} className="mb-4" />
        {branchRows.length === 0 ? (
          <p className={NOTE}>{t('fleet.dash.km.noReadings')}</p>
        ) : (
          <HBars rows={branchRows} tone="brand" />
        )}
        <div
          className={cn(
            WELL,
            'mt-5 space-y-1.5 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300',
          )}
        >
          <div className={SPLIT_ROW}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/80 dark:bg-emerald-400/60" />
              {t('fleet.dash.km.split.single')}
            </span>
            <span>
              <N className={cn('font-bold', STRONG)}>{kmText(km.total - km.spans.km)}</N> {unit}
            </span>
          </div>
          <div className={SPLIT_ROW}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-violet-500 bg-violet-500/10 dark:border-violet-400" />
              {t('fleet.dash.km.split.spans')}
            </span>
            <span>
              <N className={cn('font-bold', STRONG)}>{kmText(km.spans.km)}</N> {unit}
            </span>
          </div>
          <div
            className={cn(
              SPLIT_ROW,
              'border-t border-slate-200 pt-1.5 font-bold text-slate-800 dark:border-[#1e2a3f] dark:text-slate-100',
            )}
          >
            <span>{t('fleet.dash.km.split.total')}</span>
            <span>
              <Fig link={links.km('km.total')} className="font-black">
                <N>{kmText(km.total)}</N>
              </Fig>{' '}
              {unit}
            </span>
          </div>
        </div>
        <p className={cn(NOTE, 'mt-auto pt-4')}>{t('fleet.dash.km.byBranchNote')}</p>
      </Card>

      {km.byType !== null && (
        <Card className="p-5 lg:col-span-12" data-period-card="km.byType">
          <CardHead
            title={t('fleet.dash.km.byType')}
            sub={t('fleet.dash.km.byTypeNote')}
            end={totalChip}
            className="mb-4"
          />
          {km.byType.length === 0 ? (
            <p className={NOTE}>{t('fleet.dash.km.noReadings')}</p>
          ) : (
            <HBars
              tone="teal"
              rows={km.byType.map((row) => ({
                key: row.typeId,
                name: localized(row.name, locale),
                value: kmText(row.km),
                n: row.km,
                unit,
                extra: shareText(row.km, km.total),
                link: narrowed({ typeIds: [row.typeId] }).km('km.byType'),
              }))}
            />
          )}
        </Card>
      )}
    </div>
  );
};
