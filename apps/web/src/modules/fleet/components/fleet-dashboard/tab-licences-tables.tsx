// «التراخيص والتجديدات» — the two full-width tables of the «الآن» band (approved/lic-dark.png and
// lic-branch-dark.png; harness zz-licences-tab.tsx `CarsTable` / `DriversTable`; DECISIONS §11 Q2
// (أ), critic B8 / C4):
//
//   · «أقرب تراخيص السيارات»: the server's nearest rows (≤ FLEET_DASHBOARD_LICENCE_ROWS, the
//     longest-expired first) — the car and its make │ the licence class │ the day in the board's red
//     / amber / neutral │ the state in ONE spelling («منتهٍ منذ …», «بعد …») │ the board's open papers
//     (a column only for a reader of the board: «تأمينات لم تُستلم» / «ضرائب لم تُستلم», «—» else) │
//     «فتح» on the car's record; the chip = the server's rows + `more` (= expired + expiring + soon
//     while the warning days are within 60 — the list never reaches past 60 days); «عرض الباقي (N)»
//     only when the server left rows out;
//   · «أقرب رخص السائقين»: the same for the drivers' Fleet files — the name and code from Fleet's
//     people list (`/fleet/people`, the «الحركة اليوم» read), the licence type, the roster's «الملف
//     موقوف» on a suspended file (counted as the counts are), «فتح» on the driver's file.
//
// The two tables share their columns' widths, so the days and states line up. From 768 px a table;
// below, each row a block. NOTHING IS COUNTED HERE: the chips and «عرض الباقي» are server fields.
import { type ReactNode } from 'react';
import {
  FLEET_LICENCE_GREY_DAYS,
  type FleetDashboardNowDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { DriverIdentity } from '../DriverPerson';
import { useFleetPeopleMap } from '../EmployeeName';
import {
  Btn,
  Card,
  CarChip,
  DIVIDE,
  FootLink,
  I,
  MUTED,
  N,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  TONE,
  Tag,
  cn,
} from './dash-kit';
import { Phrase, count } from './dash-shell';
import { BlockFoot, BlockHead, COUNT_CHIP } from './dash-blocks';
import {
  Counted,
  DATE_TONE,
  Day,
  DayPhrase,
  EndLine,
  licenceTone,
  useLicenceWords,
} from './tab-licences-words';

type Vehicles = NonNullable<FleetDashboardNowDto['licenceVehicles']>;
type Drivers = NonNullable<FleetDashboardNowDto['licenceDrivers']>;
type CarRow = Vehicles['list'][number];
type DriverRow = Drivers['list']['rows'][number];

const ROW = 'px-3 py-3.5 align-middle first:ps-5 last:pe-5';
const PLAIN = 'whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200';

/** The two tables' shared columns, so their days and states line up. */
const ColGroup = (): JSX.Element => (
  <colgroup>
    <col className="w-[23%]" />
    <col className="w-[13%]" />
    <col className="w-[14%]" />
    <col className="w-[16%]" />
    <col />
    <col className="w-[112px]" />
  </colgroup>
);

/** A catalog name in the reader's language, «—» when none is recorded. */
const Named = ({ name }: { name: LocalizedString | null }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return name === null ? (
    <span className={cn('font-semibold', MUTED)}>—</span>
  ) : (
    <>{localized(name, locale)}</>
  );
};

/** The expiry day in the board's colour of its state. */
const ExpiryDay = ({
  ymd,
  days,
  warnDays,
}: {
  ymd: string;
  days: number;
  warnDays: number;
}): JSX.Element => {
  const tone = licenceTone(days, warnDays);
  return (
    <span data-lic-expiry={ymd.slice(0, 10)} data-lic-date-tone={tone}>
      <Day ymd={ymd} tone={DATE_TONE[tone]} />
    </span>
  );
};

/** «منتهٍ منذ يومين» / «بعد 13 يومًا» in its state's pill. */
const Remaining = ({ days, warnDays }: { days: number; warnDays: number }): JSX.Element => {
  const tone = licenceTone(days, warnDays);
  return (
    <span data-lic-state={tone}>
      <Tag tone={tone} dot>
        <DayPhrase days={days} />
      </Tag>
    </span>
  );
};

/** A column's name beside its value, while the row is a block. */
const Label = ({ children }: { children: ReactNode }): JSX.Element => (
  <dt className={cn('font-semibold', MUTED)}>{children}</dt>
);

/** The «فتح» column's head: its word for a screen reader only. */
const OpenHead = (): JSX.Element => {
  const w = useLicenceWords();
  return (
    <th className={cn(ROW, 'py-2.5')}>
      <span className="sr-only">{w('open')}</span>
    </th>
  );
};

/** «عرض الباقي (N) ←» — only when the server left rows out. */
const ShowRest = ({ more, link }: { more: number; link: DashLink }): JSX.Element | null => {
  const w = useLicenceWords();
  if (more <= 0) return null;
  return (
    <BlockFoot>
      <span data-lic-more={String(more)}>
        <FootLink link={link}>
          <span>
            <Phrase text={w('showRest')} parts={{ count: <N>{count(more)}</N> }} />
          </span>
        </FootLink>
      </span>
    </BlockFoot>
  );
};

// ── «أقرب تراخيص السيارات» ────────────────────────────────────────────────────────────────────

/** The board's open papers of a «ت» car; «—» for a car off the board (or a paper not open). */
const Papers = ({ papers }: { papers: CarRow['papers'] }): JSX.Element => {
  const t = useT();
  const open =
    papers === null ? [] : (['insurance', 'tax'] as const).filter((p) => papers[p] === 'open');
  if (open.length === 0) {
    return (
      <span data-lic-papers="none" className={cn('font-semibold', MUTED)}>
        —
      </span>
    );
  }
  return (
    <span data-lic-papers={open.join(',')} className="flex flex-wrap items-center gap-1.5">
      {open.map((paper) => (
        <span key={paper} data-lic-paper={paper}>
          <Tag tone="violet" dot>
            {t(
              paper === 'insurance'
                ? 'fleet.licensing.stats.insuranceOut'
                : 'fleet.licensing.stats.taxOut',
            )}
          </Tag>
        </span>
      ))}
    </span>
  );
};

const CarCell = ({ row, links }: { row: CarRow; links: NowLinks }): JSX.Element => (
  <div data-lic-car-cell={row.code} className="flex flex-col items-start gap-1">
    <CarChip code={row.code} link={links.vehicle(row.vehicleId, 'licenceVehicles.row')} />
    {row.typeName !== null && (
      <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
        <Named name={row.typeName} />
      </span>
    )}
  </div>
);

export const CarLicencesTable = ({
  lic,
  links,
  papers,
}: {
  lic: Vehicles;
  links: NowLinks;
  /** The reader may open the licensing board: the papers column is drawn. */
  papers: boolean;
}): JSX.Element => {
  const w = useLicenceWords();
  const warn = lic.warnDays;
  const th = cn(ROW, TH, 'py-2.5 text-start');
  return (
    <Card data-lic-block="cars" className="mt-5">
      <BlockHead
        icon={I.truck}
        tone="amber"
        title={w('cars.title')}
        note={w('cars.note', { days: count(FLEET_LICENCE_GREY_DAYS) })}
        chips={
          <span data-lic-chip="cars" className={cn(COUNT_CHIP, TONE.amber.soft)}>
            <Counted n={lic.list.length + lic.more} noun="car" />
          </span>
        }
      />
      {lic.list.length === 0 ? (
        <EndLine marker="cars">{w('cars.empty', { days: count(FLEET_LICENCE_GREY_DAYS) })}</EndLine>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
              <ColGroup />
              <thead className={TH_ROW}>
                <tr className={cn('border-y', RULE)}>
                  <th className={th}>{w('cars.col.car')}</th>
                  <th className={th}>{w('cars.col.class')}</th>
                  <th className={th}>{w('col.expires')}</th>
                  <th className={th}>{w('col.left')}</th>
                  <th className={th}>{papers ? w('cars.col.papers') : null}</th>
                  <OpenHead />
                </tr>
              </thead>
              <tbody className={DIVIDE}>
                {lic.list.map((row) => (
                  <tr key={row.vehicleId} data-lic-car={row.vehicleId} data-lic-code={row.code}>
                    <td className={ROW}>
                      <CarCell row={row} links={links} />
                    </td>
                    <td className={cn(ROW, PLAIN)} data-lic-class="true">
                      <Named name={row.licenceClass} />
                    </td>
                    <td className={cn(ROW, 'whitespace-nowrap')}>
                      <ExpiryDay ymd={row.expiresAt} days={row.days} warnDays={warn} />
                    </td>
                    <td className={cn(ROW, 'whitespace-nowrap')}>
                      <Remaining days={row.days} warnDays={warn} />
                    </td>
                    <td className={ROW}>{papers && <Papers papers={row.papers} />}</td>
                    <td className={cn(ROW, 'text-end')}>
                      <Btn
                        link={links.vehicle(row.vehicleId, 'licenceVehicles.row')}
                        className="h-9 px-4"
                      >
                        {w('open')}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={cn('border-t md:hidden', RULE, DIVIDE)}>
            {lic.list.map((row) => (
              <li
                key={row.vehicleId}
                data-lic-car-block={row.vehicleId}
                className="flex flex-col gap-2 px-4 py-3.5 text-[13px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <CarCell row={row} links={links} />
                  <Remaining days={row.days} warnDays={warn} />
                </div>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
                  <Label>{w('cars.col.class')}</Label>
                  <dd className="font-semibold text-slate-700 dark:text-slate-200">
                    <Named name={row.licenceClass} />
                  </dd>
                  <Label>{w('col.expires')}</Label>
                  <dd>
                    <ExpiryDay ymd={row.expiresAt} days={row.days} warnDays={warn} />
                  </dd>
                  {papers && (
                    <>
                      <Label>{w('cars.col.papers')}</Label>
                      <dd>
                        <Papers papers={row.papers} />
                      </dd>
                    </>
                  )}
                </dl>
                <Btn
                  link={links.vehicle(row.vehicleId, 'licenceVehicles.row')}
                  className="h-9 w-full px-4"
                >
                  {w('open')}
                </Btn>
              </li>
            ))}
          </ul>
        </>
      )}
      <ShowRest more={lic.more} link={links.vehicleLicencesWithin60()} />
    </Card>
  );
};

// ── «أقرب رخص السائقين» ───────────────────────────────────────────────────────────────────────

/** The driver as the roster draws them: initials, name, code — and «الملف موقوف» on a suspended
 *  file. A file whose person is not on Fleet's list shows a dash, muted. */
const DriverCell = ({ row }: { row: DriverRow }): JSX.Element => {
  const t = useT();
  const person = useFleetPeopleMap().get(row.employeeId);
  return (
    <div
      data-lic-driver-cell={row.profileId}
      className={cn('flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]', STRONG)}
    >
      <DriverIdentity
        name={person?.fullNameAr ?? '—'}
        code={person?.code ?? null}
        muted={person === undefined}
      />
      {!row.active && (
        <span data-lic-suspended="true">
          <Tag tone="slate">{t('fleet.roster.reason.profileInactive')}</Tag>
        </span>
      )}
    </div>
  );
};

export const DriverLicencesTable = ({
  lic,
  links,
}: {
  lic: Drivers;
  links: NowLinks;
}): JSX.Element => {
  const w = useLicenceWords();
  const warn = lic.warnDays;
  const th = cn(ROW, TH, 'py-2.5 text-start');
  const rows = lic.list.rows;
  return (
    <Card data-lic-block="drivers" className="mt-5">
      <BlockHead
        icon={I.users}
        tone="amber"
        title={w('drivers.title')}
        note={w('drivers.note', { days: count(FLEET_LICENCE_GREY_DAYS) })}
        chips={
          <span data-lic-chip="drivers" className={cn(COUNT_CHIP, TONE.amber.soft)}>
            <Counted n={rows.length + lic.list.more} noun="driver" />
          </span>
        }
      />
      {rows.length === 0 ? (
        <EndLine marker="drivers">
          {w('drivers.empty', { days: count(FLEET_LICENCE_GREY_DAYS) })}
        </EndLine>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
              <ColGroup />
              <thead className={TH_ROW}>
                <tr className={cn('border-y', RULE)}>
                  <th className={th}>{w('drivers.col.driver')}</th>
                  <th className={th}>{w('drivers.col.type')}</th>
                  <th className={th}>{w('col.expires')}</th>
                  <th className={th}>{w('col.left')}</th>
                  <th aria-hidden="true" className={ROW} />
                  <OpenHead />
                </tr>
              </thead>
              <tbody className={DIVIDE}>
                {rows.map((row) => (
                  <tr
                    key={row.profileId}
                    data-lic-driver={row.profileId}
                    data-lic-active={row.active ? 'true' : 'false'}
                  >
                    <td className={ROW}>
                      <DriverCell row={row} />
                    </td>
                    <td className={cn(ROW, PLAIN)} data-lic-type="true">
                      <Named name={row.licenceType} />
                    </td>
                    <td className={cn(ROW, 'whitespace-nowrap')}>
                      <ExpiryDay ymd={row.expiresAt} days={row.days} warnDays={warn} />
                    </td>
                    <td className={cn(ROW, 'whitespace-nowrap')}>
                      <Remaining days={row.days} warnDays={warn} />
                    </td>
                    <td aria-hidden="true" className={ROW} />
                    <td className={cn(ROW, 'text-end')}>
                      <Btn
                        link={links.driver(row.profileId, 'licenceDrivers.row')}
                        className="h-9 px-4"
                      >
                        {w('open')}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={cn('border-t md:hidden', RULE, DIVIDE)}>
            {rows.map((row) => (
              <li
                key={row.profileId}
                data-lic-driver-block={row.profileId}
                className="flex flex-col gap-2 px-4 py-3.5 text-[13px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <DriverCell row={row} />
                  <Remaining days={row.days} warnDays={warn} />
                </div>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
                  <Label>{w('drivers.col.type')}</Label>
                  <dd className="font-semibold text-slate-700 dark:text-slate-200">
                    <Named name={row.licenceType} />
                  </dd>
                  <Label>{w('col.expires')}</Label>
                  <dd>
                    <ExpiryDay ymd={row.expiresAt} days={row.days} warnDays={warn} />
                  </dd>
                </dl>
                <Btn
                  link={links.driver(row.profileId, 'licenceDrivers.row')}
                  className="h-9 w-full px-4"
                >
                  {w('open')}
                </Btn>
              </li>
            ))}
          </ul>
        </>
      )}
      <ShowRest more={lic.list.more} link={links.driverLicencesWithin60()} />
    </Card>
  );
};
