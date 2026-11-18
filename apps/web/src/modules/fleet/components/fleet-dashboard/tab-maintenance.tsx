// «الصيانة والورش» — the owner-approved sample (approved/maint-dark.png, maint-branch-dark.png; harness
// zz-maintenance.tsx), the dashboard's first tab of «الآن» and a period both, drawn over the real reads:
//
//   1  the heading — its line names only what this reader is shown; «تحديث» refreshes both reads and
//      «آخر تحديث» is the older of the two (the page hands both in)
//   2  «الآن» (R1): four KPI cards, each under its own gate — «بلغت حد الصيانة» · «تقترب من حد
//      الصيانة» · «في الورشة الآن» · «صفوف توكيل بلا قيمة» — then «إنذارات الصيانة بالكيلومتر», the
//      page's full width (at most FLEET_DASHBOARD_ALARM_ROWS rows, red first, as the server sends them)
//   3  «خلال الفترة» (the page's R2, under the page's own filters): its head, then the dashboard's
//      period bar right under it (DECISIONS §4a Q2 (أ)), then «خرجت من الورشة» · «متوسط أيام البقاء»,
//      the two bar lists (by work type | by workshop), and the bottom pair «أكثر السيارات دخولًا
//      للورشة» | «أطول بقاء في الورشة الآن» (the second is R1's: «لقطة الآن», the period moves nothing)
//
// EVERY PERIOD FIGURE IS BY EXIT DAY (§4a Q1): R2 `exits` — the visits that LEFT the workshop in the
// range; their links carry `outFrom` / `outTo` and never `from` / `to`. «أرقام الفترة» keeps its own
// check-in count and says so. Each read has its own face: R1 on its way or failed costs «الآن» and the
// longest-stay card only; R2 on its way or failed costs the period figures only.
//
// NOTHING IS COUNTED HERE. Every figure is a field a read sent: the alarm counts are `red` / `yellow`
// (never the rows drawn), «كل إنذارات الصيانة (N)» is the two counts the table's chip shows side by
// side, the bars and the ranking are the server's. The browser draws shares and the meters only.
// «نشطة · خارج الخدمة» and the average stay have no link: no screen lists exactly them. Every data bar
// is the brand's (DECISIONS §5); the alarm levels keep their red and amber. A visit carries no amount:
// nothing here is money, and the foot says where the cost is.
import { type ReactNode } from 'react';
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodExitBarDto,
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
import { sectionPermitted, share, shareText, slashDay } from '../../lib/fleet-dashboard-tabs';
import {
  Btn,
  CHIP,
  Card,
  CarChip,
  DIVIDE,
  Fig,
  FootLink,
  I,
  Icon,
  IconTile,
  LiveChip,
  MUTED,
  Meter,
  N,
  NOTE,
  NUM,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  TONE,
  TabHead,
  Tag,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import {
  Phrase,
  RefreshTools,
  SectionError,
  count,
  useNoun,
  type MixedTabProps,
} from './dash-shell';
import {
  BandHead,
  Big,
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  HBars,
  Kpi,
  NoteLine,
  NowChip,
  RangeChip,
  ReadBand,
  Sep,
  Since,
  WORDS,
  type HBarRow,
} from './dash-blocks';
import { PeriodFilterBar } from './period-filter-bar';

/** The word of a key under the tab's own namespace. */
const useWords = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.maintenance.${key}`, params);
};

const nameOf = (name: LocalizedString | null, locale: Locale, unnamed: string): string =>
  name === null ? unnamed : localized(name, locale);

/** «3.4» — the server's one decimal, always written with it. */
const ONE_DECIMAL = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** «خرجت من الورشة» — a door and the arrow leaving it (the kit carries no such glyph). */
const EXIT: IconPath = [
  'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
];

type NowSection = 'maintenanceAlarm' | 'workshop' | 'dealershipPending';
type NowState = 'hidden' | 'shown' | 'failed';

/** An R1 section as this reader meets it: not theirs, drawn, or failed (its error in its place). */
const nowState = (
  now: FleetDashboardNowDto | null,
  section: NowSection,
  can: (permission: string) => boolean,
): NowState => {
  if (now === null || !sectionPermitted(section, can)) return 'hidden';
  if (now.unavailable.includes(section)) return 'failed';
  return now[section] === null ? 'hidden' : 'shown';
};

/** A row of 1–4 cards: the approved four across from 1280 px; fewer keep the same card width. */
const KPI_GRID: Readonly<Record<number, string>> = {
  1: 'sm:grid-cols-2',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
};

const Dot = ({ tone }: { tone: Tone }): JSX.Element => (
  <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)} />
);

/** The «ⓘ» of a KPI's foot or a block's foot note. */
const FOOT_NOTE = cn('flex items-center gap-1.5 text-xs font-semibold', MUTED);

/** A list's end in words: what it leaves out, or that it is empty. */
const EndRow = ({ text, marker }: { text: string; marker: string }): JSX.Element => (
  <div
    data-maint-end={marker}
    className={cn(
      'flex flex-1 items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
      RULE,
      MUTED,
    )}
  >
    <IconTile d={I.tick} tone="emerald" size="sm" />
    <span>{text}</span>
  </div>
);

// ── The tables: a table from 768 px, each row a block under it (no sideways scroll on a phone) ──

const CELL = 'px-4 py-3.5 align-middle first:ps-5 last:pe-5';
const PAIR_CELL = 'px-3 py-3 align-middle first:ps-5 last:pe-5';
const P_TABLE = 'max-md:block';
const P_HEAD = 'max-md:hidden';
const P_BODY = 'max-md:block';
const P_ROW = cn(
  'max-md:grid max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-3.5',
);
const P_CELL = 'max-md:block max-md:p-0 max-md:first:ps-0 max-md:last:pe-0';
/**
 * The alarm table is the widest (five columns, the meter's sentence on one line): it is a table
 * from 1024 px only, its rows blocks below — at a tablet's 768–1023 px it would scroll sideways
 * inside its card and hide «فتح» (the other tables fit from 768 px).
 */
const A_TABLE = 'max-lg:block';
const A_HEAD = 'max-lg:hidden';
const A_BODY = 'max-lg:block';
const A_ROW = cn(
  'max-lg:grid max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:px-4 max-lg:py-3.5',
);
const A_CELL = 'max-lg:block max-lg:p-0 max-lg:first:ps-0 max-lg:last:pe-0';
/** A column's name beside its value, on a phone only (the table's heading says it from 768 px;
 *  `lg`: the alarm table's, from 1024 px). */
const PhoneLabel = ({
  children,
  upTo = 'md',
}: {
  children: ReactNode;
  upTo?: 'md' | 'lg';
}): JSX.Element => (
  <span
    className={cn('me-1.5 text-xs font-semibold', upTo === 'lg' ? 'lg:hidden' : 'md:hidden', MUTED)}
  >
    {children}
  </span>
);
const WORK_CHIP = cn(CHIP, 'inline-flex items-center whitespace-nowrap py-1');

// ── 1 · The heading ───────────────────────────────────────────────────────────────────────────

const Heading = ({
  props,
  parts,
}: {
  props: MixedTabProps;
  parts: readonly string[];
}): JSX.Element => {
  const w = useWords();
  const line = w('sub.line', { parts: parts.join(w('sub.join')) });
  return (
    <TabHead
      icon={I.wrench}
      title={w('title')}
      live={false}
      sub={parts.length === 0 ? undefined : line.charAt(0).toUpperCase() + line.slice(1)}
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

// ── 2 · «الآن»: the four snapshot cards ───────────────────────────────────────────────────────

const AlarmKpis = ({
  alarm,
  links,
}: {
  alarm: NonNullable<FleetDashboardNowDto['maintenanceAlarm']>;
  links: NowLinks;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const km = (n: number): ReactNode => <N className={cn('font-bold', STRONG)}>{count(n)}</N>;
  return (
    <>
      <Kpi
        id="red"
        data-maint-kpi="red"
        tone="red"
        icon={I.warn}
        title={w('red.title')}
        tag={
          alarm.overdue > 0 ? (
            <Tag tone="red" dot>
              <Phrase text={w('red.tag')} parts={{ count: <N>{count(alarm.overdue)}</N> }} />
            </Tag>
          ) : undefined
        }
        figure={
          <>
            <Big
              link={links.alarm('red', alarm.codes === null ? null : alarm.codes.red)}
              className="!text-red-600 dark:!text-red-400"
            >
              {count(alarm.red)}
            </Big>
            <span className={WORDS}>{noun('car', alarm.red)}</span>
          </>
        }
        sub={
          <span className={MUTED}>
            <Phrase text={w('red.sub')} parts={{ km: km(alarm.redKm) }} />
          </span>
        }
        foot={w('red.foot')}
        footIcon={I.cog}
      />
      <Kpi
        id="yellow"
        data-maint-kpi="yellow"
        tone="amber"
        icon={I.gauge}
        title={w('yellow.title')}
        tag={
          <Tag tone="amber" dot>
            {w('yellow.tag')}
          </Tag>
        }
        figure={
          <>
            <Big link={links.alarm('yellow', alarm.codes === null ? null : alarm.codes.yellow)}>
              {count(alarm.yellow)}
            </Big>
            <span className={WORDS}>{noun('car', alarm.yellow)}</span>
          </>
        }
        sub={
          <span className={MUTED}>
            <Phrase text={w('yellow.sub')} parts={{ km: km(alarm.yellowKm) }} />
          </span>
        }
        foot={w('yellow.foot')}
        footIcon={I.cog}
      />
    </>
  );
};

const WorkshopKpi = ({
  workshop,
  links,
  can,
}: {
  workshop: NonNullable<FleetDashboardNowDto['workshop']>;
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const noun = useNoun();
  const { oldest } = workshop;
  const plain = (n: number): ReactNode => <N className={cn('font-bold', STRONG)}>{count(n)}</N>;
  return (
    <Kpi
      id="workshop"
      data-maint-kpi="workshop"
      tone="amber"
      icon={I.wrench}
      title={t('fleet.dash.now.workshopTitle')}
      tag={
        <Tag tone="amber" dot>
          {w('workshop.tag')}
        </Tag>
      }
      figure={
        <>
          <Big link={links.workshopOpen()}>{count(workshop.open)}</Big>
          <span className={WORDS}>{noun('car', workshop.open)}</span>
        </>
      }
      sub={
        oldest === null ? (
          <span className={MUTED}>{w('workshop.none')}</span>
        ) : (
          <span
            data-maint-oldest={oldest.code}
            className={cn('flex items-center gap-1 whitespace-nowrap', MUTED)}
          >
            {t('fleet.dash.now.oldest')}
            {/* The car's file is the vehicles screen's (fleetVehicle.view), not this section's
                (fleetMaintenance.view): a link only with its own guard. */}
            <CarChip
              code={oldest.code}
              link={
                oldest.vehicleId === null || oldest.deleted || !can('fleetVehicle.view')
                  ? null
                  : links.vehicle(oldest.vehicleId, 'workshop.oldest')
              }
            />
            <Since days={oldest.days} />
          </span>
        )
      }
      foot={
        // Plain: the maintenance screen reads no vehicle-status parameter, so no part has an exact
        // list (the headline's open visits do). The parts add up to the headline: «مكهنة» and «بلا
        // سيارة في السجل» (a car deleted since, or an old-book visit) only when they hold a visit.
        <span data-maint-status="true">
          {t('fleet.dash.now.statusActive')} {plain(workshop.openActive)}
          <Sep />
          {t('fleet.dash.now.statusOut')} {plain(workshop.openOutOfService)}
          {workshop.openDisposed > 0 && (
            <>
              <Sep />
              <span className="whitespace-nowrap">
                {t('fleet.dash.now.statusDisposed')} {plain(workshop.openDisposed)}
              </span>
            </>
          )}
          {workshop.openNoCar > 0 && (
            <>
              <Sep />
              <span className="whitespace-nowrap">
                {t('fleet.dash.now.statusNoCar')} {plain(workshop.openNoCar)}
              </span>
            </>
          )}
        </span>
      }
      footIcon={I.layers}
    />
  );
};

const DealerKpi = ({ rows, links }: { rows: number; links: NowLinks }): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  return (
    <Kpi
      id="dealer"
      data-maint-kpi="dealer"
      tone="violet"
      icon={I.receipt}
      title={w('dealer.title')}
      tag={
        <Tag tone="violet" dot>
          {w('dealer.tag')}
        </Tag>
      }
      figure={
        <>
          <Big link={links.dealershipPending()}>{count(rows)}</Big>
          <span className={WORDS}>{noun('row', rows)}</span>
        </>
      }
      sub={<span className={MUTED}>{w('dealer.sub')}</span>}
      foot={w('dealer.foot')}
      footIcon={I.info}
    />
  );
};

// ── 2 · «الآن»: «إنذارات الصيانة بالكيلومتر» ──────────────────────────────────────────────────

/** «2 أحمر · 6 أصفر» — the table's chip, each count in its level's colour. */
const LevelsChip = ({ red, yellow }: { red: number; yellow: number }): JSX.Element => {
  const w = useWords();
  return (
    <span
      data-maint-chip="alarms"
      className={cn(
        COUNT_CHIP,
        'border-slate-300 bg-white dark:border-[#223048] dark:bg-[#0a0e17]',
      )}
    >
      <Dot tone="red" />
      <span className={TONE.red.text}>
        <Phrase text={w('alarms.chipRed')} parts={{ count: <N>{count(red)}</N> }} />
      </span>
      <Sep />
      <Dot tone="amber" />
      <span className={TONE.amber.text}>
        <Phrase text={w('alarms.chipYellow')} parts={{ count: <N>{count(yellow)}</N> }} />
      </span>
    </span>
  );
};

/** The two thresholds, as the organization's settings set them (300 / 1,000 km by default). */
const AlarmLegend = ({ redKm, yellowKm }: { redKm: number; yellowKm: number }): JSX.Element => {
  const w = useWords();
  const km = (n: number): ReactNode => <N className={cn('font-bold', STRONG)}>{count(n)}</N>;
  return (
    <div
      data-maint-legend="alarms"
      className={cn('flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold', MUTED)}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-sm', TONE.red.bar)} />
        <Phrase text={w('alarms.legendRed')} parts={{ km: km(redKm) }} />
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-sm', TONE.amber.bar)} />
        <Phrase text={w('alarms.legendYellow')} parts={{ km: km(yellowKm) }} />
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Icon d={I.cog} className="h-3.5 w-3.5 text-slate-400" />
        {w('alarms.legendSettings')}
      </span>
    </div>
  );
};

const AlarmRow = ({
  row,
  links,
  can,
}: {
  row: NonNullable<FleetDashboardNowDto['maintenanceAlarm']>['rows'][number];
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const tone: Tone = row.level === 'red' ? 'red' : 'amber';
  const pct = Math.min(100, share(row.sinceServiceKm, row.intervalKm) ?? 0);
  return (
    <tr
      data-alarm-row={row.code}
      data-alarm-level={row.level}
      className={cn(A_ROW, 'max-lg:grid-cols-[minmax(0,1fr)_auto]')}
    >
      <td className={cn(CELL, A_CELL, 'max-lg:col-start-1 max-lg:row-start-1')}>
        <div className="flex flex-wrap items-center gap-2">
          <CarChip
            code={row.code}
            link={
              can('fleetVehicle.view')
                ? links.vehicle(row.vehicleId, 'maintenanceAlarm.vehicle')
                : null
            }
          />
          {row.inWorkshop !== null && (
            <span
              data-alarm-workshop={row.code}
              className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4 dark:font-semibold',
                TONE.slate.soft,
              )}
            >
              <Icon d={I.wrench} className="h-3 w-3" />
              {row.inWorkshop.workshop === null
                ? w('alarms.inWorkshopUnnamed')
                : w('alarms.inWorkshop', { workshop: localized(row.inWorkshop.workshop, locale) })}
            </span>
          )}
        </div>
        {row.typeName !== null && (
          <div className={cn('mt-1 whitespace-nowrap text-xs font-semibold', MUTED)}>
            {localized(row.typeName, locale)}
          </div>
        )}
      </td>
      <td className={cn(CELL, A_CELL, 'max-lg:col-span-2')}>
        <span data-alarm-figure={row.code} className={cn(COUNT_CHIP, 'py-0.5', TONE[tone].soft)}>
          <Dot tone={tone} />
          {row.remainingKm < 0 ? (
            // «متأخر N كم» — the alarms board's and the car record's own word for a car past its limit.
            <Phrase
              text={t('fleet.dashboard.overdueKm')}
              parts={{ km: <N>{count(-row.remainingKm)}</N> }}
            />
          ) : (
            <Phrase
              text={t('fleet.dashboard.remainingKm')}
              parts={{ km: <N>{count(row.remainingKm)}</N> }}
            />
          )}
        </span>
      </td>
      <td className={cn(CELL, A_CELL, 'max-lg:col-span-2')}>
        <div className="max-w-[300px]">
          <div
            data-alarm-since={row.code}
            className="whitespace-nowrap text-slate-600 dark:text-slate-300"
          >
            <Phrase
              text={w('alarms.sinceOf')}
              parts={{
                since: <N className={cn('font-bold', STRONG)}>{count(row.sinceServiceKm)}</N>,
                interval: <N className="font-semibold">{count(row.intervalKm)}</N>,
              }}
            />
          </div>
          <Meter className="mt-1.5" height="h-1.5" parts={[{ pct, tone }]} />
        </div>
      </td>
      <td className={cn(CELL, A_CELL, 'whitespace-nowrap max-lg:col-span-2')}>
        <PhoneLabel upTo="lg">{w('col.last')}</PhoneLabel>
        <N className="font-semibold text-slate-700 dark:text-slate-200">
          {row.lastServiceAt === null ? '—' : slashDay(row.lastServiceAt)}
        </N>
      </td>
      <td className={cn(CELL, A_CELL, 'text-end max-lg:col-start-2 max-lg:row-start-1')}>
        <Btn link={links.alarmRow(row.level, row.code)} className="h-9 px-4">
          {w('open')}
        </Btn>
      </td>
    </tr>
  );
};

const AlarmTable = ({
  alarm,
  links,
  can,
}: {
  alarm: NonNullable<FleetDashboardNowDto['maintenanceAlarm']>;
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const w = useWords();
  // The two counts the chip shows side by side, written once more on the foot's link.
  const total = alarm.red + alarm.yellow;
  const all = links.alarmsAll(alarm);
  const allWords = <Phrase text={w('alarms.all')} parts={{ count: <N>{count(total)}</N> }} />;
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-maint-block="alarms" className="mt-5">
      <BlockHead
        icon={I.bell}
        tone="red"
        title={w('alarms.title')}
        note={w('alarms.note')}
        chips={<LevelsChip red={alarm.red} yellow={alarm.yellow} />}
        end={<AlarmLegend redKm={alarm.redKm} yellowKm={alarm.yellowKm} />}
      />
      {alarm.rows.length === 0 ? (
        <EndRow text={w('alarms.empty')} marker="alarms" />
      ) : (
        <div className="lg:overflow-x-auto">
          <table className={cn('w-full border-collapse text-[13px] lg:min-w-[760px]', A_TABLE)}>
            <thead className={cn(TH_ROW, A_HEAD)}>
              <tr className={cn('border-y', RULE)}>
                <th className={cn(th, 'w-[28%]')}>{w('col.car')}</th>
                <th className={cn(th, 'w-[20%]')}>{w('col.alarm')}</th>
                <th className={th}>{w('col.since')}</th>
                <th className={cn(th, 'w-[14%]')}>{w('col.last')}</th>
                <th className={cn(CELL, 'w-px py-2.5')}>
                  <span className="sr-only">{w('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, A_BODY, 'max-lg:border-t', RULE)}>
              {alarm.rows.map((row) => (
                <AlarmRow key={row.vehicleId} row={row} links={links} can={can} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BlockFoot>
        {total > 0 &&
          (all === null ? (
            // Over the screens' 50-code cap under a branch: the count stands, unlinked.
            <span data-maint-alarms-all="plain" className="font-bold">
              {allWords}
            </span>
          ) : (
            <FootLink link={all}>
              <span>{allWords}</span>
            </FootLink>
          ))}
        <span className={FOOT_NOTE}>
          <Icon d={I.info} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {w('alarms.activeOnly')}
        </span>
      </BlockFoot>
    </Card>
  );
};

/** R1 on its way: its cards and the table in grey, never zeroes pretending to be data. */
const NowSkeleton = ({ cards, table }: { cards: number; table: boolean }): JSX.Element => (
  <div className="space-y-5">
    {cards > 0 && (
      <div className={cn('grid grid-cols-1 gap-4', KPI_GRID[Math.min(4, cards)])}>
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    )}
    {table && <Skeleton className="h-72 rounded-2xl" />}
  </div>
);

const NowBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  const { now, can, nowPending } = props;
  const alarmState = nowState(now, 'maintenanceAlarm', can);
  const workshopState = nowState(now, 'workshop', can);
  const dealerState = nowState(now, 'dealershipPending', can);
  const links = now === null ? null : nowLinks(now);
  // A section's figures only when this reader may see it (its state says so), never because the
  // read happened to carry them.
  const alarm = alarmState === 'shown' ? (now?.maintenanceAlarm ?? null) : null;
  const workshop = workshopState === 'shown' ? (now?.workshop ?? null) : null;
  const dealer = dealerState === 'shown' ? (now?.dealershipPending ?? null) : null;

  const cards: ReactNode[] = [];
  if (links !== null) {
    if (alarmState === 'failed') {
      cards.push(<SectionError key="alarm" section="maintenanceAlarm" onRetry={props.onRetry} />);
    } else if (alarm !== null) {
      cards.push(<AlarmKpis key="alarm" alarm={alarm} links={links} />);
    }
    if (workshopState === 'failed') {
      cards.push(<SectionError key="workshop" section="workshop" onRetry={props.onRetry} />);
    } else if (workshop !== null) {
      cards.push(<WorkshopKpi key="workshop" workshop={workshop} links={links} can={can} />);
    }
    if (dealerState === 'failed') {
      cards.push(<SectionError key="dealer" section="dealershipPending" onRetry={props.onRetry} />);
    } else if (dealer !== null) {
      cards.push(<DealerKpi key="dealer" rows={dealer.rows} links={links} />);
    }
  }
  // The cards a row holds (the alarm section draws two, or one error in their place).
  const width =
    (alarm !== null ? 2 : alarmState === 'failed' ? 1 : 0) +
    (workshopState === 'hidden' ? 0 : 1) +
    (dealerState === 'hidden' ? 0 : 1);
  const pendingCards =
    (sectionPermitted('maintenanceAlarm', can) ? 2 : 0) +
    (sectionPermitted('workshop', can) ? 1 : 0) +
    (sectionPermitted('dealershipPending', can) ? 1 : 0);

  return (
    <section data-maint-band="now" aria-label={w('now')}>
      <BandHead id="now" tone="emerald" first title={w('now')} chips={<LiveChip />} />
      <ReadBand
        state={nowPending?.state ?? 'ready'}
        error={nowPending?.error ?? null}
        onRetry={props.onRetry}
        skeleton={
          <NowSkeleton cards={pendingCards} table={sectionPermitted('maintenanceAlarm', can)} />
        }
      >
        {width > 0 && (
          <div
            data-maint-kpis="now"
            className={cn('grid grid-cols-1 gap-4', KPI_GRID[Math.min(4, width)])}
          >
            {cards}
          </div>
        )}
        {links !== null && alarm !== null && <AlarmTable alarm={alarm} links={links} can={can} />}
      </ReadBand>
    </section>
  );
};

// ── 3 · «خلال الفترة»: the two period cards ───────────────────────────────────────────────────

type Exits = NonNullable<FleetDashboardPeriodDto['exits']>;

const PeriodKpis = ({ exits, links }: { exits: Exits; links: PeriodLinks }): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const stay = exits.avgStayDays;
  return (
    <div data-maint-kpis="period" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Kpi
        id="exits"
        data-maint-kpi="exits"
        tone="emerald"
        icon={EXIT}
        title={w('exits.title')}
        tag={
          <Tag tone="emerald" dot>
            {w('exits.tag')}
          </Tag>
        }
        figure={
          <>
            <Big link={links.exits('exits.count')}>{count(exits.count)}</Big>
            <span className={WORDS}>{noun('visit', exits.count)}</span>
          </>
        }
        sub={<span className={MUTED}>{w('exits.sub')}</span>}
        foot={<FootLink link={links.exits('exits.count')}>{w('exits.link')}</FootLink>}
      />
      <Kpi
        id="stay"
        data-maint-kpi="stay"
        tone="sky"
        icon={I.clock}
        title={w('stay.title')}
        tag={
          <Tag tone="sky" dot>
            {w('stay.tag')}
          </Tag>
        }
        figure={
          // Plain: an average has no list of its own.
          <>
            <Big>{stay === null ? '—' : ONE_DECIMAL.format(stay)}</Big>
            {stay !== null && <span className={WORDS}>{w('stay.unit')}</span>}
          </>
        }
        sub={
          <span className={MUTED}>
            <Phrase
              text={w('stay.sub')}
              parts={{
                count: <N className={cn('font-bold', STRONG)}>{count(exits.count)}</N>,
                noun: noun('visit', exits.count),
              }}
            />
          </span>
        }
        foot={w('stay.foot')}
        footIcon={I.info}
      />
    </div>
  );
};

// ── 3 · The two bar lists ─────────────────────────────────────────────────────────────────────

/** Each bar against the longest; the share beside it is of the period's exits. */
const BarsCard = ({
  id,
  icon,
  tone,
  title,
  note,
  rows,
  exits,
  links,
}: {
  id: 'byWorkType' | 'byWorkshop';
  icon: IconPath;
  tone: Tone;
  title: string;
  note: string;
  rows: readonly FleetDashboardPeriodExitBarDto[];
  exits: Exits;
  links: PeriodLinks;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const unnamed = w('unnamed');
  const bars: HBarRow[] = rows.map((row) => ({
    key: row.id,
    name: nameOf(row.name, locale, unnamed),
    value: count(row.count),
    n: row.count,
    unit: noun('visit', row.count),
    extra: shareText(row.count, exits.count),
    link: links.exits(
      `exits.${id}`,
      id === 'byWorkType' ? { workTypes: [row.id] } : { workshops: [row.id] },
    ),
  }));
  return (
    <Card data-maint-block={id}>
      <BlockHead
        icon={icon}
        tone={tone}
        title={title}
        note={note}
        chips={
          <Fig
            link={links.exits('exits.count')}
            className={cn(COUNT_CHIP, TONE[tone].soft)}
            linkedClassName=""
          >
            <N>{count(exits.count)}</N> {noun('visit', exits.count)}
          </Fig>
        }
      />
      <div className="px-5 pb-5 pt-1">
        {exits.count === 0 ? <p className={NOTE}>{w('emptyExits')}</p> : <HBars rows={bars} />}
      </div>
    </Card>
  );
};

// ── 3 · The bottom pair ───────────────────────────────────────────────────────────────────────

/** The car and its make, the bottom tables' first column. */
const CarCell = ({
  code,
  typeName,
  link,
}: {
  code: string;
  typeName: LocalizedString | null;
  link: DashLink | null;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex flex-col items-start gap-1">
      <CarChip code={code} link={link} />
      {typeName !== null && (
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {localized(typeName, locale)}
        </span>
      )}
    </div>
  );
};

const TopVehicles = ({
  data,
  exits,
  links,
  can,
}: {
  data: FleetDashboardPeriodDto;
  exits: Exits;
  links: PeriodLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const scope = data.vehicleScope.scopeBranches;
  const note =
    scope === null ? 'top.note' : scope.length === 1 ? 'top.noteBranch' : 'top.noteBranches';
  const th = cn(PAIR_CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-maint-block="top">
      <BlockHead icon={I.rank} tone="sky" title={w('topVehicles')} note={w(note)} />
      {exits.count === 0 ? (
        <EndRow text={w('emptyExits')} marker="top" />
      ) : exits.topVehicles.length === 0 ? (
        // Only visits of the old book (no car in the registry) left: they are counted, never ranked.
        <EndRow text={w('top.none')} marker="top" />
      ) : (
        <table className={cn('w-full border-collapse text-[13px]', P_TABLE)}>
          <thead className={cn(TH_ROW, P_HEAD)}>
            <tr className={cn('border-y', RULE)}>
              <th className={cn(PAIR_CELL, TH, 'w-px py-2.5 text-center')}>#</th>
              <th className={th}>{w('col.car')}</th>
              <th className={th}>{w('col.visits')}</th>
              <th className={th}>{w('col.lastIn')}</th>
              <th className={th}>{w('col.lastWorkType')}</th>
              <th className={cn(PAIR_CELL, 'w-px py-2.5')}>
                <span className="sr-only">{w('open')}</span>
              </th>
            </tr>
          </thead>
          <tbody className={cn(DIVIDE, P_BODY, 'max-md:border-t', RULE)}>
            {exits.topVehicles.map((row, i) => {
              const link = links.exits('exits.topVehicle', { vehicleCodes: [row.code] });
              return (
                <tr
                  key={row.vehicleId ?? row.code}
                  data-top-vehicle={row.code}
                  className={cn(P_ROW, 'max-md:grid-cols-[auto_minmax(0,1fr)_auto]')}
                >
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'text-center max-md:col-start-1 max-md:row-start-1',
                    )}
                  >
                    {/* The rank is the row's place in the server's order: slate, no red. */}
                    <span
                      className={cn(
                        'inline-grid h-6 w-6 place-items-center rounded-full border text-xs font-bold',
                        TONE.slate.soft,
                        NUM,
                      )}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className={cn(PAIR_CELL, P_CELL, 'max-md:col-start-2 max-md:row-start-1')}>
                    <CarCell
                      code={row.code}
                      typeName={row.typeName}
                      link={
                        row.vehicleId !== null && can('fleetVehicle.view')
                          ? links.vehicle(row.vehicleId, 'exits.vehicle')
                          : null
                      }
                    />
                  </td>
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'whitespace-nowrap max-md:col-span-2 max-md:col-start-2',
                    )}
                  >
                    <Fig link={link} className={cn('font-bold', STRONG)}>
                      <N>{count(row.visits)}</N>
                    </Fig>{' '}
                    <span className={MUTED}>{noun('visit', row.visits)}</span>
                  </td>
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'whitespace-nowrap max-md:col-span-2 max-md:col-start-2',
                    )}
                  >
                    <PhoneLabel>{w('col.lastIn')}</PhoneLabel>
                    <N className="font-semibold text-slate-700 dark:text-slate-200">
                      {slashDay(row.lastInDate)}
                    </N>
                  </td>
                  <td className={cn(PAIR_CELL, P_CELL, 'max-md:col-span-2 max-md:col-start-2')}>
                    <span className={WORK_CHIP}>
                      {nameOf(row.lastWorkType, locale, w('unnamed'))}
                    </span>
                  </td>
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'text-end max-md:col-start-3 max-md:row-start-1',
                    )}
                  >
                    <Btn link={link} className="h-9 px-4">
                      {w('open')}
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {exits.count > 0 && (
        <BlockFoot>
          <FootLink link={links.exits('exits.count')}>
            <span>
              <Phrase text={w('top.all')} parts={{ count: <N>{count(exits.count)}</N> }} />
            </span>
          </FootLink>
        </BlockFoot>
      )}
    </Card>
  );
};

const LongestStays = ({
  now,
  workshop,
  links,
  can,
}: {
  now: FleetDashboardNowDto;
  workshop: NonNullable<FleetDashboardNowDto['workshop']>;
  links: NowLinks;
  can: (permission: string) => boolean;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const unnamed = w('unnamed');
  const scope = now.scopeBranches;
  const end =
    scope === null
      ? 'longest.end'
      : scope.length === 1
        ? 'longest.endBranch'
        : 'longest.endBranches';
  const th = cn(PAIR_CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-maint-block="longest">
      <BlockHead
        icon={I.clock}
        tone="amber"
        title={w('longest.title')}
        note={w('longest.note')}
        chips={
          <>
            <NowChip />
            <span data-maint-chip="longest" className={cn(COUNT_CHIP, TONE.amber.soft)}>
              <N>{count(workshop.open)}</N>{' '}
              {t('fleet.dash.now.workshopUnit', { noun: noun('car', workshop.open) })}
            </span>
          </>
        }
      />
      {workshop.open === 0 ? (
        <EndRow text={w('workshop.none')} marker="longest" />
      ) : (
        <>
          <table className={cn('w-full border-collapse text-[13px]', P_TABLE)}>
            <thead className={cn(TH_ROW, P_HEAD)}>
              <tr className={cn('border-y', RULE)}>
                <th className={th}>{w('col.car')}</th>
                <th className={th}>{w('col.workshop')}</th>
                <th className={th}>{w('col.workType')}</th>
                <th className={th}>{w('col.inWorkshop')}</th>
                <th className={cn(PAIR_CELL, 'w-px py-2.5')}>
                  <span className="sr-only">{w('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, P_BODY, 'max-md:border-t', RULE)}>
              {workshop.longest.map((row) => (
                <tr
                  key={row.visitId}
                  data-longest-row={row.code}
                  data-longest-days={row.days}
                  className={cn(P_ROW, 'max-md:grid-cols-[minmax(0,1fr)_auto]')}
                >
                  <td className={cn(PAIR_CELL, P_CELL, 'max-md:col-start-1 max-md:row-start-1')}>
                    <CarCell
                      code={row.code}
                      typeName={row.typeName}
                      link={
                        row.vehicleId !== null && !row.deleted && can('fleetVehicle.view')
                          ? links.vehicle(row.vehicleId, 'workshop.vehicle')
                          : null
                      }
                    />
                  </td>
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'whitespace-nowrap font-bold max-md:col-span-2',
                      STRONG,
                    )}
                  >
                    {nameOf(row.workshop, locale, unnamed)}
                  </td>
                  <td className={cn(PAIR_CELL, P_CELL, 'max-md:col-span-2')}>
                    <span className={WORK_CHIP}>{nameOf(row.workType, locale, unnamed)}</span>
                  </td>
                  <td className={cn(PAIR_CELL, P_CELL, 'max-md:col-span-2')}>
                    <Since days={row.days} />
                  </td>
                  <td
                    className={cn(
                      PAIR_CELL,
                      P_CELL,
                      'text-end max-md:col-start-2 max-md:row-start-1',
                    )}
                  >
                    {/* A car deleted since it checked in: no live car carries its code, so the
                        open list (where its visit is still listed) instead of an empty one. */}
                    <Btn
                      link={
                        row.deleted
                          ? links.workshopOpen('workshop.longest')
                          : links.workshopCar(row.code)
                      }
                      className="h-9 px-4"
                    >
                      {w('open')}
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Every open visit is listed: the list ends on what it leaves out, not on blank space. */}
          {workshop.open <= workshop.longest.length && <EndRow text={w(end)} marker="longest" />}
        </>
      )}
      {workshop.open > 0 && (
        <BlockFoot>
          <FootLink link={links.workshopOpen('workshop.all')}>
            <span>
              <Phrase text={w('longest.all')} parts={{ count: <N>{count(workshop.open)}</N> }} />
            </span>
          </FootLink>
        </BlockFoot>
      )}
    </Card>
  );
};

/** «أطول بقاء في الورشة الآن» is R1's: its own face while R1 is on its way or failed. */
const LongestPlace = ({ props }: { props: MixedTabProps }): JSX.Element | null => {
  const { now, can, nowPending } = props;
  if (!sectionPermitted('workshop', can)) return null;
  if (nowPending?.state === 'loading') {
    return (
      <div data-dash-loading="true" data-maint-loading="longest">
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (nowPending?.state === 'error') {
    return <SectionError section="workshop" onRetry={props.onRetry} />;
  }
  const state = nowState(now, 'workshop', can);
  if (state === 'failed') return <SectionError section="workshop" onRetry={props.onRetry} />;
  if (state !== 'shown' || now === null || now.workshop === null) return null;
  return <LongestStays now={now} workshop={now.workshop} links={nowLinks(now)} can={can} />;
};

/** The period's figures on their way: their two cards and the two bar lists in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  </div>
);

const PeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  const failed = data !== undefined && data.unavailable.includes('exits');
  const exits = data === undefined || failed ? null : data.exits;
  const links = data === undefined ? null : periodLinks(data);
  const top =
    data !== undefined && exits !== null && links !== null ? (
      <TopVehicles data={data} exits={exits} links={links} can={can} />
    ) : state === 'loading' ? (
      <div data-dash-loading="true" data-maint-loading="top">
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    ) : null;
  const longest = <LongestPlace props={props} />;
  const unregistered = exits?.unregistered ?? null;
  return (
    <section data-maint-band="period" aria-label={w('period')} className="mt-8">
      <BandHead
        id="period"
        tone="sky"
        title={w('period')}
        chips={data === undefined ? undefined : <RangeChip range={data.range} />}
        sub={w('periodSub')}
      />
      {/* The dashboard's own period bar, right under the band's head and above what it moves: the
          page's ONE filter state (the period tabs share it), written to the address bar. */}
      <PeriodFilterBar
        filters={period.filters}
        onFilters={period.onFilters}
        data={data}
        can={can}
      />
      <ReadBand state={state} onRetry={period.onRetry} skeleton={<PeriodSkeleton />}>
        {failed ? (
          <SectionError section="exits" onRetry={period.onRetry} />
        ) : exits === null || links === null ? null : (
          <>
            <PeriodKpis exits={exits} links={links} />
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <BarsCard
                id="byWorkType"
                icon={I.layers}
                tone="sky"
                title={w('byWorkType')}
                note={w('byWorkTypeNote')}
                rows={exits.byWorkType}
                exits={exits}
                links={links}
              />
              <BarsCard
                id="byWorkshop"
                icon={I.building}
                tone="teal"
                title={w('byWorkshop')}
                note={w('byWorkshopNote')}
                rows={exits.byWorkshop}
                exits={exits}
                links={links}
              />
            </div>
          </>
        )}
      </ReadBand>
      <div
        data-maint-bottom="true"
        className={cn(
          'mt-5 grid grid-cols-1 gap-5',
          top !== null && sectionPermitted('workshop', can) && 'min-[1440px]:grid-cols-2',
        )}
      >
        {top}
        {longest}
      </div>
      <div className="mt-4 space-y-1.5 px-1">
        {unregistered !== null && unregistered > 0 && (
          <NoteLine>
            <span data-maint-unregistered="true">
              <Phrase
                text={w('exitsUnregistered')}
                parts={{ count: <N className="font-bold">{count(unregistered)}</N> }}
              />
            </span>
          </NoteLine>
        )}
        <NoteLine>
          <span data-no-money="true">{w('noMoney')}</span>
        </NoteLine>
      </div>
    </section>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const MaintenanceTab = (props: MixedTabProps): JSX.Element => {
  const w = useWords();
  const { can } = props;
  const alarmOk = sectionPermitted('maintenanceAlarm', can);
  const workshopOk = sectionPermitted('workshop', can);
  const dealerOk = sectionPermitted('dealershipPending', can);
  // The period band is drawn for a reader of R2's exits (the same key as the workshop's).
  const periodOk = props.period.enabled && sectionPermitted('exits', can);
  const parts = [
    ...(alarmOk ? [w('sub.alarms')] : []),
    ...(workshopOk ? [w('sub.workshop')] : []),
    ...(periodOk ? [w('sub.period')] : []),
    ...(dealerOk ? [w('sub.dealer')] : []),
  ];
  return (
    <div data-dash-tab-body="maintenance">
      <Heading props={props} parts={parts} />
      {(alarmOk || workshopOk || dealerOk) && <NowBand props={props} />}
      {periodOk && <PeriodBand props={props} />}
    </div>
  );
};
