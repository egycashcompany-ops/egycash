// Tab 4 «التراخيص وآخر ما سُجّل» — the approved v2 sample (zz-fleetdash-v2-licences.tsx) over R1's
// `licenceVehicles`, `licenceDrivers`, `papers`, `fuelCards`, `recentWorkshop` and `recentAccidents`
// (T4.1–T4.9, R-02, R-10…R-12).
//
// The licence buckets are disjoint windows (`licenceWindows`): expired = on or before today (Q-02),
// then today+1 … today+W, then … today+60, each linked to its exact window. «آخر ما سُجّل» is the
// last 30 Cairo days, newest written first; an ACCIDENT row shows its date only — no time at all —
// and keeps the driver card on a culprit who is one of ours.
import { useState, type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_RECENT_DAYS,
  FLEET_LICENCE_GREY_DAYS,
  type FleetDashboardNowDto,
  type FleetDashboardRecentAccidentDto,
  type FleetDashboardRecentVisitDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { cairoTime, share, slashDay } from '../../lib/fleet-dashboard-tabs';
import { DriverHoverText } from '../DriverHoverCard';
import { useEmployeeRecords } from '../EmployeeName';
import { VehicleHoverCode } from '../VehicleHoverCard';
import {
  AMBER,
  BAND,
  BOX,
  BOX_HOVER,
  CAIRO,
  CHIP,
  Card,
  CardHead,
  CarChip,
  CompanyWide,
  FOCUS,
  Fig,
  FootLink,
  I,
  Icon,
  MUTED,
  N,
  NOTE,
  NUM,
  RED,
  RULE,
  SEG,
  STRONG,
  TONE,
  TabHead,
  cn,
  type IconPath,
} from './dash-kit';
import { Phrase, RefreshTools, SectionError, count, useNoun, type NowTabProps } from './dash-shell';

type Age = 'red' | 'amber' | 'grey';

const PILL: Record<Age, string> = {
  red: TONE.red.soft,
  amber: TONE.amber.soft,
  grey: TONE.slate.soft,
};
const PILL_DOT: Record<Age, string> = {
  red: TONE.red.dot,
  amber: TONE.amber.dot,
  grey: TONE.slate.dot,
};
const PILL_HOVER: Record<Age, string> = {
  red: 'hover:border-red-400 hover:bg-red-100 dark:hover:border-red-500/60 dark:hover:bg-red-500/20',
  amber:
    'hover:border-amber-400 hover:bg-amber-100 dark:hover:border-amber-500/50 dark:hover:bg-amber-500/20',
  grey: 'hover:border-slate-400 hover:bg-slate-200/80 dark:hover:border-slate-600 dark:hover:bg-slate-800',
};
const PILL_SHAPE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-bold dark:font-semibold';
const STATE = cn(PILL_SHAPE, 'h-[22px] px-2 text-[11px] leading-4');
const BAR: Record<Age, string> = { red: TONE.red.bar, amber: TONE.amber.bar, grey: TONE.slate.dot };
const HEAD_WRAP = 'flex-wrap gap-y-2.5 [&>div:first-child]:shrink-0';
const ROW = cn(
  'relative -mx-2 flex items-center gap-3 rounded-lg px-2',
  "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-slate-100 before:content-[''] first:before:hidden dark:before:bg-[#1c273b]",
);

/** A card of this tab: head, body, the note under it, and the foot band with its links. */
const Panel = ({
  data,
  head,
  children,
  note,
  links,
}: {
  data: string;
  head: ReactNode;
  children: ReactNode;
  note: ReactNode;
  links: readonly { link: DashLink; label: string }[];
}): JSX.Element => (
  <Card data-licences-card={data}>
    <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
      {head}
      {children}
      <p className={cn(NOTE, 'flex items-start gap-2 pt-4 leading-6')}>
        <Icon
          d={I.info}
          className="mt-[5px] h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
        />
        <span className="min-w-0 text-pretty">{note}</span>
      </p>
    </div>
    {links.length > 0 && (
      <div
        className={cn(
          BAND,
          'flex items-center gap-4 px-5 py-3',
          links.length > 1 ? 'justify-between' : 'justify-end',
        )}
      >
        {links.map((item) => (
          <FootLink key={item.link.to} link={item.link}>
            {item.label}
          </FootLink>
        ))}
      </div>
    )}
  </Card>
);

/**
 * «منتهٍ منذ N يومًا» · «منتهٍ اليوم» · «بعد N يومًا»: the state at a licence row's end. Amber up to
 * `warnDays` — the setting the yellow bucket above counts with — so a row's colour never
 * contradicts the bucket it is counted in.
 */
const useAge = (warnDays: number): ((days: number) => { tone: Age; text: ReactNode }) => {
  const t = useT();
  const noun = useNoun();
  return (days) => {
    if (days === 0) return { tone: 'red', text: t('fleet.dash.licences.expiredToday') };
    const n = Math.abs(days);
    const parts = { count: <N>{count(n)}</N>, noun: noun('day', n) };
    return days < 0
      ? { tone: 'red', text: <Phrase text={t('fleet.dash.licences.expiredSince')} parts={parts} /> }
      : {
          tone: days <= warnDays ? 'amber' : 'grey',
          text: <Phrase text={t('fleet.dash.licences.expiresIn')} parts={parts} />,
        };
  };
};

// ── 1 · «تراخيص السيارات» (T4.1–T4.4) ─────────────────────────────────────────────────────────

const Bucket = ({
  tone,
  label,
  n,
  link,
}: {
  tone: Age;
  label: ReactNode;
  n: number;
  link: DashLink | null;
}): JSX.Element => (
  <Fig
    link={link}
    linkedClassName=""
    className={cn(
      PILL_SHAPE,
      'px-2.5 py-1 text-xs transition-colors',
      PILL[tone],
      PILL_HOVER[tone],
      FOCUS,
    )}
  >
    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', PILL_DOT[tone])} />
    <span>
      {label} <N className="font-bold">{count(n)}</N>
    </span>
  </Fig>
);

/** A licence row's car: its code in the approved drawing's framed box, the box itself the link to
 *  the car's file. */
const CodeBox = ({
  vehicleId,
  code,
  link,
}: {
  vehicleId: string;
  code: string;
  link: DashLink | null;
}): JSX.Element => (
  <Fig
    link={link}
    linkedClassName=""
    className="inline-grid h-9 min-w-[3rem] shrink-0 place-items-center rounded-md border border-slate-300 bg-slate-50 px-2 text-[15px] font-bold leading-5 text-slate-900 shadow-sm transition-colors hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:border-slate-500"
  >
    {/* The car card on the code — a Tab stop of its own only when the box is no link. */}
    <VehicleHoverCode
      vehicleId={vehicleId}
      code={code}
      focusable={link === null}
      dir="ltr"
      className={NUM}
    />
  </Fig>
);

const VehicleLicences = ({
  lic,
  links,
}: {
  lic: NonNullable<FleetDashboardNowDto['licenceVehicles']>;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const age = useAge(lic.warnDays);
  const within = (days: number): ReactNode => (
    <Phrase
      text={t('fleet.dash.licences.within')}
      parts={{ count: <N>{count(days)}</N>, noun: noun('day', days) }}
    />
  );
  const buckets: { tone: Age; label: ReactNode; n: number; link: DashLink | null }[] = [
    {
      tone: 'red',
      label: t('fleet.dash.licences.expired'),
      n: lic.expired,
      link: links.vehicleLicencesExpired(),
    },
    {
      tone: 'amber',
      label: within(lic.warnDays),
      n: lic.expiring,
      link: links.vehicleLicencesExpiring(lic.warnDays),
    },
    ...(lic.warnDays < FLEET_LICENCE_GREY_DAYS
      ? [
          {
            tone: 'grey' as const,
            label: within(FLEET_LICENCE_GREY_DAYS),
            n: lic.soon,
            link: links.vehicleLicencesSoon(lic.warnDays),
          },
        ]
      : []),
  ];
  const all = lic.expired + lic.expiring + lic.soon;
  return (
    <Panel
      data="vehicle-licences"
      head={
        <CardHead
          dot="red"
          title={t('fleet.dash.licences.vehiclesTitle')}
          sub={t('fleet.dash.licences.nearestFirst')}
          className={HEAD_WRAP}
          end={buckets.map((b) => (
            <Bucket key={b.tone} {...b} />
          ))}
        />
      }
      note={t('fleet.dash.licences.vehiclesNote')}
      links={[
        { link: links.vehicleLicencesWithin60(), label: t('fleet.dash.licences.showVehicles') },
      ]}
    >
      {all > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <span className={cn('shrink-0 whitespace-nowrap text-xs', MUTED)}>
            <Phrase
              text={t('fleet.dash.licences.mix')}
              parts={{
                count: <N className={cn('font-bold', STRONG)}>{count(all)}</N>,
                noun: noun('car', all),
                days: <N>{count(FLEET_LICENCE_GREY_DAYS)}</N>,
              }}
            />
          </span>
          <div className="flex h-2 min-w-0 flex-1 gap-[3px]" aria-hidden="true">
            {buckets.map((b) => (
              <span
                key={b.tone}
                className={cn('h-full rounded-full', BAR[b.tone])}
                style={{ flex: `${share(b.n, all) ?? 0} 1 0%` }}
              />
            ))}
          </div>
        </div>
      )}
      {lic.outOfServiceExpired > 0 && (
        <p className={cn('mt-2 text-xs', MUTED)}>
          <Phrase
            text={t('fleet.dash.licences.outOfService')}
            parts={{
              count: <N className={cn('font-bold', RED)}>{count(lic.outOfServiceExpired)}</N>,
            }}
          />
        </p>
      )}
      {lic.list.length === 0 ? (
        <p className={cn('mt-4', NOTE)}>{t('fleet.dash.licences.noneDue')}</p>
      ) : (
        <ul className="mt-3">
          {lic.list.map((row) => {
            const state = age(row.days);
            return (
              <li
                key={row.vehicleId}
                data-licence-row={row.vehicleId}
                className={cn(ROW, 'py-2.5')}
              >
                <CodeBox
                  vehicleId={row.vehicleId}
                  code={row.code}
                  link={links.vehicle(row.vehicleId, 'licenceVehicles.row')}
                />
                <span className="min-w-0 flex-1" />
                <N className="shrink-0 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                  {slashDay(row.expiresAt)}
                </N>
                <span
                  data-licence-tone={state.tone}
                  className={cn(STATE, 'w-[118px] 2xl:w-[128px]', PILL[state.tone])}
                >
                  <span
                    aria-hidden="true"
                    className={cn('h-1.5 w-1.5 rounded-full', PILL_DOT[state.tone])}
                  />
                  <span>{state.text}</span>
                </span>
              </li>
            );
          })}
          {lic.more > 0 && (
            <li className={cn(ROW, 'justify-center pt-3')}>
              <Fig
                link={links.vehicleLicencesWithin60()}
                linkedClassName=""
                className={cn(
                  CHIP,
                  'inline-flex items-center gap-1.5 px-3 py-1 transition-colors hover:border-slate-400 hover:text-slate-900 dark:hover:border-slate-600 dark:hover:text-white',
                  FOCUS,
                )}
              >
                <Phrase
                  text={t('fleet.dash.licences.more')}
                  parts={{
                    count: <N>{`+${count(lic.more)}`}</N>,
                    days: <N>{count(FLEET_LICENCE_GREY_DAYS)}</N>,
                  }}
                />
                <Icon d={I.arrow} className="h-3 w-3 opacity-60" />
              </Fig>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
};

// ── 2 · «آخر ما سُجّل» (T4.8, T4.9 · R-12) ───────────────────────────────────────────────────

type Kind = 'visit' | 'accident';
type Filter = 'all' | Kind;

const KIND_TILE: Record<Kind, { icon: IconPath; cls: string }> = {
  visit: { icon: I.cog, cls: TONE.blue.tile },
  accident: { icon: I.warn, cls: TONE.red.tile },
};

const Culprit = ({ row }: { row: FleetDashboardRecentAccidentDto }): JSX.Element => {
  const t = useT();
  const people = useEmployeeRecords(row.culpritEmployeeIds);
  const text = row.culprit ?? t('fleet.dash.licences.noCulprit');
  if (row.culpritEmployeeIds.length === 0) return <span>{text}</span>;
  return (
    <DriverHoverText
      people={[...people.values()]}
      className="cursor-pointer underline decoration-slate-400 decoration-dotted underline-offset-4 dark:decoration-slate-500"
    >
      {text}
    </DriverHoverText>
  );
};

const VisitRow = ({
  row,
  links,
  locale,
}: {
  row: FleetDashboardRecentVisitDto;
  links: NowLinks;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  return (
    <li data-recent-visit={row.visitId} className={cn(ROW, 'py-2.5')}>
      <span
        className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', KIND_TILE.visit.cls)}
      >
        <Icon d={KIND_TILE.visit.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <Fig
          link={links.visitDay(row.code, row.date, row.open)}
          linkedClassName=""
          className={cn('block text-[13px] font-bold leading-6', STRONG)}
        >
          <Phrase
            text={t(row.open ? 'fleet.dash.licences.visitIn' : 'fleet.dash.licences.visitOut')}
            parts={{
              // Inside the line's own link: the chip hovers, and Tab reaches the link.
              code: <CarChip code={row.code} focusable={false} />,
              workshop:
                row.workshop === null
                  ? t('fleet.dash.licences.noWorkshop')
                  : localized(row.workshop, locale),
              work: row.workType === null ? '' : ` — ${localized(row.workType, locale)}`,
            }}
          />
        </Fig>
        <span className={cn('block text-xs leading-5', MUTED)}>
          <N>{slashDay(row.date)}</N>
          <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-600">
            ·
          </span>
          <Phrase
            text={t('fleet.dash.licences.recordedAt')}
            parts={{ time: <N>{cairoTime(row.recordedAt)}</N> }}
          />
        </span>
      </span>
      <span className={cn(STATE, 'w-[84px]', PILL[row.open ? 'amber' : 'grey'])}>
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-full', PILL_DOT[row.open ? 'amber' : 'grey'])}
        />
        {t(row.open ? 'fleet.dash.licences.inWorkshop' : 'fleet.dash.licences.left')}
      </span>
    </li>
  );
};

const AccidentRow = ({
  row,
  links,
}: {
  row: FleetDashboardRecentAccidentDto;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const open = row.status === 'open';
  return (
    <li data-recent-accident={row.accidentId} className={cn(ROW, 'py-2.5')}>
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
          KIND_TILE.accident.cls,
        )}
      >
        <Icon d={KIND_TILE.accident.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] font-bold leading-6', STRONG)}>
          <Phrase
            text={t('fleet.dash.licences.accident')}
            parts={{
              code: <CarChip code={row.code} link={links.accidentDay(row.code, row.date)} />,
              culprit: <Culprit row={row} />,
            }}
          />
        </span>
        <span className={cn('block text-xs leading-5', MUTED)}>
          <N>{slashDay(row.date)}</N>
        </span>
      </span>
      <span className={cn(STATE, 'w-[84px]', PILL[open ? 'amber' : 'grey'])}>
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-full', PILL_DOT[open ? 'amber' : 'grey'])}
        />
        {t(`fleet.dash.licences.accidentStatus.${row.status}`)}
      </span>
    </li>
  );
};

const Latest = ({
  visits,
  accidents,
  links,
}: {
  visits: FleetDashboardRecentVisitDto[] | null;
  accidents: FleetDashboardRecentAccidentDto[] | null;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [filter, setFilter] = useState<Filter>('all');
  const both = visits !== null && accidents !== null;
  const shown: Filter = both ? filter : visits !== null ? 'visit' : 'accident';
  // «الكل»: each list as the server ordered it (newest written first), visits and accidents by
  // business day, newest day first; a day's visits before its accidents.
  const merged: (
    | { kind: 'visit'; row: FleetDashboardRecentVisitDto }
    | { kind: 'accident'; row: FleetDashboardRecentAccidentDto }
  )[] = [
    ...(shown === 'accident' ? [] : (visits ?? []).map((row) => ({ kind: 'visit' as const, row }))),
    ...(shown === 'visit'
      ? []
      : (accidents ?? []).map((row) => ({ kind: 'accident' as const, row }))),
  ];
  const rows =
    shown === 'all'
      ? [...merged].sort((a, b) => (a.row.date < b.row.date ? 1 : a.row.date > b.row.date ? -1 : 0))
      : merged;
  const segments: readonly (readonly [Filter, string])[] = [
    ['all', t('fleet.dash.licences.segAll')],
    ['visit', t('fleet.dash.licences.segVisits')],
    ['accident', t('fleet.dash.licences.segAccidents')],
  ];
  return (
    <Panel
      data="latest"
      head={
        <CardHead
          title={
            <>
              {t('fleet.dash.licences.latestTitle')}
              <span className={cn(CHIP, 'inline-flex items-center gap-1 py-1')}>
                <Icon d={I.clock} className="h-3 w-3 text-slate-400" />
                <Phrase
                  text={t('fleet.dash.licences.lastDays')}
                  parts={{
                    count: <N>{count(FLEET_DASHBOARD_RECENT_DAYS)}</N>,
                    noun: noun('day', FLEET_DASHBOARD_RECENT_DAYS),
                  }}
                />
              </span>
            </>
          }
          sub={t('fleet.dash.licences.newestFirst')}
          className={HEAD_WRAP}
          end={
            both ? (
              <div
                role="tablist"
                aria-label={t('fleet.dash.licences.segLabel')}
                className={cn(SEG.tray, 'shrink-0')}
              >
                {segments.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={key === filter}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'whitespace-nowrap rounded-lg px-3 py-1 text-xs font-bold transition active:scale-[0.98]',
                      CAIRO,
                      FOCUS,
                      key === filter ? SEG.on : SEG.off,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
      }
      note={t('fleet.dash.licences.latestNote')}
      links={[
        ...(accidents === null
          ? []
          : [
              {
                link: links.accidentsRecent(FLEET_DASHBOARD_RECENT_DAYS),
                label: t('fleet.dash.licences.accidentsLog'),
              },
            ]),
        ...(visits === null
          ? []
          : [
              {
                link: links.visitsRecent(FLEET_DASHBOARD_RECENT_DAYS),
                label: t('fleet.dash.licences.visitsLog'),
              },
            ]),
      ]}
    >
      {rows.length === 0 ? (
        <p className={cn('mt-4', NOTE)}>{t('fleet.dash.licences.latestNone')}</p>
      ) : (
        <ul className="mt-3 flex flex-1 flex-col" data-latest-filter={shown}>
          {rows.map((item) =>
            item.kind === 'visit' ? (
              <VisitRow
                key={`v-${item.row.visitId}`}
                row={item.row}
                links={links}
                locale={locale}
              />
            ) : (
              <AccidentRow key={`a-${item.row.accidentId}`} row={item.row} links={links} />
            ),
          )}
        </ul>
      )}
    </Panel>
  );
};

// ── 3 · «رخص السائقين» (T4.5) and 4 · «أوراق التراخيص وكروت الوقود» (T4.6, T4.7) ────────────

type TileTone = Age | 'plain';
const TILE: Record<TileTone, { box: string; label: string; figure: string }> = {
  red: {
    box: 'border-red-300 bg-red-50/60 hover:border-red-400 dark:border-red-500/30 dark:bg-red-500/[0.06] dark:hover:border-red-500/50',
    label: 'text-red-800 dark:text-red-300',
    figure: RED,
  },
  amber: {
    box: 'border-amber-300 bg-amber-50/60 hover:border-amber-400 dark:border-amber-500/30 dark:bg-amber-500/[0.06] dark:hover:border-amber-500/50',
    label: 'text-amber-800 dark:text-amber-300',
    figure: AMBER,
  },
  grey: { box: cn(BOX, BOX_HOVER), label: 'text-slate-800 dark:text-slate-300', figure: STRONG },
  plain: {
    box: cn('border-dashed border-slate-300 dark:border-[rgba(71,85,105,.6)]', BOX_HOVER),
    label: 'text-slate-800 dark:text-slate-300',
    figure: STRONG,
  },
};

const Tile = ({
  label,
  value,
  tone,
  link,
}: {
  label: ReactNode;
  value: number;
  tone: TileTone;
  link: DashLink | null;
}): JSX.Element => (
  <div
    className={cn(
      'flex min-h-[88px] min-w-0 flex-col items-center justify-between gap-2 rounded-xl border px-2 pb-3 pt-2.5 text-center',
      TILE[tone].box,
    )}
  >
    <span className={cn('text-xs font-bold leading-5 dark:font-semibold', TILE[tone].label)}>
      {label}
    </span>
    <Fig
      link={link}
      className={cn(
        CAIRO,
        'text-[26px] font-black leading-none tabular-nums tracking-tight',
        TILE[tone].figure,
      )}
    >
      <span dir="ltr">{count(value)}</span>
    </Fig>
  </div>
);

const Caption = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <div
    className={cn(
      'flex items-center gap-2 text-[11px] font-bold dark:font-semibold',
      MUTED,
      className,
    )}
  >
    <span className="whitespace-nowrap">{children}</span>
    <span aria-hidden="true" className={cn('h-0 flex-1 border-t', RULE)} />
  </div>
);

const DriverLicences = ({
  lic,
  links,
}: {
  lic: NonNullable<FleetDashboardNowDto['licenceDrivers']>;
  links: NowLinks;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const within = (days: number): ReactNode => (
    <Phrase
      text={t('fleet.dash.licences.within')}
      parts={{ count: <N>{count(days)}</N>, noun: noun('day', days) }}
    />
  );
  const grey = lic.warnDays < FLEET_LICENCE_GREY_DAYS;
  return (
    <Panel
      data="driver-licences"
      head={
        <CardHead
          dot="red"
          title={t('fleet.dash.licences.driversTitle')}
          sub={t('fleet.dash.licences.driversSub')}
        />
      }
      note={t('fleet.dash.licences.driversNote')}
      links={[{ link: links.driverLicencesExpired(), label: t('fleet.dash.licences.openDrivers') }]}
    >
      <div className={cn('mt-4 grid gap-x-2.5 gap-y-2', grey ? 'grid-cols-5' : 'grid-cols-4')}>
        <Caption className={grey ? 'col-span-3' : 'col-span-2'}>
          {t('fleet.dash.licences.byExpiry')}
        </Caption>
        <Caption className="col-span-2">{t('fleet.dash.licences.missingData')}</Caption>
        <Tile
          label={t('fleet.dash.licences.expired')}
          value={lic.expired}
          tone="red"
          link={links.driverLicencesExpired()}
        />
        <Tile
          label={within(lic.warnDays)}
          value={lic.expiring}
          tone="amber"
          link={links.driverLicencesExpiring(lic.warnDays)}
        />
        {grey && (
          <Tile
            label={within(FLEET_LICENCE_GREY_DAYS)}
            value={lic.soon}
            tone="grey"
            link={links.driverLicencesSoon(lic.warnDays)}
          />
        )}
        <Tile
          label={t('fleet.dash.licences.notRecorded')}
          value={lic.notRecorded}
          tone="plain"
          link={links.driverLicencesNotRecorded()}
        />
        <Tile
          label={t('fleet.dash.licences.unregistered')}
          value={lic.unregistered}
          tone="plain"
          link={null}
        />
      </div>
    </Panel>
  );
};

const PapersAndCards = ({
  papers,
  cards,
  links,
  branch,
}: {
  papers: FleetDashboardNowDto['papers'];
  cards: FleetDashboardNowDto['fuelCards'];
  links: NowLinks;
  branch: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  return (
    <Panel
      data="papers-cards"
      head={
        <CardHead
          dot="amber"
          title={t('fleet.dash.licences.papersTitle')}
          sub={t('fleet.dash.licences.papersSub')}
          end={cards !== null ? <CompanyWide show={branch} /> : undefined}
        />
      }
      note={t('fleet.dash.licences.papersNote')}
      links={[
        ...(cards === null
          ? []
          : [
              {
                link: links.fuelCardsExpiring(cards.warnDays),
                label: t('fleet.dash.licences.openCards'),
              },
            ]),
        ...(papers === null
          ? []
          : [
              { link: links.licensing('insurance'), label: t('fleet.dash.licences.openLicensing') },
            ]),
      ]}
    >
      <div
        className={cn(
          'mt-4 grid gap-x-2.5 gap-y-2',
          papers !== null && cards !== null
            ? 'grid-cols-3'
            : papers !== null
              ? 'grid-cols-2'
              : 'grid-cols-1',
        )}
      >
        {papers !== null && (
          <Caption className="col-span-2">{t('fleet.dash.licences.papersCaption')}</Caption>
        )}
        {cards !== null && <Caption>{t('fleet.dash.licences.cardsCaption')}</Caption>}
        {papers !== null && (
          <>
            <Tile
              label={t('fleet.dash.licences.insuranceOpen')}
              value={papers.insurance}
              tone="grey"
              link={links.licensing('insurance')}
            />
            <Tile
              label={t('fleet.dash.licences.taxOpen')}
              value={papers.tax}
              tone="grey"
              link={links.licensing('tax')}
            />
          </>
        )}
        {cards !== null && (
          <Tile
            label={
              <Phrase
                text={t('fleet.dash.licences.cardsExpiring')}
                parts={{ count: <N>{count(cards.warnDays)}</N>, noun: noun('day', cards.warnDays) }}
              />
            }
            value={cards.expiring}
            tone="amber"
            link={links.fuelCardsExpiring(cards.warnDays)}
          />
        )}
      </div>
    </Panel>
  );
};

const LICENCE_SECTIONS = [
  'licenceVehicles',
  'licenceDrivers',
  'papers',
  'fuelCards',
  'recentWorkshop',
  'recentAccidents',
] as const;

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const LicencesTab = (props: NowTabProps): JSX.Element => {
  const t = useT();
  const { now } = props;
  const links = now === null ? null : nowLinks(now);
  const failed = LICENCE_SECTIONS.filter((section) => now?.unavailable.includes(section) ?? false);
  return (
    <div data-dash-tab-body="licences">
      <TabHead
        icon={I.doc}
        title={t('fleet.dash.shell.tab.licences')}
        sub={t('fleet.dash.licences.sub')}
        end={
          <RefreshTools
            updatedAt={props.updatedAt}
            onRefresh={props.onRefresh}
            refreshing={props.refreshing}
            {...(props.clock === undefined ? {} : { clock: props.clock })}
          />
        }
      />
      {now !== null && links !== null && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {failed.map((section) => (
            <SectionError key={section} section={section} onRetry={props.onRetry} />
          ))}
          {now.licenceVehicles !== null && (
            <VehicleLicences lic={now.licenceVehicles} links={links} />
          )}
          {(now.recentWorkshop !== null || now.recentAccidents !== null) && (
            <Latest visits={now.recentWorkshop} accidents={now.recentAccidents} links={links} />
          )}
          {now.licenceDrivers !== null && <DriverLicences lic={now.licenceDrivers} links={links} />}
          {(now.papers !== null || now.fuelCards !== null) && (
            <PapersAndCards
              papers={now.papers}
              cards={now.fuelCards}
              links={links}
              branch={now.branchId !== null}
            />
          )}
        </div>
      )}
    </div>
  );
};
