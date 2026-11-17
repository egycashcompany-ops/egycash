// «التراخيص والتجديدات» — the «الآن» band (approved/lic-dark.png and lic-branch-dark.png; harness
// zz-licences-tab.tsx `NowBand`; DECISIONS §11, the critic's A2/A4/A5/B4/B5/B6/C6), over R1's
// `licenceVehicles`, `licenceDrivers` and `papers`:
//
//   · six KPIs, a cars row over a drivers row (six in one row from 1800 px), each under its own
//     section: «تراخيص سيارات منتهية» red (≤ 3 car chips, «و N أخرى», «· وخارج الخدمة N» only when
//     there are some) · «تراخيص تنتهي خلال {W}» amber («ومن {W+1} إلى 60 يومًا», hidden when W ≥ 60;
//     W is the section's own `warnDays`, through the counted noun) · «أوراق لم تُستلم بعد» violet (the
//     board's two papers, each opening the board on its open papers — no total) · «رخص سائقين
//     منتهية» red (the files' names) · «رخص تنتهي خلال {W}» amber · «بيانات رخص ناقصة» amber («رخصة
//     غير مسجّلة» linked as «الحركة اليوم» writes it, «بلا ملف سائق» plain: no list holds them);
//   · the fuel-card pointer (only for a reader of the fuel tab's card expiry) and, under a branch,
//     the drivers' branch rule;
//   · the 12-month chart (tab-licences-chart.tsx) and the two full-width tables
//     (tab-licences-tables.tsx).
//
// The cars follow the car's branch, the drivers their HR branch: the server narrows, and the links
// carry the figures' branch. NOTHING IS COUNTED HERE: every figure is a field R1 sent; «و N أخرى» is
// the server's count less the chips drawn.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FLEET_LICENCE_GREY_DAYS, type FleetDashboardNowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { sectionPermitted } from '../../lib/fleet-dashboard-tabs';
import { useFleetPeopleMap } from '../EmployeeName';
import {
  Card,
  CarChip,
  FOCUS,
  Fig,
  FootLink,
  I,
  Icon,
  IconTile,
  LiveChip,
  MUTED,
  N,
  RED,
  STRONG,
  TITLE,
  TONE,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { Phrase, SectionError, count, useNoun, type MixedTabProps } from './dash-shell';
import { BandHead, Big, NoteLine, ReadBand, WORDS } from './dash-blocks';
import { LicenceMonthChart } from './tab-licences-chart';
import { CarLicencesTable, DriverLicencesTable } from './tab-licences-tables';
import {
  DayPhrase,
  FOOT,
  LICENCE_NOW_SECTIONS,
  narrowedView,
  nowView,
  useCountedText,
  useLicenceWords,
  type LicenceNowSection,
  type SectionView,
} from './tab-licences-words';

type Vehicles = NonNullable<FleetDashboardNowDto['licenceVehicles']>;
type Drivers = NonNullable<FleetDashboardNowDto['licenceDrivers']>;
type Papers = NonNullable<FleetDashboardNowDto['papers']>;

/** The car chips a red card names before «و N أخرى». */
const CAR_CHIPS = 3;
/** The driver names a red card names before «و N أخرى» (plan D14). A name is wider than a chip and
 *  the line under the figure is one line tall: in a narrow card the names end in «…», and «و N أخرى»
 *  always stays whole after them. */
const DRIVER_NAMES = 3;

// ── 1 · The card ──────────────────────────────────────────────────────────────────────────────

/**
 * A «الآن» card (the approved Kpi look): the edge, the dot title, the icon tile, the hero (the one
 * figure that opens its list), the line under it, the grey band at its foot. Six in one row leave a
 * long title two lines beside its tile, so every head of the row is two lines tall then and the
 * figures stand level.
 */
const NowKpi = ({
  id,
  tone,
  icon,
  title,
  figure,
  sub,
  foot,
  footIcon = I.info,
}: {
  id: string;
  tone: Tone;
  icon: IconPath;
  title: ReactNode;
  figure: ReactNode;
  sub?: ReactNode;
  foot: ReactNode;
  footIcon?: IconPath;
}): JSX.Element => (
  <Card accent={tone} data-lic-kpi={id} data-lic-tone={tone}>
    <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
      <div className="flex items-start justify-between gap-3 min-[1800px]:min-h-[52px]">
        <h3 className={cn(TITLE, 'flex items-start gap-2 pt-1')}>
          <span className="mt-2 flex">
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', TONE[tone].dot)}
            />
          </span>
          <span className="whitespace-nowrap">{title}</span>
        </h3>
        <IconTile d={icon} tone={tone} />
      </div>
      <div className="mt-3 flex h-10 items-end gap-x-2 pb-0.5">{figure}</div>
      <div
        data-lic-sub={id}
        className={cn('mt-3 flex h-6 items-center whitespace-nowrap text-[13px] leading-6', MUTED)}
      >
        {sub}
      </div>
    </div>
    <div data-lic-foot={id} className={cn(FOOT, 'sm:min-h-[66px]')}>
      <Icon d={footIcon} className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 [text-wrap:pretty]">{foot}</span>
    </div>
  </Card>
);

/** A long KPI title: one line, but two (at its words' natural break) when six cards share a row. */
const TwoLine = ({ first, second }: { first: string; second: string }): JSX.Element => (
  <span>
    {first} <span className="min-[1800px]:block">{second}</span>
  </span>
);

/** The big count and its counted noun. */
const Figure = ({
  n,
  noun,
  link,
}: {
  n: number;
  noun: 'car' | 'driver';
  link: DashLink;
}): JSX.Element => {
  const say = useNoun();
  return (
    <>
      <Big link={link}>{count(n)}</Big>
      <span className={WORDS}>{say(noun, n)}</span>
    </>
  );
};

/** «و N أخرى» — the server's count less the names already drawn. */
const AndMore = ({ n }: { n: number }): JSX.Element | null => {
  const w = useLicenceWords();
  if (n <= 0) return null;
  return (
    <span data-lic-and-more={String(n)} className="shrink-0">
      <Phrase text={w('andMore')} parts={{ count: <N>{count(n)}</N> }} />
    </span>
  );
};

/**
 * «ومن 31 إلى 60 يومًا: 4 ←» — the grey window after the warning days (critic B4: never read as a
 * running total), opening its exact days. Not drawn when the warning days reach 60 (the builder
 * gives no link: the window is empty).
 */
const SoonLine = ({
  id,
  warnDays,
  n,
  link,
}: {
  id: 'cars' | 'drivers';
  warnDays: number;
  n: number;
  link: DashLink | null;
}): JSX.Element | null => {
  const w = useLicenceWords();
  if (warnDays >= FLEET_LICENCE_GREY_DAYS || link === null) return null;
  return (
    <Link
      to={link.to}
      data-metric={link.metric}
      data-lic-soon={id}
      data-lic-n={String(n)}
      className={cn('inline-flex items-center gap-1 hover:underline', MUTED, FOCUS)}
    >
      <span>
        <Phrase
          text={w('kpi.soon')}
          parts={{
            from: <N>{count(warnDays + 1)}</N>,
            to: <N>{count(FLEET_LICENCE_GREY_DAYS)}</N>,
          }}
        />
      </span>
      <N className={cn('font-bold', STRONG)}>{count(n)}</N>
      <Icon d={I.arrow} className="h-3.5 w-3.5" />
    </Link>
  );
};

/** «مدة التنبيه من «إعدادات الحركة»، وحدّ 60 يومًا ثابت» — the window's two sources. */
const WarnFoot = (): JSX.Element => {
  const w = useLicenceWords();
  return (
    <Phrase
      text={w('kpi.warnFoot')}
      parts={{
        limit: (
          <span className="whitespace-nowrap">
            <Phrase
              text={w('kpi.warnLimit')}
              parts={{ days: <N>{count(FLEET_LICENCE_GREY_DAYS)}</N> }}
            />
          </span>
        ),
      }}
    />
  );
};

/** A word and its figure in a two-figure card (no total: the rows are not one list). */
const Pair = ({
  id,
  word,
  n,
  link,
}: {
  id: string;
  word: string;
  n: number;
  link: DashLink | null;
}): JSX.Element => (
  <span data-lic-pair={id} data-lic-n={String(n)} className="inline-flex items-end gap-1.5">
    <span className={cn(WORDS, 'pb-1')}>{word}</span>
    <Big link={link} className={n === 0 ? '!text-slate-400 dark:!text-slate-500' : undefined}>
      {count(n)}
    </Big>
  </span>
);

const PairSep = (): JSX.Element => (
  <span aria-hidden="true" className="mx-2 mb-1 h-7 w-px self-end bg-slate-200 dark:bg-slate-700" />
);

// ── 2 · The cars ──────────────────────────────────────────────────────────────────────────────

const CarKpis = ({ lic, links }: { lic: Vehicles; links: NowLinks }): JSX.Element => {
  const w = useLicenceWords();
  const within = useCountedText();
  // The expired rows lead the list (the longest-expired first): the first few are named.
  const named = lic.list.filter((row) => row.days <= 0).slice(0, Math.min(CAR_CHIPS, lic.expired));
  const one = lic.expired === 1 ? named[0] : undefined;
  return (
    <>
      <NowKpi
        id="carsExpired"
        tone="red"
        icon={I.doc}
        title={w('kpi.carsExpired.title')}
        figure={<Figure n={lic.expired} noun="car" link={links.vehicleLicencesExpired()} />}
        sub={
          named.length === 0 ? undefined : (
            <span className="flex items-center gap-1.5">
              {named.map((row) => (
                <span key={row.vehicleId} data-lic-expired-car={row.code}>
                  <CarChip
                    code={row.code}
                    link={links.vehicle(row.vehicleId, 'licenceVehicles.expiredCar')}
                  />
                </span>
              ))}
              {one !== undefined && (
                <span className={cn('font-bold', RED)}>
                  <DayPhrase days={one.days} />
                </span>
              )}
              <AndMore n={lic.expired - named.length} />
            </span>
          )
        }
        foot={
          <>
            {w('kpi.carsExpired.foot')}
            {lic.outOfServiceExpired > 0 && (
              <span data-lic-out-of-service={String(lic.outOfServiceExpired)}>
                {' '}
                <Phrase
                  text={w('kpi.outOfService')}
                  parts={{ count: <N>{count(lic.outOfServiceExpired)}</N> }}
                />
              </span>
            )}
          </>
        }
      />
      <NowKpi
        id="carsExpiring"
        tone="amber"
        icon={I.calendar}
        title={
          <TwoLine
            first={w('kpi.carsExpiring.first')}
            second={w('kpi.within', { days: within('day', lic.warnDays) })}
          />
        }
        figure={
          <Figure n={lic.expiring} noun="car" link={links.vehicleLicencesExpiring(lic.warnDays)} />
        }
        sub={
          <SoonLine
            id="cars"
            warnDays={lic.warnDays}
            n={lic.soon}
            link={links.vehicleLicencesSoon(lic.warnDays)}
          />
        }
        footIcon={I.cog}
        foot={<WarnFoot />}
      />
    </>
  );
};

// ── 3 · The papers ────────────────────────────────────────────────────────────────────────────

/** «أوراق لم تُستلم بعد» — the board's two papers, each opening the board on its OPEN papers. */
const PapersKpi = ({ papers, links }: { papers: Papers; links: NowLinks }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  return (
    <NowKpi
      id="papers"
      tone="violet"
      icon={I.clipboard}
      title={w('kpi.papers.title')}
      figure={
        <>
          <Pair
            id="insurance"
            word={t('fleet.licensing.columns.insurance')}
            n={papers.insurance}
            link={links.papersOpen('insurance')}
          />
          <PairSep />
          <Pair
            id="tax"
            word={t('fleet.licensing.columns.tax')}
            n={papers.tax}
            link={links.papersOpen('tax')}
          />
        </>
      }
      sub={w('kpi.papers.sub')}
      foot={w('kpi.papers.note')}
    />
  );
};

// ── 4 · The drivers ───────────────────────────────────────────────────────────────────────────

const DriverKpis = ({ lic, links }: { lic: Drivers; links: NowLinks }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  const within = useCountedText();
  const names = useFleetPeopleMap();
  // The list's comma in the reader's language (the names themselves are the HR names).
  const comma = useAppSelector((state): Locale => state.locale.locale) === 'ar' ? '، ' : ', ';
  const named = lic.list.rows
    .filter((row) => row.days <= 0)
    .slice(0, Math.min(DRIVER_NAMES, lic.expired));
  const one = lic.expired === 1 ? named[0] : undefined;
  return (
    <>
      <NowKpi
        id="driversExpired"
        tone="red"
        icon={I.userX}
        title={w('kpi.driversExpired.title')}
        figure={<Figure n={lic.expired} noun="driver" link={links.driverLicencesExpired()} />}
        sub={
          named.length === 0 ? undefined : (
            <span className="flex min-w-0 items-center gap-1.5">
              {/* The names give way first («…»); the day and «و N أخرى» stay whole. */}
              <span
                data-lic-expired-names="true"
                title={named.map((row) => names.get(row.employeeId)?.fullNameAr ?? '—').join(comma)}
                className="min-w-0 truncate"
              >
                {named.map((row, i) => (
                  <span key={row.profileId} data-lic-expired-driver={row.profileId}>
                    {i > 0 && comma}
                    <Fig
                      link={links.driver(row.profileId, 'licenceDrivers.expiredDriver')}
                      className={cn('font-bold', STRONG)}
                    >
                      {names.get(row.employeeId)?.fullNameAr ?? '—'}
                    </Fig>
                  </span>
                ))}
              </span>
              {one !== undefined && (
                <span className={cn('shrink-0 font-bold', RED)}>
                  <DayPhrase days={one.days} />
                </span>
              )}
              <AndMore n={lic.expired - named.length} />
            </span>
          )
        }
        foot={w('kpi.driversExpired.foot')}
      />
      <NowKpi
        id="driversExpiring"
        tone="amber"
        icon={I.user}
        title={
          <TwoLine
            first={w('kpi.driversExpiring.first')}
            second={w('kpi.within', { days: within('day', lic.warnDays) })}
          />
        }
        figure={
          <Figure
            n={lic.expiring}
            noun="driver"
            link={links.driverLicencesExpiring(lic.warnDays)}
          />
        }
        sub={
          <SoonLine
            id="drivers"
            warnDays={lic.warnDays}
            n={lic.soon}
            link={links.driverLicencesSoon(lic.warnDays)}
          />
        }
        footIcon={I.cog}
        foot={<WarnFoot />}
      />
      <NowKpi
        id="missing"
        tone="amber"
        icon={I.warn}
        title={w('kpi.missing.title')}
        figure={
          // A label then its figure, as «الحركة اليوم» writes it («رخصة غير مسجّلة 3»; critic B5).
          <Pair
            id="notRecorded"
            word={t('fleet.dash.now.licenceNotRecorded')}
            n={lic.notRecorded}
            link={links.driverLicencesNotRecorded()}
          />
        }
        sub={
          // No list holds the seats with no driver file: a plain figure.
          <span data-lic-unregistered={String(lic.unregistered)}>
            <Phrase
              text={w('kpi.missing.noFile')}
              parts={{
                count: (
                  <N
                    className={cn(
                      'font-bold',
                      lic.unregistered === 0 ? 'text-slate-400 dark:text-slate-500' : STRONG,
                    )}
                  >
                    {count(lic.unregistered)}
                  </N>
                ),
              }}
            />
          </span>
        }
        foot={w('kpi.missing.foot')}
      />
    </>
  );
};

// ── 5 · The notes under the cards ─────────────────────────────────────────────────────────────

/** The fuel-card pointer (Q1 told; only for a reader of the fuel tab's card expiry) and, while the
 *  figures are narrowed, the drivers' branch rule (they follow their HR branch, not the car's). */
const NowNotes = ({
  fuelTab,
  hrBranch,
}: {
  fuelTab: DashLink | null;
  hrBranch: boolean;
}): JSX.Element | null => {
  const t = useT();
  const w = useLicenceWords();
  if (fuelTab === null && !hrBranch) return null;
  return (
    <div data-lic-notes="now" className="mt-3 flex flex-col gap-1.5 px-1">
      {fuelTab !== null && (
        <div data-lic-note="fuel" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <NoteLine>{w('fuelLine')}</NoteLine>
          <FootLink link={fuelTab}>{t('fleet.dash.shell.tab.fuel')}</FootLink>
        </div>
      )}
      {hrBranch && (
        <div data-lic-note="hr-branch">
          <NoteLine>{w('hrBranchNote')}</NoteLine>
        </div>
      )}
    </div>
  );
};

// ── The band ──────────────────────────────────────────────────────────────────────────────────

/**
 * The six cards as the approved rows (DECISIONS §11, told with the sample): the cars' row
 * (منتهية · تنتهي · أوراق) over the drivers' row (منتهية · تنتهي · بيانات ناقصة), each its own grid
 * so a reader without one of a row's sections never pulls a driver card up beside the cars. Three a
 * row from 1024 px, the two rows side by side (six in a line) from 1800 px; from 640 px two a row,
 * a row's odd last card the full width (a third card would cut its title short on a tablet).
 */
const KPI_ROWS = 'grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2';
const KPI_ROW = cn(
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
  'sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1',
);

/** R1 on its way: the six cards in grey, never zeroes pretending to be data. */
const NowSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className={KPI_ROWS}>
      {[0, 1].map((row) => (
        <div key={row} className={KPI_ROW}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ))}
    </div>
    <Skeleton className="h-96 rounded-2xl" />
  </div>
);

/** A section's figures only when this reader may see them (the view says so). */
const shown = <T,>(view: SectionView, value: T | null | undefined): T | null =>
  view === 'shown' ? (value ?? null) : null;

export const LicencesNowBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useLicenceWords();
  const { now, can, nowPending } = props;
  const views = Object.fromEntries(
    LICENCE_NOW_SECTIONS.map((section) => [section, nowView(now, can, section)]),
  ) as Record<LicenceNowSection, SectionView>;
  const vehicles = shown(views.licenceVehicles, now?.licenceVehicles);
  const drivers = shown(views.licenceDrivers, now?.licenceDrivers);
  const papers = shown(views.papers, now?.papers);
  const links = now === null ? null : nowLinks(now);
  const failed = LICENCE_NOW_SECTIONS.filter((section) => views[section] === 'failed');
  return (
    <section data-lic-band="now" aria-label={w('now')}>
      <BandHead id="now" tone="emerald" first title={w('now')} chips={<LiveChip />} />
      <ReadBand
        state={nowPending?.state ?? 'ready'}
        error={nowPending?.error ?? null}
        onRetry={props.onRetry}
        skeleton={<NowSkeleton />}
      >
        {failed.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {failed.map((section) => (
              <SectionError key={section} section={section} onRetry={props.onRetry} />
            ))}
          </div>
        )}
        {links !== null && (vehicles !== null || papers !== null || drivers !== null) && (
          <div data-lic-kpis="now" className={KPI_ROWS}>
            {(vehicles !== null || papers !== null) && (
              <div data-lic-kpi-row="cars" className={KPI_ROW}>
                {vehicles !== null && <CarKpis lic={vehicles} links={links} />}
                {papers !== null && <PapersKpi papers={papers} links={links} />}
              </div>
            )}
            {drivers !== null && (
              <div data-lic-kpi-row="drivers" className={KPI_ROW}>
                <DriverKpis lic={drivers} links={links} />
              </div>
            )}
          </div>
        )}
        <NowNotes
          // The cards' expiry is the fuel tab's `fuelCards` KPI: pointed to only for its reader
          // (critic C6) — a receipts- or dealership-only fuel tab has no such card.
          fuelTab={
            sectionPermitted('fuelCards', can) ? props.tabLink('fuel', 'fuelCards.tab') : null
          }
          hrBranch={drivers !== null && narrowedView(props)}
        />
        {links !== null && (vehicles !== null || drivers !== null) && now !== null && (
          <LicenceMonthChart
            today={now.today}
            cars={vehicles?.months ?? null}
            drivers={drivers?.months ?? null}
            links={links}
          />
        )}
        {links !== null && vehicles !== null && (
          <CarLicencesTable lic={vehicles} links={links} papers={sectionPermitted('papers', can)} />
        )}
        {links !== null && drivers !== null && <DriverLicencesTable lic={drivers} links={links} />}
      </ReadBand>
    </section>
  );
};
