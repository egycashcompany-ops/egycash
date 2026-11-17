// «العدادات والكيلومترات» — the owner-approved sample (approved/odo-dark.png, odo-branch-dark.png;
// harness zz-odometer.tsx `?bars=brand`, DECISIONS §5), a tab of «الآن» and a period both, drawn over
// the real reads. It takes the place of the old «الكيلومترات» AND «ترتيب السيارات» bodies (the approved
// screen holds the top 5 | bottom 5; an old `?tab=ranking` link opens this tab):
//
//   1  the heading — «تحديث» refreshes both reads and «آخر تحديث» is the older of the two (the page
//      hands both in)
//   2  the dashboard's period bar at the TOP, as _1 draws it (the page's ONE filter state)
//   3  five cards: «إجمالي الكيلومترات» · «متوسط لكل سيارة» · «سيارات بلا مسافة في الفترة» · «قراءات
//      تحتاج مراجعة» (R2 `km`) · «بلا قراءة عداد منذ N أيام» (R1 `noReading`, «لقطة الآن»)
//   4  «الكيلومترات يومًا بيوم», the page's full width (km-chart.tsx, R-15, brand columns, Fridays dimmed)
//   5  «أعلى 5 سيارات كيلومترات» | «أقل 5 سيارات كيلومترات» — ONE brand bar against the top car; under
//      the bottom list, the cars that do not enter the ranking, by their reason
//   6  «استثناءات قراءات العدادات» (Q2 أ): «بلا قراءة حديثة» and «لم تُقرأ أبدًا» (R1, «لقطة الآن») and
//      «قراءات تحتاج مراجعة» (R2), each at most FLEET_DASHBOARD_EXCEPTION_ROWS rows and the rest named
//   7  under ONE branch only (the server sends `km.byType` then): «الكيلومترات حسب النوع» (Q3)
//   8  the page note
//
// Each read has its own face: R1 on its way or failed costs the «بلا قراءة» card and the two R1
// groups only; R2 on its way or failed costs the period figures only. NOTHING IS COUNTED HERE: every
// figure is a field a read sent (`staleCount`, `neverReadCount`, `noDistance.cars`, `invalidRows` —
// never a list's length); «و N أخرى» is that count less the rows the server caps the group at. The
// per-car average, the coverage, the active / in-workshop / joined-after foot have no link: no screen
// lists exactly them. «مراجعة القراءات» opens the period's odometer register (no screen filters the
// negative rows; «أرقام الفترة» does the same), each review row its car on that ONE day. Every data
// bar and column is the brand's (DECISIONS §5); the status colours stay (amber no-reading, rose review,
// amber «في الورشة» tags).
import { type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_EXCEPTION_ROWS,
  daysBetweenYmd,
  type FleetDashboardNoReadingReason,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodKmDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import {
  nowLinks,
  periodLinks,
  type DashLink,
  type NowLinks,
  type PeriodLinks,
} from '../../lib/fleet-dashboard-links';
import { sectionPermitted, shareText, slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyCountForm } from '../custody-dashboard-parts';
import {
  Btn,
  Card,
  CarChip,
  DIVIDE,
  Fig,
  FootLink,
  I,
  Icon,
  IconTile,
  MUTED,
  N,
  NOTE,
  NUM,
  RULE,
  STRONG,
  TITLE,
  TONE,
  TabHead,
  Tag,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import {
  Phrase,
  ReadError,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type MixedTabProps,
} from './dash-shell';
import {
  Big,
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  Kpi,
  NoteLine,
  NowChip,
  RangeChip,
  Sep,
  Since,
  Small,
  WORDS,
} from './dash-blocks';
import { ColumnChart } from './dash-columns';
import { KmChartNotes, KmDayChart } from './km-chart';
import { PeriodFilterBar } from './period-filter-bar';
import { kmText } from './tab-period';

/** The word of a key under the tab's own namespace. */
const useWords = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.km.${key}`, params);
};

/** «قراءة» / «قراءات» — the readings' own counted noun. */
const useReadings = (): ((n: number) => string) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (n) => t(`fleet.dash.km.reading.${custodyCountForm(locale, n)}`);
};

/** «سيارات بلا مسافة في الفترة» — a car parked (the kit carries no such glyph). */
const PAUSE: IconPath = ['M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z'];

/** The reasons a car is not ranked, in the plan's order, (a) … (f), «تحتاج مراجعة» after (c). */
const REASONS: readonly FleetDashboardNoReadingReason[] = [
  'noRow',
  'onlyOpen',
  'onlyNoCounter',
  'onlyInvalid',
  'inWorkshop',
  'notActive',
  'joinedAfter',
];

/** A builder's link under this tab's own figure name. */
const named = (link: DashLink | null, metric: string): DashLink | null =>
  link === null ? null : { ...link, metric };

type ReadState = 'hidden' | 'loading' | 'error' | 'failed' | 'shown';

/** R1 `noReading` as this reader meets it: not theirs, on its way, failed, or drawn. */
const nowRead = (
  props: MixedTabProps,
): { state: ReadState; now: FleetDashboardNowDto | null; links: NowLinks | null } => {
  const { now, can, nowPending } = props;
  const none = { now: null, links: null };
  if (!sectionPermitted('noReading', can)) return { state: 'hidden', ...none };
  if (nowPending !== undefined) return { state: nowPending.state, ...none };
  if (now === null) return { state: 'hidden', ...none };
  if (now.unavailable.includes('noReading')) return { state: 'failed', ...none };
  if (now.noReading === null) return { state: 'hidden', ...none };
  return { state: 'shown', now, links: nowLinks(now) };
};

/** R2 `km` (the page's read, under the page's filters) as this reader meets it. */
const periodRead = (
  props: MixedTabProps,
): {
  state: ReadState;
  data: FleetDashboardPeriodDto | null;
  km: FleetDashboardPeriodKmDto | null;
  links: PeriodLinks | null;
} => {
  const { period, can } = props;
  const none = { data: null, km: null, links: null };
  if (!period.enabled || !sectionPermitted('km', can)) return { state: 'hidden', ...none };
  const data = period.data;
  if (data === undefined) return { state: period.failed ? 'error' : 'loading', ...none };
  if (data.unavailable.includes('km')) return { state: 'failed', ...none };
  if (data.km === null) return { state: 'hidden', ...none };
  return { state: 'shown', data, km: data.km, links: periodLinks(data) };
};

/** Under 1800 px the five cards sit three over two (of six columns); from 1800 px in one row. */
const THIRD = 'xl:col-span-2 min-[1800px]:!col-span-1';
const HALF = 'xl:col-span-3 min-[1800px]:!col-span-1';
/** The R1 card, the fifth: two to a row under 1280 px leave it alone, so it takes that row whole. */
const NOW_HALF = `${HALF} md:max-xl:col-span-2`;
/** The four R2 cards' place when R2 has no figures to show (its error stands for them). */
const R2_SPAN = 'md:col-span-2 xl:col-span-6 min-[1800px]:!col-span-4';

const InfoFoot = ({ icon, children }: { icon: IconPath; children: ReactNode }): JSX.Element => (
  <span className="flex items-center gap-2">
    <Icon d={icon} className="h-4 w-4 shrink-0 text-slate-400" />
    <span className="min-w-0">{children}</span>
  </span>
);

/** The car and its make, the lists' first column; a tag beside the code when given one. */
const CarCell = ({
  code,
  typeName,
  link,
  tag,
}: {
  code: string;
  typeName: LocalizedString | null;
  link: DashLink | null;
  tag?: ReactNode;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <div className="flex min-h-[22px] flex-wrap items-center gap-2">
        <CarChip code={code} link={link} />
        {tag}
      </div>
      {typeName !== null && (
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {localized(typeName, locale)}
        </span>
      )}
    </div>
  );
};

// ── 1 · The heading ───────────────────────────────────────────────────────────────────────────

const Heading = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  return (
    <TabHead
      icon={I.gauge}
      title={w('title')}
      live={false}
      sub={w('sub')}
      end={
        <RefreshTools
          updatedAt={props.updatedAt}
          onRefresh={props.onRefresh}
          refreshing={props.refreshing}
          {...(props.clock === undefined ? {} : { clock: props.clock })}
        />
      }
    />
  );
};

// ── 3 · The five cards ────────────────────────────────────────────────────────────────────────

const PeriodKpis = ({
  km,
  links,
  can,
}: {
  km: FleetDashboardPeriodKmDto;
  links: PeriodLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const noun = useNoun();
  const readings = useReadings();
  const unit = w('unit');
  const { coverage, noDistance } = km;
  const vehicles = (codes: readonly string[], metric: string): DashLink | null =>
    can('fleetVehicle.view') ? links.vehiclesByCodes(codes, metric) : null;
  return (
    <>
      <Kpi
        id="total"
        data-km-kpi="total"
        tone="emerald"
        icon={I.gauge}
        className={THIRD}
        title={w('total.title')}
        tag={
          <Tag tone="emerald" dot>
            {km.confirmedThrough === null ? (
              w('total.tagNone')
            ) : (
              <Phrase
                text={t('fleet.dash.km.notes.confirmedThrough')}
                parts={{ day: <N>{slashDay(km.confirmedThrough)}</N> }}
              />
            )}
          </Tag>
        }
        figure={
          <>
            <Big link={links.km('km.total')}>{kmText(km.total)}</Big>
            <span className={WORDS}>{unit}</span>
          </>
        }
        sub={
          <span data-km-average-sub="true" className={cn('whitespace-nowrap', MUTED)}>
            {km.average === null ? (
              t('fleet.dash.km.legend.noAverage')
            ) : (
              <Phrase
                text={w('total.sub')}
                parts={{
                  km: <N className={cn('font-bold', STRONG)}>{kmText(km.average)}</N>,
                  count: <N className="font-bold">{count(km.closedDays)}</N>,
                  days: t(`fleet.dash.km.closedDays.${custodyCountForm(locale, km.closedDays)}`),
                }}
              />
            )}
          </span>
        }
        foot={<InfoFoot icon={I.info}>{w('total.foot')}</InfoFoot>}
      />
      <Kpi
        id="perCar"
        data-km-kpi="perCar"
        tone="brand"
        icon={I.truck}
        className={THIRD}
        title={w('perCar.title')}
        tag={
          <Tag tone="brand" dot>
            {w('perCar.tag')}
          </Tag>
        }
        figure={
          <>
            <Big>{km.perVehicleAvg === null ? '—' : kmText(km.perVehicleAvg)}</Big>
            <span className={WORDS}>{unit}</span>
          </>
        }
        sub={
          <span data-km-coverage="true" className={cn('whitespace-nowrap', MUTED)}>
            <Phrase
              text={w('perCar.sub')}
              parts={{
                with: <N className={cn('font-bold', STRONG)}>{count(coverage.withReadings)}</N>,
                of: <N className="font-bold">{count(coverage.of)}</N>,
                noun: noun('car', coverage.of),
              }}
            />
          </span>
        }
        foot={
          <InfoFoot icon={I.layers}>
            <span data-km-active-foot="true">
              <Phrase
                text={w('perCar.foot')}
                parts={{
                  count: <N className={cn('font-bold', STRONG)}>{count(coverage.active)}</N>,
                }}
              />
              {coverage.inWorkshop > 0 && (
                <span data-km-throughout={coverage.inWorkshop}>
                  <Phrase
                    text={w('perCar.throughout')}
                    parts={{
                      count: (
                        <N className={cn('font-bold', STRONG)}>{count(coverage.inWorkshop)}</N>
                      ),
                    }}
                  />
                </span>
              )}
              {coverage.joinedAfter > 0 && (
                <span data-km-joined-after={coverage.joinedAfter}>
                  <Phrase
                    text={w('perCar.joinedAfter')}
                    parts={{
                      count: (
                        <N className={cn('font-bold', STRONG)}>{count(coverage.joinedAfter)}</N>
                      ),
                    }}
                  />
                </span>
              )}
            </span>
          </InfoFoot>
        }
      />
      <Kpi
        id="noDistance"
        data-km-kpi="noDistance"
        tone="slate"
        icon={PAUSE}
        className={THIRD}
        title={w('noDistance.title')}
        tag={
          <Tag tone="slate" dot>
            <Phrase
              text={w('noDistance.tag')}
              parts={{ count: <N>{count(coverage.of)}</N>, noun: noun('car', coverage.of) }}
            />
          </Tag>
        }
        figure={
          <>
            <Big link={vehicles(noDistance.codes, 'km.noDistance')}>{count(noDistance.cars)}</Big>
            <span className={WORDS}>{noun('car', noDistance.cars)}</span>
          </>
        }
        sub={<span className={MUTED}>{w('noDistance.sub')}</span>}
        foot={
          <InfoFoot icon={I.info}>
            <span data-km-never-foot={noDistance.neverRead}>
              <Phrase
                text={w('noDistance.foot')}
                parts={{
                  count: (
                    <Small link={vehicles(noDistance.neverReadCodes, 'km.noDistance.neverRead')}>
                      {count(noDistance.neverRead)}
                    </Small>
                  ),
                }}
              />
            </span>
          </InfoFoot>
        }
      />
      <Kpi
        id="review"
        data-km-kpi="review"
        tone="rose"
        icon={I.warn}
        className={HALF}
        title={w('review.title')}
        tag={
          <Tag tone="rose" dot>
            {w('review.tag')}
          </Tag>
        }
        figure={
          <>
            <Big link={links.km('km.invalidRows')}>{count(km.invalidRows)}</Big>
            <span className={WORDS}>{readings(km.invalidRows)}</span>
          </>
        }
        sub={<span className={MUTED}>{w('review.sub')}</span>}
        foot={<FootLink link={links.km('km.invalidRows.list')}>{w('review.link')}</FootLink>}
      />
    </>
  );
};

const StaleKpi = ({
  now,
  links,
  can,
}: {
  now: FleetDashboardNowDto;
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element | null => {
  const w = useWords();
  const t = useT();
  const noun = useNoun();
  const nr = now.noReading;
  if (nr === null) return null;
  const longest = nr.staleRows[0];
  return (
    <Kpi
      id="stale"
      data-km-kpi="stale"
      tone="amber"
      icon={I.clock}
      className={NOW_HALF}
      title={w('stale.title', { count: count(nr.days), noun: noun('day', nr.days) })}
      tag={<NowChip />}
      figure={
        <>
          <Big link={links.noReading(nr.stale.map((car) => car.code))}>{count(nr.staleCount)}</Big>
          <span className={WORDS}>{noun('car', nr.staleCount)}</span>
        </>
      }
      sub={
        longest === undefined ? (
          <span className={MUTED}>{w('stale.allRead')}</span>
        ) : (
          <span
            data-km-longest={longest.code}
            className={cn('flex items-center gap-1 whitespace-nowrap', MUTED)}
          >
            <Phrase
              text={w('stale.sub')}
              parts={{
                day: (
                  <N className={cn('font-bold', TONE.amber.text)}>{slashDay(longest.lastDate)}</N>
                ),
              }}
            />
            <CarChip
              code={longest.code}
              link={
                can('fleetVehicle.view')
                  ? links.vehicle(longest.vehicleId, 'noReading.longest')
                  : null
              }
            />
          </span>
        )
      }
      foot={
        <InfoFoot icon={I.cog}>
          {w('stale.foot')}
          <Sep />
          {t('fleet.dash.overview.actions.line.noReading.sub')}
        </InfoFoot>
      }
    />
  );
};

const Kpis = ({
  props,
  r1,
  r2,
}: {
  props: MixedTabProps;
  r1: ReturnType<typeof nowRead>;
  r2: ReturnType<typeof periodRead>;
}): JSX.Element | null => {
  if (r1.state === 'hidden' && r2.state === 'hidden') return null;
  const { can } = props;
  let periodCards: ReactNode = null;
  if (r2.state === 'loading') {
    periodCards = [THIRD, THIRD, THIRD, HALF].map((span, i) => (
      <div key={i} data-dash-loading="true" className={span}>
        <Skeleton className="h-[218px] rounded-2xl" />
      </div>
    ));
  } else if (r2.state === 'error') {
    periodCards = (
      <div className={R2_SPAN}>
        <ReadError error={null} onRetry={props.period.onRetry} />
      </div>
    );
  } else if (r2.state === 'failed') {
    periodCards = <SectionError section="km" onRetry={props.period.onRetry} className={R2_SPAN} />;
  } else if (r2.km !== null && r2.links !== null) {
    periodCards = <PeriodKpis km={r2.km} links={r2.links} can={can} />;
  }
  let nowCard: ReactNode = null;
  if (r1.state === 'loading') {
    nowCard = (
      <div data-dash-loading="true" data-km-loading="stale" className={NOW_HALF}>
        <Skeleton className="h-[218px] rounded-2xl" />
      </div>
    );
  } else if (r1.state === 'error' || r1.state === 'failed') {
    nowCard = <SectionError section="noReading" onRetry={props.onRetry} className={NOW_HALF} />;
  } else if (r1.now !== null && r1.links !== null) {
    nowCard = <StaleKpi now={r1.now} links={r1.links} can={can} />;
  }
  return (
    <div
      data-km-kpis="true"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6 min-[1800px]:grid-cols-5"
    >
      {periodCards}
      {nowCard}
    </div>
  );
};

// ── 4 · «الكيلومترات يومًا بيوم» ─────────────────────────────────────────────────────────────

const DayChart = ({
  data,
  km,
  links,
}: {
  data: FleetDashboardPeriodDto;
  km: FleetDashboardPeriodKmDto;
  links: PeriodLinks;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const daily = data.range.granularity === 'day';
  const branch = data.vehicleScope.scopeBranches?.length === 1;
  const note = `chart.note${daily ? '' : 'Monthly'}${branch ? 'Branch' : ''}`;
  return (
    <Card data-km-block="chart" className="mt-5">
      <BlockHead
        icon={I.bars}
        tone="emerald"
        title={t(daily ? 'fleet.dash.km.chart.titleDaily' : 'fleet.dash.km.chart.titleMonthly')}
        note={w(note)}
        chips={
          <>
            <RangeChip range={data.range} />
            <Fig
              link={links.km('km.total')}
              linkedClassName=""
              className={cn(COUNT_CHIP, 'py-0.5', TONE.emerald.soft)}
            >
              <N>{kmText(km.total)}</N> {w('unit')}
            </Fig>
          </>
        }
      />
      <div className="px-5 pb-5">
        <KmDayChart km={km} data={data} />
      </div>
      <BlockFoot stack>
        <KmChartNotes km={km} data={data} />
      </BlockFoot>
    </Card>
  );
};

// ── 5 · «أعلى 5» | «أقل 5» — one brand bar against the top car ─────────────────────────────────

const RankList = ({
  side,
  km,
  today,
  links,
  can,
}: {
  side: 'top' | 'bottom';
  km: FleetDashboardPeriodKmDto;
  today: string;
  links: PeriodLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const noun = useNoun();
  const rows: readonly FleetDashboardPeriodKmDto['bottom5'][number][] =
    side === 'top' ? km.top5.map((row) => ({ ...row, inWorkshopSince: null })) : km.bottom5;
  const max = km.top5[0]?.km ?? 0;
  if (rows.length === 0) {
    return <p className={cn('px-5 py-4', NOTE)}>{t('fleet.dash.ranking.none')}</p>;
  }
  return (
    <ol className={DIVIDE}>
      {rows.map((row, i) => {
        const since = row.inWorkshopSince;
        const days = since === null ? 0 : Math.max(0, daysBetweenYmd(since, today));
        const pct = max > 0 ? Math.min(100, (row.km / max) * 100) : 0;
        return (
          <li
            key={row.vehicleId}
            data-km-row={row.code}
            data-km-place={`${side}-${i + 1}`}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 sm:flex"
          >
            <span
              className={cn(
                'inline-grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold',
                TONE.brand.soft,
                NUM,
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 sm:w-[260px] sm:shrink-0">
              <CarCell
                code={row.code}
                typeName={row.typeName}
                link={
                  can('fleetVehicle.view')
                    ? links.vehicle(
                        row.vehicleId,
                        side === 'top' ? 'km.topVehicle' : 'km.bottomVehicle',
                      )
                    : null
                }
                tag={
                  since === null ? undefined : (
                    <span
                      data-km-in-workshop={since}
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4 dark:font-semibold',
                        TONE.amber.soft,
                      )}
                    >
                      <Icon d={I.wrench} className="h-3 w-3" />
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
            </div>
            <div className="min-w-0 max-sm:col-span-3 max-sm:row-start-2 sm:flex-1">
              <div className="h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
                <div
                  data-km-bar={row.code}
                  className={cn('h-2 rounded-full', TONE.brand.bar)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <span className="whitespace-nowrap text-end max-sm:col-start-3 max-sm:row-start-1 sm:w-[92px] sm:shrink-0">
              <Fig
                link={links.carKm(row.code, side === 'top' ? 'km.top5' : 'km.bottom5')}
                className={cn('text-[15px] font-bold', STRONG)}
              >
                <N>{kmText(row.km)}</N>
              </Fig>
              <span className={cn('ms-1 text-xs', MUTED)}>{w('unit')}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/** «لا تدخل الترتيب:» — every car of the set without a valid reading, by its one reason (names,
 *  not a count; the old «ترتيب السيارات» list, moved here). */
const OutOfRanking = ({
  km,
  links,
  can,
}: {
  km: FleetDashboardPeriodKmDto;
  links: PeriodLinks;
  can: (permission: string) => boolean;
}): JSX.Element | null => {
  const t = useT();
  if (km.withoutReadings.length === 0) return null;
  return (
    <div
      data-km-out="true"
      className="flex items-start gap-x-3 text-xs font-semibold min-[1800px]:items-center"
    >
      <span className={cn('whitespace-nowrap font-bold leading-6', STRONG)}>
        {t('fleet.dash.ranking.outTitle')}
      </span>
      <div className="flex min-w-0 flex-col gap-y-1.5 min-[1800px]:flex-row min-[1800px]:flex-wrap min-[1800px]:items-center min-[1800px]:gap-x-3">
        {REASONS.map((reason) => {
          const cars = km.withoutReadings.filter((row) => row.reason === reason);
          if (cars.length === 0) return null;
          return (
            <span
              key={reason}
              data-km-reason={reason}
              className="inline-flex flex-wrap items-center gap-1"
            >
              {cars.map((row) => (
                <CarChip
                  key={row.vehicleId}
                  code={row.code}
                  link={
                    can('fleetVehicle.view')
                      ? links.vehicle(row.vehicleId, 'km.withoutReadings')
                      : null
                  }
                />
              ))}
              <span className={MUTED}>{t(`fleet.dash.ranking.reason.${reason}`)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

/** A ranking card as a subgrid of the pair: its head, list and foot on the pair's own rows. */
const PAIR_CARD = '!grid row-span-3 grid-rows-subgrid gap-y-0';

const RankPair = ({
  data,
  km,
  links,
  can,
}: {
  data: FleetDashboardPeriodDto;
  km: FleetDashboardPeriodKmDto;
  links: PeriodLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  return (
    // Each card spans three rows of the pair's grid (head, list, foot) as a subgrid, so the two
    // heads, lists and feet share their heights and the feet's rules stay level.
    <div data-km-block="ranking" className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card data-km-rank="top" className={PAIR_CARD}>
        <BlockHead
          icon={I.rank}
          tone="emerald"
          title={t('fleet.dash.ranking.top')}
          note={t('fleet.dash.ranking.note')}
        />
        <div className={cn('border-t', RULE)}>
          <RankList side="top" km={km} today={data.today} links={links} can={can} />
        </div>
        <BlockFoot>
          <FootLink link={links.km('km.ranking.all')}>{w('ranking.all')}</FootLink>
          <span className={cn('flex items-center gap-1.5 text-xs font-semibold', MUTED)}>
            <Icon d={I.info} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {w('ranking.barNote')}
          </span>
        </BlockFoot>
      </Card>
      <Card data-km-rank="bottom" className={PAIR_CARD}>
        <BlockHead
          icon={I.rank}
          tone="amber"
          title={t('fleet.dash.ranking.bottom')}
          note={w('ranking.bottomNote')}
        />
        <div className={cn('border-t', RULE)}>
          <RankList side="bottom" km={km} today={data.today} links={links} can={can} />
        </div>
        {km.withoutReadings.length === 0 ? (
          <div />
        ) : (
          <BlockFoot>
            <OutOfRanking km={km} links={links} can={can} />
          </BlockFoot>
        )}
      </Card>
    </div>
  );
};

// ── 6 · «استثناءات قراءات العدادات» ──────────────────────────────────────────────────────────

/** A group's row: the car, what it says, «فتح»; where the three do not fit on one line (a phone),
 *  what it says and «فتح» go under the car rather than over it. */
const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3';

const Group = ({
  id,
  tone,
  title,
  note,
  chips,
  state,
  total,
  rows,
  end,
  empty,
  more,
  all,
  section,
  onRetry,
}: {
  id: 'stale' | 'never' | 'review';
  tone: Tone;
  title: string;
  note: string;
  chips: ReactNode;
  state: ReadState;
  total: number;
  rows: ReactNode[];
  /** The line under a group that shows all it has. */
  end: string;
  /** The line of a group with nothing in it. */
  empty: string;
  /**
   * «و3 سيارات أخرى في القائمة الكاملة» — what «عرض الكل» adds; with no «عرض الكل» (`listed` false)
   * the line names the rest without pointing at a list the reader cannot open.
   */
  more: (n: number, listed: boolean) => ReactNode;
  /** «عرض الكل (N)»'s screen; `null` = no list shows exactly the group (the line is left out). */
  all: DashLink | null;
  section: 'noReading' | 'km';
  onRetry: () => void;
}): JSX.Element => {
  const w = useWords();
  const line = (marker: string, icon: ReactNode, text: ReactNode): JSX.Element => (
    <div
      data-km-group-end={marker}
      className={cn(
        'flex flex-1 items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
        RULE,
        MUTED,
      )}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
  const tick = <IconTile d={I.tick} tone="emerald" size="sm" />;
  return (
    <section
      data-km-exception={id}
      className={cn(
        'flex min-w-0 flex-col border-t xl:border-s xl:border-t-0 xl:first:border-s-0',
        RULE,
      )}
    >
      <div className="px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap text-[15px]')}>
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
            />
            {title}
          </h4>
          {state === 'shown' && chips}
        </div>
        <p className={cn('mt-1 ps-4 text-xs font-semibold', MUTED)}>{note}</p>
      </div>
      {state === 'loading' ? (
        <div data-dash-loading="true" className={cn('space-y-3 border-t px-5 py-4', RULE)}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      ) : state !== 'shown' ? (
        <div className={cn('border-t p-4', RULE)}>
          <SectionError section={section} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {rows.length > 0 && <ul className={cn('border-t', RULE, DIVIDE)}>{rows}</ul>}
          {/* The group ends on what it leaves out, not on blank space: the rest of its list, or
              the statement that there is none. */}
          {total > FLEET_DASHBOARD_EXCEPTION_ROWS
            ? line(
                'more',
                <Icon d={I.layers} className="h-4 w-4 shrink-0 text-slate-400" />,
                more(total - FLEET_DASHBOARD_EXCEPTION_ROWS, all !== null),
              )
            : line(total === 0 ? 'empty' : 'end', tick, total === 0 ? empty : end)}
          {all !== null && total > 0 && (
            <BlockFoot>
              <FootLink link={all}>
                <span>
                  <Phrase text={w('exceptions.all')} parts={{ count: <N>{count(total)}</N> }} />
                </span>
              </FootLink>
            </BlockFoot>
          )}
        </>
      )}
    </section>
  );
};

const Exceptions = ({
  props,
  r1,
  r2,
}: {
  props: MixedTabProps;
  r1: ReturnType<typeof nowRead>;
  r2: ReturnType<typeof periodRead>;
}): JSX.Element | null => {
  const w = useWords();
  const noun = useNoun();
  const readings = useReadings();
  const { can } = props;
  if (r1.state === 'hidden' && r2.state === 'hidden') return null;
  const nr = r1.now?.noReading ?? null;
  const km = r2.km;
  const nowLink = r1.links;
  const periodLink = r2.links;
  /** A car's record (the registry's guard); an old-book code has none. */
  const record = (vehicleId: string | null, metric: string): DashLink | null => {
    if (vehicleId === null || !can('fleetVehicle.view')) return null;
    return (nowLink ?? periodLink)?.vehicle(vehicleId, metric) ?? null;
  };
  const scope = r1.now?.scopeBranches ?? r2.data?.vehicleScope.scopeBranches ?? null;
  const branch = scope?.length === 1;
  const chip = (tone: Tone, n: number, word: string, id: string): JSX.Element => (
    <span data-km-chip={id} className={cn(COUNT_CHIP, 'py-0.5', TONE[tone].soft)}>
      <N>{count(n)}</N> {word}
    </span>
  );
  const more = (n: number, word: string, listed: boolean): ReactNode => (
    <Phrase
      text={w(listed ? 'exceptions.more' : 'exceptions.moreNoList')}
      parts={{ count: <N className={cn('font-bold', STRONG)}>{count(n)}</N>, noun: word }}
    />
  );
  const open = (link: DashLink | null): ReactNode =>
    link === null ? null : (
      <Btn link={link} className="h-9 px-4">
        {w('open')}
      </Btn>
    );

  const staleRows = (nr?.staleRows ?? []).map((row) => (
    <li key={row.vehicleId} data-km-row={row.code} className={ROW}>
      <CarCell
        code={row.code}
        typeName={row.typeName}
        link={record(row.vehicleId, 'noReading.vehicle')}
      />
      <div className="ms-auto flex items-center gap-3">
        <div className="flex flex-col items-end gap-0.5 text-[13px]">
          <span className={cn('whitespace-nowrap', MUTED)}>
            <Phrase
              text={w('exceptions.stale.last')}
              parts={{
                day: (
                  <N className="font-semibold text-slate-700 dark:text-slate-200">
                    {slashDay(row.lastDate)}
                  </N>
                ),
              }}
            />
          </span>
          <Since days={row.days} />
        </div>
        {open(nowLink === null ? null : nowLink.noReadingCar(row.code))}
      </div>
    </li>
  ));
  const neverRows = (nr?.neverReadRows ?? []).map((row) => (
    <li key={row.vehicleId} data-km-row={row.code} className={ROW}>
      <CarCell
        code={row.code}
        typeName={row.typeName}
        link={record(row.vehicleId, 'noReading.vehicle')}
      />
      <span className="ms-auto">{open(record(row.vehicleId, 'noReading.neverRow'))}</span>
    </li>
  ));
  const reviewRows = (km?.invalidList ?? []).map((row) => (
    <li key={`${row.code}-${row.date}-${row.from}`} data-km-row={row.code} className={ROW}>
      <CarCell
        code={row.code}
        typeName={row.typeName}
        // A car deleted since has no file to open; its «فتح» below opens that day without its code.
        link={row.deleted ? null : record(row.vehicleId, 'km.invalidList.vehicle')}
      />
      <div className="ms-auto flex items-center gap-3">
        <div className="flex flex-col items-end gap-0.5 text-[13px]">
          <span
            data-km-from-to={`${row.from}-${row.to}`}
            className={cn('whitespace-nowrap', MUTED)}
          >
            <Phrase
              text={w('exceptions.review.fromTo')}
              parts={{
                from: (
                  <N className="font-semibold text-slate-700 dark:text-slate-200">
                    {count(row.from)}
                  </N>
                ),
                to: (
                  <N className="font-semibold text-slate-700 dark:text-slate-200">
                    {count(row.to)}
                  </N>
                ),
              }}
            />
          </span>
          <span className="whitespace-nowrap">
            <N className={MUTED}>{slashDay(row.date)}</N>
            <Sep />
            <span data-km-negative={row.km} className={cn('font-bold', TONE.rose.text)}>
              <N>{`−${count(Math.abs(row.km))}`}</N> {w('unit')}
            </span>
          </span>
        </div>
        {open(
          periodLink === null
            ? null
            : row.deleted
              ? // The register's code filter finds live cars only: that day, the row among them.
                periodLink.kmDay(row.date, 'km.invalidList.row')
              : periodLink.carKmDay(row.code, row.date, 'km.invalidList.row'),
        )}
      </div>
    </li>
  ));

  const groups: ReactNode[] = [];
  if (r1.state !== 'hidden') {
    const staleCount = nr?.staleCount ?? 0;
    const neverCount = nr?.neverReadCount ?? 0;
    const days = nr?.days ?? 0;
    groups.push(
      <Group
        key="stale"
        id="stale"
        tone="amber"
        title={w('exceptions.stale.title')}
        note={w('exceptions.stale.note', { count: count(days), noun: noun('day', days) })}
        chips={
          <>
            <NowChip />
            {chip('amber', staleCount, noun('car', staleCount), 'stale')}
          </>
        }
        state={r1.state}
        total={staleCount}
        rows={staleRows}
        end={w(branch ? 'exceptions.end.staleBranch' : 'exceptions.end.stale')}
        empty={w('stale.allRead')}
        more={(n, listed) => more(n, noun('car', n), listed)}
        all={
          nowLink === null || nr === null
            ? null
            : named(nowLink.noReading(nr.stale.map((car) => car.code)), 'noReading.all')
        }
        section="noReading"
        onRetry={props.onRetry}
      />,
      <Group
        key="never"
        id="never"
        tone="sky"
        title={w('exceptions.never.title')}
        note={w('exceptions.never.note')}
        chips={
          <>
            <NowChip />
            {chip('sky', neverCount, noun('car', neverCount), 'never')}
          </>
        }
        state={r1.state}
        total={neverCount}
        rows={neverRows}
        end={w(branch ? 'exceptions.end.neverBranch' : 'exceptions.end.never')}
        empty={w('exceptions.none.never')}
        more={(n, listed) => more(n, noun('car', n), listed)}
        all={
          nowLink === null || nr === null || !can('fleetVehicle.view')
            ? null
            : nowLink.neverRead(nr.neverRead.map((car) => car.code))
        }
        section="noReading"
        onRetry={props.onRetry}
      />,
    );
  }
  if (r2.state !== 'hidden') {
    const invalid = km?.invalidRows ?? 0;
    groups.push(
      <Group
        key="review"
        id="review"
        tone="rose"
        title={w('review.title')}
        note={w('exceptions.review.note')}
        chips={chip('rose', invalid, readings(invalid), 'review')}
        state={r2.state === 'error' ? 'failed' : r2.state}
        total={invalid}
        rows={reviewRows}
        end={w(branch ? 'exceptions.end.reviewBranch' : 'exceptions.end.review')}
        empty={w('exceptions.none.review')}
        more={(n, listed) => more(n, readings(n), listed)}
        all={periodLink === null ? null : periodLink.km('km.invalidList.all')}
        section="km"
        onRetry={props.period.onRetry}
      />,
    );
  }
  return (
    <Card data-km-block="exceptions" className="mt-5">
      <BlockHead
        icon={I.clipboardCheck}
        tone="amber"
        title={w('exceptions.title')}
        note={w(branch ? 'exceptions.noteBranch' : 'exceptions.note')}
      />
      <div
        className={cn(
          'grid grid-cols-1 border-t',
          groups.length === 3 ? 'xl:grid-cols-3' : groups.length === 2 ? 'xl:grid-cols-2' : '',
          RULE,
        )}
      >
        {groups}
      </div>
    </Card>
  );
};

// ── 7 · Under one branch: «الكيلومترات حسب النوع» ─────────────────────────────────────────────

const ByType = ({
  data,
  km,
  rows,
}: {
  data: FleetDashboardPeriodDto;
  km: FleetDashboardPeriodKmDto;
  rows: NonNullable<FleetDashboardPeriodKmDto['byType']>;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const unit = w('unit');
  const typed = (typeId: string) =>
    periodLinks({ range: data.range, vehicleScope: { ...data.vehicleScope, typeIds: [typeId] } });
  return (
    <Card data-km-block="byType" className="mt-5">
      <BlockHead
        icon={I.gauge}
        tone="teal"
        title={t('fleet.dash.km.byType')}
        note={t('fleet.dash.km.byTypeNote')}
        chips={
          <>
            <RangeChip range={data.range} />
            <span className={cn(COUNT_CHIP, 'py-0.5', TONE.teal.soft)}>
              <N>{kmText(km.total)}</N> {unit}
            </span>
          </>
        }
      />
      {rows.length === 0 ? (
        <p className={cn('px-5 pb-5 pt-3', NOTE)}>{t('fleet.dash.km.noReadings')}</p>
      ) : (
        <ColumnChart
          id="km-by-type"
          ariaLabel={t('fleet.dash.km.byType')}
          of={w('byType.ofTotal')}
          columns={rows.map((row) => ({
            key: row.typeId,
            name: localized(row.name, locale),
            value: row.km,
            valueText: kmText(row.km),
            unit,
            share: shareText(row.km, km.total),
            link: typed(row.typeId).km('km.byType'),
          }))}
        />
      )}
      <BlockFoot>
        <p data-km-type-average="true" className="font-semibold">
          {km.average === null || km.confirmedThrough === null ? (
            t('fleet.dash.km.legend.noAverage')
          ) : (
            <Phrase
              text={t('fleet.dash.distribution.averageLine')}
              parts={{
                day: <N>{slashDay(km.confirmedThrough)}</N>,
                km: <N className={cn('font-bold', STRONG)}>{kmText(km.average)}</N>,
              }}
            />
          )}
        </p>
      </BlockFoot>
    </Card>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

/** R2 on its way: the chart and the pair in grey, never zeroes pretending to be data. */
const PeriodSkeleton = (): JSX.Element => (
  <div data-dash-loading="true" data-km-loading="period" className="mt-5 space-y-5">
    <Skeleton className="h-[460px] rounded-2xl" />
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Skeleton className="h-[420px] rounded-2xl" />
      <Skeleton className="h-[420px] rounded-2xl" />
    </div>
  </div>
);

export const KmTab = (props: MixedTabProps): JSX.Element => {
  const w = useWords();
  const { period, can } = props;
  const r1 = nowRead(props);
  const r2 = periodRead(props);
  const periodOk = period.enabled && sectionPermitted('km', can);
  const shown = r2.state === 'shown' && r2.data !== null && r2.km !== null && r2.links !== null;
  return (
    <div data-dash-tab-body="km">
      <Heading props={props} />
      {/* The dashboard's own period bar at the top, above every figure it moves (as _1): the page's
          ONE filter state, written to the address bar. */}
      {periodOk && (
        <div data-km-period-bar="true">
          <PeriodFilterBar
            filters={period.filters}
            onFilters={period.onFilters}
            data={period.data}
            can={can}
          />
        </div>
      )}
      <Kpis props={props} r1={r1} r2={r2} />
      {r2.state === 'loading' && <PeriodSkeleton />}
      {shown && r2.data !== null && r2.km !== null && r2.links !== null && (
        <>
          <DayChart data={r2.data} km={r2.km} links={r2.links} />
          <RankPair data={r2.data} km={r2.km} links={r2.links} can={can} />
        </>
      )}
      <Exceptions props={props} r1={r1} r2={r2} />
      {shown && r2.data !== null && r2.km !== null && r2.km.byType !== null && (
        <ByType data={r2.data} km={r2.km} rows={r2.km.byType} />
      )}
      {(r1.state !== 'hidden' || r2.state !== 'hidden') && (
        <div className="mt-4 px-1">
          <NoteLine>
            <span data-km-page-note="true">{w('pageNote')}</span>
          </NoteLine>
        </div>
      )}
    </div>
  );
};
