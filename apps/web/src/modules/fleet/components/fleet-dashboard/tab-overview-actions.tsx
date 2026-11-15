// «نظرة عامة» — the action centre's lines (layout B, «مصفوفة التنبيهات التشغيلية المباشرة»): what
// each alert line that fired says in its row — the icon, a short title (never a count: the count is
// the row's chip), one muted line under it, the count and its noun, and the ONE link its «فتح» opens.
//
// Lifted from the retired «التنبيهات» tab's line model: the same section reads and the same link
// builders, the first of its old buttons now the row's only one (the owner: «خلي الزراير كلها
// فتح»). A line whose first link is `null` (the alarm or no-reading codes over the screens' cap of 50
// under a branch) has no button: there is no exact list to open.
//
// Every number is the server's — the line's count (`alerts`) and its section's parts — and the
// custody line's count is the custody screen's own banner (D3). «الشركة كلها» on the lines the
// server cannot narrow yet (fuel cards, top-ups, notices, custody) while the figures are narrowed to
// the reader's branches (`scopeBranches !== null`).
import { Fragment, type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_ALERTS,
  type FleetDashboardNowDto,
  type FleetDashboardNowSection,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { custodyDashboardLink, nowLinks, type DashLink } from '../../lib/fleet-dashboard-links';
import { slashDay, type AlertLine } from '../../lib/fleet-dashboard-tabs';
import { CarChip, Fig, I, N, STRONG, TONE, cn, type IconPath } from './dash-kit';
import { Amount, Phrase, count, useNoun, type DashNoun } from './dash-shell';
import { type CustodyFigures } from './custody-fund-line';
import { useSeparator } from '../custody-dashboard-parts';

/** The R1 sections the server derives its alert lines from (custody is the page's own read). */
export const ACTION_SECTIONS: readonly FleetDashboardNowSection[] = [
  ...new Set<FleetDashboardNowSection>(FLEET_DASHBOARD_ALERTS.map((alert) => alert.section)),
];

/** What one row of the action centre draws. */
export interface ActionView {
  icon: IconPath;
  /** The short title — never the count. */
  title: ReactNode;
  /** The muted line under the title; `null` for none. */
  sub: ReactNode | null;
  /** The row's chip: the line's count and its counted noun. */
  count: number;
  noun: DashNoun;
  /** What «فتح» opens: the line's first list; `null` = no button. */
  link: DashLink | null;
  /** «الشركة كلها» beside the title. */
  companyWide: boolean;
}

/** Up to this many cars are named under a title; the rest are behind «فتح». */
const CHIPS = 4;

/** A figure in a sub-line — bold, the figure face, a link when it opens its own list. */
const B = ({ children, link = null }: { children: ReactNode; link?: DashLink | null }) => (
  <Fig link={link} className={cn('font-bold', STRONG)}>
    <N>{children}</N>
  </Fig>
);

/** Keeps a car and what is said of it on one line. */
const G = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className="whitespace-nowrap">{children}</span>
);

/** The parts of a sub-line, set apart by a quiet dot. */
const Parts = ({ parts }: { parts: readonly ReactNode[] }): JSX.Element => (
  <>
    {parts.map((piece, i) => (
      <Fragment key={i}>
        {i > 0 && (
          <span
            aria-hidden="true"
            className="mx-1.5 text-[10px] text-slate-400 dark:text-slate-500"
          >
            •
          </span>
        )}
        {piece}
      </Fragment>
    ))}
  </>
);

/** A list of car chips, the reader's list separator between them, and «…» when the list goes on
 *  past the chips shown. */
const Cars = <Row extends { vehicleId: string }>({
  rows,
  more,
  render,
}: {
  rows: readonly Row[];
  more: boolean;
  render: (row: Row) => ReactNode;
}): JSX.Element => {
  const separator = useSeparator();
  return (
    <>
      {rows.map((row, i) => (
        <Fragment key={row.vehicleId}>
          {i > 0 && separator}
          <G>{render(row)}</G>
        </Fragment>
      ))}
      {more && ' …'}
    </>
  );
};

/**
 * The row of a line that fired, from its section's own figures — or `null` when the section is not
 * there to say it (a line is only sent while its section answered, so this is a guard).
 */
export const useActionLine = (
  can: (permission: string) => boolean,
): ((
  line: AlertLine,
  now: FleetDashboardNowDto | null,
  custody: CustodyFigures | null,
) => ActionView | null) => {
  const t = useT();
  const noun = useNoun();
  return (line, now, custody) => {
    const k = (rest: string): string => t(`fleet.dash.overview.actions.line.${line.id}.${rest}`);
    const narrowed = now !== null && now.scopeBranches !== null;
    const base = { count: line.count, companyWide: false };
    if (line.id === 'custody') {
      if (custody === null) return null;
      return {
        ...base,
        icon: I.clipboardCheck,
        title: k('title'),
        sub: null,
        noun: 'alert',
        link: custodyDashboardLink('custodyFund.lines'),
        companyWide: narrowed,
      };
    }
    if (now === null) return null;
    const links = nowLinks(now);
    switch (line.id) {
      case 'maintenanceRed': {
        const alarm = now.maintenanceAlarm;
        if (alarm === null) return null;
        // The company view sends no codes (the board lists them); a branch view names its cars.
        const codes = alarm.codes?.red ?? null;
        const parts: ReactNode[] = [];
        if (alarm.overdue > 0) {
          parts.push(
            <Phrase
              key="overdue"
              text={k('sub')}
              parts={{ count: <B>{count(alarm.overdue)}</B> }}
            />,
          );
        }
        if (codes !== null && codes.length > 0) {
          parts.push(
            <span key="codes">
              {codes.slice(0, CHIPS).map((code) => (
                <CarChip key={code} code={code} />
              ))}
              {codes.length > CHIPS && ' …'}
            </span>,
          );
        }
        return {
          ...base,
          icon: I.cog,
          title: k('title'),
          sub: parts.length === 0 ? null : <Parts parts={parts} />,
          noun: 'car',
          link: links.alarm('red', codes),
        };
      }
      case 'vehicleLicenceExpired': {
        const lic = now.licenceVehicles;
        if (lic === null) return null;
        // The nearest-first list starts with the oldest expiry: the expired cars lead it.
        const expired = lic.list.slice(0, CHIPS).flatMap((row) => (row.days <= 0 ? [row] : []));
        return {
          ...base,
          icon: I.doc,
          title: k('title'),
          sub:
            expired.length === 0 ? (
              k('sub')
            ) : (
              <Cars
                rows={expired}
                more={lic.expired > expired.length}
                render={(row) => (
                  <>
                    <CarChip
                      code={row.code}
                      link={links.vehicle(row.vehicleId, 'licenceVehicles.row')}
                    />{' '}
                    <span className={cn('font-bold', TONE.red.text)}>
                      {/* Expired ON its expiry day: «منتهٍ اليوم», never «منذ 0». */}
                      {row.days === 0 ? (
                        t('fleet.dash.overview.actions.expiredToday')
                      ) : (
                        <Phrase
                          text={t('fleet.dash.common.since')}
                          parts={{
                            count: <N>{count(-row.days)}</N>,
                            noun: noun('day', -row.days),
                          }}
                        />
                      )}
                    </span>
                  </>
                )}
              />
            ),
          noun: 'car',
          link: links.vehicleLicencesExpired(),
        };
      }
      case 'driverLicenceExpired': {
        if (now.licenceDrivers === null) return null;
        return {
          ...base,
          icon: I.user,
          title: k('title'),
          sub: k('sub'),
          noun: 'driver',
          link: links.driverLicencesExpired(),
        };
      }
      case 'fuelCardExpired': {
        if (now.fuelCards === null) return null;
        return {
          ...base,
          icon: I.card,
          title: k('title'),
          sub: null,
          noun: 'card',
          link: links.fuelCardsExpired(),
          companyWide: narrowed,
        };
      }
      case 'crewAbsent': {
        if (now.roster === null) return null;
        return {
          ...base,
          icon: I.users,
          title: k('title'),
          sub: k('sub'),
          noun: 'car',
          link: links.crewGap(),
        };
      }
      case 'fuelRequests': {
        const fuel = now.fuelCharging;
        if (fuel === null) return null;
        return {
          ...base,
          icon: I.wallet,
          title: k('title'),
          sub: (
            <Phrase
              text={k('sub')}
              parts={{ amount: <Amount value={fuel.requested.amount} className={STRONG} /> }}
            />
          ),
          noun: 'request',
          link: links.charging('requested'),
          companyWide: narrowed,
        };
      }
      case 'fuelLow': {
        const fuel = now.fuelCharging;
        if (fuel === null) return null;
        return {
          ...base,
          icon: I.fuel,
          title: (
            <Phrase text={k('title')} parts={{ yellowAt: <Amount value={fuel.low.yellowAt} /> }} />
          ),
          sub:
            fuel.low.belowRed > 0 ? (
              <Phrase
                text={k('sub')}
                parts={{
                  count: <B>{count(fuel.low.belowRed)}</B>,
                  redAt: <Amount value={fuel.low.redAt} className={STRONG} />,
                }}
              />
            ) : null,
          noun: 'card',
          link: links.charging('low'),
          companyWide: narrowed,
        };
      }
      case 'dealershipPending': {
        if (now.dealershipPending === null) return null;
        return {
          ...base,
          icon: I.receipt,
          title: k('title'),
          sub: null,
          noun: 'row',
          link: links.dealershipPending(),
        };
      }
      case 'noticesMissing': {
        const notices = now.notices;
        if (notices === null) return null;
        return {
          ...base,
          icon: I.paperclip,
          title: k('title'),
          sub: (
            <Phrase
              text={k('sub')}
              parts={{
                licences: <B>{count(notices.missingLicences)}</B>,
                cheque: <B link={links.noticesCheckImage()}>{count(notices.missingCheckImage)}</B>,
              }}
            />
          ),
          noun: 'notice',
          link: links.noticesOpen(),
          companyWide: narrowed,
        };
      }
      case 'noReading': {
        const reading = now.noReading;
        if (reading === null) return null;
        const stale = reading.stale.slice(0, CHIPS);
        const never = reading.neverRead.slice(0, CHIPS);
        // The never-read cars open the VEHICLES screen (fleetVehicle.view), not this section's
        // odometer screen: offered only with that screen's own guard. They are not in the row's
        // count — the server counts the stale cars; the never-read ones are only named.
        const neverLink = can('fleetVehicle.view')
          ? links.neverRead(reading.neverRead.map((row) => row.code))
          : null;
        const parts: ReactNode[] = [];
        if (stale.length > 0) {
          parts.push(
            <span key="stale">
              <Cars
                rows={stale}
                more={reading.stale.length > CHIPS}
                render={(row) => (
                  <>
                    <CarChip code={row.code} />{' '}
                    <Phrase
                      text={t('fleet.dash.common.sinceDay')}
                      parts={{ day: <N>{slashDay(row.lastDate)}</N> }}
                    />
                  </>
                )}
              />
            </span>,
          );
        }
        if (never.length > 0) {
          parts.push(
            <span key="never">
              <Fig link={neverLink} className="font-semibold">
                {k('neverRead')}
              </Fig>{' '}
              {never.map((row) => (
                <CarChip key={row.vehicleId} code={row.code} />
              ))}
              {reading.neverRead.length > CHIPS && ' …'}
            </span>,
          );
        }
        return {
          ...base,
          icon: I.gauge,
          title: (
            <Phrase
              text={k('title')}
              parts={{ count: <N>{count(reading.days)}</N>, noun: noun('day', reading.days) }}
            />
          ),
          sub: parts.length === 0 ? k('sub') : <Parts parts={parts} />,
          noun: 'car',
          link: links.noReading(reading.stale.map((row) => row.code)),
        };
      }
    }
  };
};
