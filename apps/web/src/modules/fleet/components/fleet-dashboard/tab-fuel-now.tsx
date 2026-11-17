// «الوقود والمصروفات» — the «الآن» band (approved/fuel-dark.png and fuel-branch-dark.png; harness
// zz-fuel.tsx; DECISIONS §8, the critic's C1–C13), over R1's four fuel sections:
//
//   · six KPIs in one row from 1800 px, 3 + 3 under it (`fuelCharging` draws five, `fuelCards` the
//     expiry one): both balance cards on a NEUTRAL tile with the company's dot and word in its
//     register colour (C1), «طلبات بانتظار الاعتماد» and «رصيد منخفض» amber, «شُحن اليوم» emerald with
//     the register's own line (C2), «تنتهي خلال N يومًا» amber with its nearest day and the expired
//     ones as a red link;
//   · the company view's note on the cards on no car (`unassigned`, only when there are such cards);
//   · «مطابقة شيت شركة الوقود» (Q1 أ): each company's last READ sheet, as it was read — plain
//     figures (no screen lists exactly them), one foot link to the reconcile screen;
//   · «كروت تحتاج متابعة» (Q2 أ), the page's full width: at most FLEET_DASHBOARD_FUEL_CARD_ROWS
//     cards in the server's urgency order, the register's own state words and colours (C3), «فتح»
//     per row (C6), the two figure-free foot links (C5); a table from 1024 px, each row a block below.
//
// Every figure follows the card's CURRENT car's branch (DECISIONS §0b answer 1): the server narrows,
// so the links carry the figures' branch; a card on no car is in no branch and stands in the company
// view only. NOTHING IS COUNTED HERE: every figure is a field R1 sent (`fuelCardList.total`, never
// the rows' length).
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  FLEET_DASHBOARD_FUEL_CARD_ROWS,
  type FleetDashboardFuelCardState,
  type FleetDashboardNowDto,
  type FleetDashboardNowFuelCardRowDto,
  type FleetDashboardNowFuelSheetDto,
  type FleetFuelCardCompany,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { nowLinks, type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { CompanyBadge } from '../FuelCardBoard';
import {
  Btn,
  Card,
  CarChip,
  DIVIDE,
  FOCUS,
  FootLink,
  I,
  Icon,
  IconTile,
  LiveChip,
  MUTED,
  N,
  RED,
  RULE,
  STRONG,
  TH,
  TH_ROW,
  TITLE,
  TONE,
  Tag,
  WELL,
  cn,
  type IconPath,
  type Tone,
} from './dash-kit';
import { Amount, Phrase, SectionError, count, useNoun, type MixedTabProps } from './dash-shell';
import {
  BandHead,
  Big,
  BigMoney,
  BlockFoot,
  BlockHead,
  COUNT_CHIP,
  NoteLine,
  ReadBand,
  WORDS,
} from './dash-blocks';
import {
  COMPANY_TONE,
  CompanyWord,
  Dash,
  Day,
  Dual,
  EndLine,
  FOOT,
  Money,
  nowView,
  useFuelWords,
  type SectionView,
} from './tab-fuel-words';

type Charging = NonNullable<FleetDashboardNowDto['fuelCharging']>;
type Cards = NonNullable<FleetDashboardNowDto['fuelCards']>;
type CardList = NonNullable<FleetDashboardNowDto['fuelCardList']>;
type Sheets = NonNullable<FleetDashboardNowDto['fuelSheets']>;

/** The companies in the register's order: Wataniya, then Chill Out. */
const COMPANIES: readonly FleetFuelCardCompany[] = ['wataniya', 'chillout'];

// ── 1 · The six KPIs ──────────────────────────────────────────────────────────────────────────

/**
 * A «الآن» card (the approved Kpi look): the edge, the dot title, the icon tile, the hero (the one
 * figure that opens its list), the line under it, an optional red line, the grey band at its foot.
 * A balance card's dot is its company's register colour on a neutral card (C1).
 */
const FuelKpi = ({
  id,
  tone,
  dot,
  icon,
  title,
  figure,
  sub,
  red,
  foot,
  footIcon,
}: {
  id: string;
  tone: Tone;
  dot?: Tone;
  icon: IconPath;
  title: ReactNode;
  figure: ReactNode;
  sub?: ReactNode;
  red?: ReactNode;
  foot: ReactNode;
  footIcon: IconPath;
}): JSX.Element => (
  <Card accent={tone} data-fuel-kpi={id} data-fuel-tone={tone}>
    <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap pt-1')}>
          <span
            aria-hidden="true"
            data-fuel-dot={dot ?? tone}
            className={cn('h-2 w-2 shrink-0 rounded-full', TONE[dot ?? tone].dot)}
          />
          {title}
        </h3>
        <IconTile d={icon} tone={tone} />
      </div>
      <div className="mt-3 flex h-10 items-end gap-x-2 pb-0.5">{figure}</div>
      <div
        data-fuel-sub={id}
        className={cn('mt-3 flex h-6 items-center whitespace-nowrap text-[13px] leading-6', MUTED)}
      >
        {sub}
      </div>
      {red !== undefined && (
        <div
          data-fuel-red={id}
          className={cn(
            'flex h-6 items-center whitespace-nowrap text-[13px] font-bold leading-6',
            RED,
          )}
        >
          {red}
        </div>
      )}
    </div>
    <div data-fuel-foot={id} className={FOOT}>
      <Icon d={footIcon} className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0">{foot}</span>
    </div>
  </Card>
);

/** «أرصدة وطنية» — the company's word in its register colour, beside its register dot. */
const BalanceTitle = ({ company }: { company: FleetFuelCardCompany }): JSX.Element => {
  const w = useFuelWords();
  return (
    <span>
      <Phrase text={w('kpi.balances')} parts={{ company: <CompanyWord company={company} /> }} />
    </span>
  );
};

/** The two balances, the requests, the low cards and today's top-ups (`fuelCharging`). */
const ChargingKpis = ({ c, links }: { c: Charging; links: NowLinks }): JSX.Element => {
  const t = useT();
  const w = useFuelWords();
  const noun = useNoun();
  return (
    <>
      {COMPANIES.map((company) => (
        <FuelKpi
          key={company}
          id={company}
          tone="slate"
          dot={COMPANY_TONE[company]}
          icon={I.card}
          title={<BalanceTitle company={company} />}
          figure={<BigMoney value={c[company]} link={links.chargingCompany(company)} />}
          footIcon={I.layers}
          foot={<Dual n={c.companyCards[company]} noun="card" />}
        />
      ))}
      <FuelKpi
        id="requests"
        tone="amber"
        icon={I.wallet}
        title={t('fleet.fuelCards.totals.requested')}
        figure={<BigMoney value={c.requested.amount} link={links.charging('requested')} />}
        sub={<Dual n={c.requested.count} noun="request" />}
        footIcon={I.info}
        foot={w('kpi.requests.foot')}
      />
      <FuelKpi
        id="low"
        tone="amber"
        icon={I.warn}
        title={t('fleet.fuelCards.filters.low')}
        figure={
          <>
            <Big link={links.charging('low')}>{count(c.low.belowYellow)}</Big>
            <span className={WORDS}>{noun('card', c.low.belowYellow)}</span>
          </>
        }
        sub={
          <span data-fuel-yellow={String(c.low.yellowAt)}>
            <Phrase
              text={w('kpi.low.sub')}
              parts={{
                amount: (
                  <Amount value={c.low.yellowAt} className="text-slate-600 dark:text-slate-300" />
                ),
              }}
            />
          </span>
        }
        red={
          c.low.belowRed > 0 ? (
            <span data-fuel-below-red={String(c.low.belowRed)}>
              <Phrase
                text={w('kpi.low.red')}
                parts={{
                  cards: <Dual n={c.low.belowRed} noun="card" figure={RED} />,
                  amount: <Amount value={c.low.redAt} />,
                }}
              />
            </span>
          ) : undefined
        }
        footIcon={I.cog}
        foot={w('kpi.low.foot')}
      />
      <FuelKpi
        id="charged"
        tone="emerald"
        icon={I.bolt}
        title={t('fleet.fuelCards.totals.chargedOnCairoDay')}
        figure={<BigMoney value={c.charged24h} link={links.charging('charged')} />}
        sub={t('fleet.fuelCards.board.charge.chargedTodayNote')}
        footIcon={I.info}
        foot={w('kpi.charged.foot')}
      />
    </>
  );
};

/** «تنتهي خلال N يومًا» — the window, its nearest day, and the expired cards as a red link. */
const ExpiryKpi = ({ f, links }: { f: Cards; links: NowLinks }): JSX.Element => {
  const w = useFuelWords();
  const noun = useNoun();
  const expired = links.fuelCardsExpired();
  return (
    <FuelKpi
      id="expiring"
      tone="amber"
      icon={I.calendar}
      title={
        <Phrase
          text={w('kpi.expiring.title')}
          // The window in the title's own face, as the approved card writes it.
          parts={{ count: count(f.warnDays), noun: noun('day', f.warnDays) }}
        />
      }
      figure={
        <>
          <Big link={links.fuelCardsExpiring(f.warnDays)}>{count(f.expiring)}</Big>
          <span className={WORDS}>{noun('card', f.expiring)}</span>
        </>
      }
      sub={
        f.nearest === null ? undefined : (
          <span data-fuel-nearest={f.nearest}>
            <Phrase
              text={w('kpi.expiring.nearest')}
              parts={{ day: <Day ymd={f.nearest} className={STRONG} /> }}
            />
          </span>
        )
      }
      red={
        f.expired > 0 ? (
          <Link
            to={expired.to}
            data-metric={expired.metric}
            data-fuel-expired={String(f.expired)}
            className={cn('inline-flex items-center gap-1 hover:underline', RED, FOCUS)}
          >
            <Phrase
              text={w('kpi.expiring.expired')}
              parts={{ cards: <Dual n={f.expired} noun="card" figure={RED} /> }}
            />
            <Icon d={I.arrow} className="h-3.5 w-3.5" />
          </Link>
        ) : undefined
      }
      footIcon={I.cog}
      foot={w('kpi.expiring.foot')}
    />
  );
};

// ── 2 · The cards on no car (the company view only) ───────────────────────────────────────────

const NoCarNote = ({ c }: { c: Charging }): JSX.Element | null => {
  const w = useFuelWords();
  const free = c.unassigned;
  // `null` whenever the reader's branches narrow: such a card is in no branch.
  if (free === null || free.count === 0) return null;
  return (
    <div className="mt-3 px-1">
      <NoteLine>
        <span data-fuel-nocar={String(free.count)} data-fuel-nocar-balance={String(free.balance)}>
          <Phrase
            text={w('noCar')}
            parts={{
              cards: <Dual n={free.count} noun="card" />,
              amount: (
                <Amount value={free.balance} className="text-slate-600 dark:text-slate-300" />
              ),
            }}
          />
        </span>
      </NoteLine>
    </div>
  );
};

// ── 3 · «مطابقة شيت شركة الوقود» ──────────────────────────────────────────────────────────────

/** One figure of a sheet half: its name over its value. A statement stands alone, centred. Plain
 *  text: no screen reopens a stored sheet, so no figure here opens a list. */
const SheetCell = ({
  id,
  label,
  span,
  children,
}: {
  id: string;
  /** No label: the cell is one statement, centred. */
  label?: string;
  span?: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-fuel-sheet-cell={id}
    className={cn(
      WELL,
      'flex min-h-[72px] min-w-0 flex-col gap-1 px-4 py-3',
      label === undefined ? 'items-center justify-center text-center' : 'justify-between',
      span,
    )}
  >
    {label !== undefined && (
      <span
        className={cn(
          'whitespace-nowrap text-xs font-bold max-sm:whitespace-normal dark:font-semibold',
          MUTED,
        )}
      >
        {label}
      </span>
    )}
    <span className={cn('block min-h-6 text-[15px] font-bold leading-6', STRONG)}>{children}</span>
  </div>
);

/** A statement in the emerald of «nothing waits» («بُتّ فيها كلها»). */
const Settled = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className={cn('inline-flex items-center gap-1.5 align-top', TONE.emerald.text)}>
    <Icon d={I.check} className="h-4 w-4 shrink-0" />
    {children}
  </span>
);

const SheetCells = ({ s }: { s: FleetDashboardNowFuelSheetDto }): JSX.Element => {
  const w = useFuelWords();
  const date = (span?: string): JSX.Element => (
    <SheetCell id="date" label={w('sheets.last')} {...(span === undefined ? {} : { span })}>
      {s.sheetDate !== null ? (
        <Day ymd={s.sheetDate} className={STRONG} />
      ) : (
        // A session stored before the sheet's day was recorded: the day it was READ (C8).
        <span data-fuel-read-day={s.readDay} className="font-semibold">
          <Phrase text={w('sheets.readOn')} parts={{ day: <Day ymd={s.readDay} /> }} />
        </span>
      )}
    </SheetCell>
  );
  if (s.differing === 0) {
    return (
      <>
        {date()}
        <SheetCell id="noneDiffering" span="lg:col-span-3">
          <Settled>{w('sheets.noneDiffering')}</Settled>
        </SheetCell>
      </>
    );
  }
  return (
    <>
      {date(s.undecided > 0 ? 'col-span-2 lg:col-span-1' : undefined)}
      <SheetCell id="differing" label={w('sheets.differing')}>
        <Dual n={s.differing} noun="card" />
      </SheetCell>
      {s.undecided > 0 ? (
        <>
          <SheetCell id="undecided" label={w('sheets.undecided')}>
            <N className={TONE.amber.text}>{count(s.undecided)}</N>
          </SheetCell>
          <SheetCell id="net" label={w('sheets.net')} span="col-span-2 lg:col-span-1">
            {s.undecidedNet === 0 ? (
              <Money value={0} />
            ) : (
              <span data-fuel-net={String(s.undecidedNet)}>
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  <Phrase
                    text={w(s.undecidedNet < 0 ? 'sheets.less' : 'sheets.more')}
                    parts={{
                      amount: (
                        <Amount
                          value={Math.abs(s.undecidedNet)}
                          className="text-slate-900 dark:text-white"
                        />
                      ),
                    }}
                  />
                </span>
              </span>
            )}
          </SheetCell>
        </>
      ) : (
        <SheetCell id="decided" span="col-span-2 lg:col-span-2">
          <Settled>{w('sheets.allDecided')}</Settled>
        </SheetCell>
      )}
    </>
  );
};

const SheetHalf = ({
  company,
  s,
  className,
}: {
  company: FleetFuelCardCompany;
  s: FleetDashboardNowFuelSheetDto | null;
  className?: string;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <div
      data-fuel-sheet={company}
      data-fuel-read={s === null ? 'never' : 'read'}
      {...(s === null
        ? {}
        : {
            'data-fuel-differing': String(s.differing),
            'data-fuel-undecided': String(s.undecided),
          })}
      className={cn('flex min-w-0 flex-col gap-3 px-5 py-4', className)}
    >
      <h4 className="flex items-center gap-2 text-[14px] font-bold">
        <span
          aria-hidden="true"
          className={cn('h-2 w-2 shrink-0 rounded-full', TONE[COMPANY_TONE[company]].dot)}
        />
        <CompanyWord company={company} />
      </h4>
      {/* Under lg two columns; from lg the half's four. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_16rem]">
        {s === null ? (
          <SheetCell id="never" span="col-span-2 lg:col-span-4">
            <span className={cn('font-semibold', MUTED)}>{w('sheets.none')}</span>
          </SheetCell>
        ) : (
          <SheetCells s={s} />
        )}
      </div>
    </div>
  );
};

/** «مطابقة شيت شركة الوقود» (Q1 أ): per company, the last sheet as it was READ (C7, C8, C13). */
const SheetCard = ({ sheets, links }: { sheets: Sheets; links: NowLinks }): JSX.Element => {
  const t = useT();
  const w = useFuelWords();
  return (
    <Card data-fuel-block="sheets" className="mt-5">
      <BlockHead
        icon={I.clipboardCheck}
        tone="slate"
        title={w('sheets.title')}
        note={w('sheets.note')}
      />
      {/* The halves side by side from 1800 (as the six cards). */}
      <div className={cn('grid border-t min-[1800px]:grid-cols-2', RULE)}>
        <SheetHalf company="wataniya" s={sheets.wataniya} />
        <SheetHalf
          company="chillout"
          s={sheets.chillout}
          className={cn('border-t min-[1800px]:border-s min-[1800px]:border-t-0', RULE)}
        />
      </div>
      <BlockFoot>
        <FootLink link={links.reconcile('fuelSheets.reconcile')}>
          {t('fleet.fuelCards.reconcile.title')}
        </FootLink>
      </BlockFoot>
    </Card>
  );
};

// ── 4 · «كروت تحتاج متابعة» ───────────────────────────────────────────────────────────────────

/** The register's state words and colours (FuelCardBoard, the charging screen — C3). */
const STATE_TAG: Record<FleetDashboardFuelCardState, { key: string; tone: Tone }> = {
  expired: { key: 'fleet.fuelCards.expiry.expired', tone: 'red' },
  critical: { key: 'fleet.fuelCards.board.charge.critical', tone: 'red' },
  requested: { key: 'fleet.fuelCards.fields.request', tone: 'amber' },
  low: { key: 'fleet.fuelCards.filters.low', tone: 'amber' },
  expiring: { key: 'fleet.fuelCards.expiry.soon', tone: 'amber' },
};

const StateTags = ({ row }: { row: FleetDashboardNowFuelCardRowDto }): JSX.Element => {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.states.map((state) => (
        <span key={state} data-fuel-state={state}>
          <Tag tone={STATE_TAG[state].tone} dot>
            {t(STATE_TAG[state].key)}
          </Tag>
        </span>
      ))}
    </span>
  );
};

/** «…» and the number's last four — the whole number is on the cards screen. */
const tail = (number: string): string => number.replace(/\s+/gu, '').slice(-4);

/** The card: the register's company badge, the number's tail, the company in its colour. */
const CardCell = ({ row }: { row: FleetDashboardNowFuelCardRowDto }): JSX.Element => (
  <div className="flex items-center gap-2.5">
    <CompanyBadge company={row.company} size="xs" />
    <div className="flex min-w-0 flex-col items-start">
      <N className="text-[13px] font-bold leading-5 text-slate-800 dark:text-slate-100">
        …{tail(row.number)}
      </N>
      <CompanyWord
        company={row.company}
        className="whitespace-nowrap text-xs font-bold leading-4"
      />
    </div>
  </div>
);

/** The car and its make (its record for a reader of the registry, while it is in it), or the
 *  card's own name with the register's «بدون سيارة». A car deleted since says so, and opens
 *  nothing. */
const CarCell = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardNowFuelCardRowDto;
  links: NowLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (row.vehicleId === null) {
    return (
      <div data-fuel-car="none" className="flex flex-col items-start gap-1">
        <span className={cn('whitespace-nowrap text-[13px] font-bold', STRONG)}>
          {row.label ?? '—'}
        </span>
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {t('fleet.fuelCards.noCar')}
        </span>
      </div>
    );
  }
  const record: DashLink | null =
    canVehicle && !row.vehicleDeleted ? links.vehicle(row.vehicleId, 'fuelCardList.vehicle') : null;
  return (
    <div
      data-fuel-car={row.code ?? ''}
      {...(row.vehicleDeleted ? { 'data-fuel-car-deleted': 'true' } : {})}
      className="flex flex-col items-start gap-1"
    >
      <span className="flex items-center gap-1.5">
        <CarChip code={row.code ?? '—'} link={record} />
        {row.vehicleDeleted && <Tag tone="slate">{t('fleet.dash.common.vehicleDeleted')}</Tag>}
      </span>
      {row.typeName !== null && (
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {localized(row.typeName, locale)}
        </span>
      )}
    </div>
  );
};

const CELL = 'px-3 py-3.5 align-middle first:ps-5 last:pe-5';

/** How a table folds into blocks under 1024 px (its 900 px of columns would scroll a tablet):
 *  the first line holds the card (or the car) at the start and the car (or the value) at the end;
 *  every other cell is a line of its own with its column's name, «فتح» across the foot. One DOM,
 *  so a row is never drawn twice. */
export const FOLD = {
  table: 'max-lg:block',
  head: 'max-lg:hidden',
  body: 'max-lg:block max-lg:border-t',
  row: 'max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:items-start max-lg:gap-x-3 max-lg:gap-y-2 max-lg:px-4 max-lg:py-3.5',
  cell: 'max-lg:block max-lg:p-0 max-lg:first:ps-0 max-lg:last:pe-0',
  start: 'max-lg:col-start-1 max-lg:row-start-1',
  end: 'max-lg:col-start-2 max-lg:row-start-1',
  line: 'max-lg:col-span-2',
  label: 'lg:hidden',
  scroll: 'lg:overflow-x-auto',
} as const;

/** A column's name beside its value, while the row is a block (the heading says it after). */
export const PhoneLabel = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className={cn('me-1.5 text-xs font-semibold', FOLD.label, MUTED)}>{children}</span>
);

const CardRow = ({
  row,
  links,
  canVehicle,
}: {
  row: FleetDashboardNowFuelCardRowDto;
  links: NowLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useFuelWords();
  return (
    <tr
      data-fuel-card={row.cardId}
      data-fuel-states={row.states.join(',')}
      className={cn(FOLD.row)}
    >
      <td className={cn(CELL, FOLD.cell, FOLD.start)}>
        <CardCell row={row} />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.end)}>
        <CarCell row={row} links={links} canVehicle={canVehicle} />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('cards.col.balance')}</PhoneLabel>
        <Money value={row.balance} className="text-[13px]" />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('cards.col.request')}</PhoneLabel>
        {row.requestedAmount === null ? (
          <Dash />
        ) : (
          <Money value={row.requestedAmount} className="text-[13px]" />
        )}
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'whitespace-nowrap')}>
        <PhoneLabel>{w('cards.col.expires')}</PhoneLabel>
        {row.expiresAt === null ? <Dash /> : <Day ymd={row.expiresAt} />}
      </td>
      {/* As a block, the states stand right under the card and its car (the approved phone). */}
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'max-lg:row-start-2')}>
        <StateTags row={row} />
      </td>
      <td className={cn(CELL, FOLD.cell, FOLD.line, 'text-end')}>
        <Btn link={links.fuelCardRow(row)} className="h-9 px-4 max-lg:w-full">
          {w('open')}
        </Btn>
      </td>
    </tr>
  );
};

/** «كروت تحتاج متابعة» (Q2 أ): the cards with a state now, the most urgent first. */
const CardsTable = ({
  list,
  warnDays,
  links,
  canVehicle,
}: {
  list: CardList;
  /** The expiry window (`fuelCards.warnDays`); `null` when that section is not drawn. */
  warnDays: number | null;
  links: NowLinks;
  canVehicle: boolean;
}): JSX.Element => {
  const w = useFuelWords();
  const noun = useNoun();
  const th = cn(CELL, TH, 'py-2.5 text-start');
  const days = (n: number): Record<string, ReactNode> => ({
    count: <N>{count(n)}</N>,
    noun: noun('day', n),
  });
  return (
    <Card data-fuel-block="cards" className="mt-5">
      <BlockHead
        icon={I.card}
        tone="amber"
        title={w('cards.title')}
        note={
          warnDays === null ? (
            w('cards.noteSoon')
          ) : (
            <Phrase text={w('cards.note')} parts={days(warnDays)} />
          )
        }
        chips={
          <span
            data-fuel-chip="cards"
            data-fuel-total={String(list.total)}
            className={cn(COUNT_CHIP, TONE.amber.soft)}
          >
            <Dual n={list.total} noun="card" />
          </span>
        }
      />
      {list.rows.length === 0 ? (
        <EndLine marker="cards">{w('cards.empty')}</EndLine>
      ) : (
        <div className={FOLD.scroll}>
          <table
            className={cn(
              'w-full border-collapse text-[13px] lg:min-w-[900px] lg:table-fixed',
              FOLD.table,
            )}
          >
            <colgroup className={FOLD.head}>
              <col className="w-[17%]" />
              <col className="w-[19%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
              <col />
              <col className="w-[104px]" />
            </colgroup>
            <thead className={cn(TH_ROW, FOLD.head)}>
              <tr className={cn('border-y', RULE)}>
                <th className={th}>{w('cards.col.card')}</th>
                <th className={th}>{w('cards.col.vehicle')}</th>
                <th className={th}>{w('cards.col.balance')}</th>
                <th className={th}>{w('cards.col.request')}</th>
                <th className={th}>{w('cards.col.expires')}</th>
                <th className={th}>{w('cards.col.state')}</th>
                <th className={cn(CELL, 'py-2.5')}>
                  <span className="sr-only">{w('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, FOLD.body, RULE)}>
              {list.rows.map((row) => (
                <CardRow key={row.cardId} row={row} links={links} canVehicle={canVehicle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BlockFoot>
        {/* Only when the server flagged more cards than the table lists (`total`, never the
            rows' length). */}
        {list.total > list.rows.length && (
          <span data-fuel-first={String(list.total)} className={cn('text-xs font-semibold', MUTED)}>
            <Phrase
              text={w('cards.first')}
              parts={{
                count: <N>{count(FLEET_DASHBOARD_FUEL_CARD_ROWS)}</N>,
                noun: noun('card', FLEET_DASHBOARD_FUEL_CARD_ROWS),
              }}
            />
          </span>
        )}
        <FootLink link={links.chargingStates(['requested', 'low'])}>
          {w('cards.toCharging')}
        </FootLink>
        {warnDays !== null && (
          <FootLink link={links.fuelCardsDue(warnDays)}>
            <Phrase text={w('cards.toExpiry')} parts={days(warnDays)} />
          </FootLink>
        )}
      </BlockFoot>
    </Card>
  );
};

// ── The band ──────────────────────────────────────────────────────────────────────────────────

/** R1 on its way: the six cards in grey, never zeroes pretending to be data. */
const NowSkeleton = (): JSX.Element => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-6">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} className="h-52 rounded-2xl" />
    ))}
  </div>
);

/** A section's figures only when this reader may see them (the view says so). */
const shown = <T,>(view: SectionView, value: T | null | undefined): T | null =>
  view === 'shown' ? (value ?? null) : null;

export const FuelNowBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useFuelWords();
  const { now, can, nowPending } = props;
  const views = {
    fuelCards: nowView(now, can, 'fuelCards'),
    fuelCharging: nowView(now, can, 'fuelCharging'),
    fuelCardList: nowView(now, can, 'fuelCardList'),
    fuelSheets: nowView(now, can, 'fuelSheets'),
  };
  const charging = shown(views.fuelCharging, now?.fuelCharging);
  const cards = shown(views.fuelCards, now?.fuelCards);
  const list = shown(views.fuelCardList, now?.fuelCardList);
  const sheets = shown(views.fuelSheets, now?.fuelSheets);
  const links = now === null ? null : nowLinks(now);
  const failed = (section: keyof typeof views): boolean => views[section] === 'failed';
  return (
    <section data-fuel-band="now" aria-label={w('now')}>
      <BandHead id="now" tone="emerald" first title={w('now')} chips={<LiveChip />} />
      <ReadBand
        state={nowPending?.state ?? 'ready'}
        error={nowPending?.error ?? null}
        onRetry={props.onRetry}
        skeleton={<NowSkeleton />}
      >
        {(failed('fuelCharging') || failed('fuelCards')) && (
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {failed('fuelCharging') && (
              <SectionError section="fuelCharging" onRetry={props.onRetry} />
            )}
            {failed('fuelCards') && <SectionError section="fuelCards" onRetry={props.onRetry} />}
          </div>
        )}
        {links !== null && (charging !== null || cards !== null) && (
          <div
            data-fuel-kpis="now"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-6"
          >
            {charging !== null && <ChargingKpis c={charging} links={links} />}
            {cards !== null && <ExpiryKpi f={cards} links={links} />}
          </div>
        )}
        {charging !== null && <NoCarNote c={charging} />}
        {failed('fuelSheets') && (
          <SectionError section="fuelSheets" onRetry={props.onRetry} className="mt-5" />
        )}
        {links !== null && sheets !== null && <SheetCard sheets={sheets} links={links} />}
        {failed('fuelCardList') && (
          <SectionError section="fuelCardList" onRetry={props.onRetry} className="mt-5" />
        )}
        {links !== null && list !== null && (
          <CardsTable
            list={list}
            warnDays={cards?.warnDays ?? null}
            links={links}
            canVehicle={can('fleetVehicle.view')}
          />
        )}
      </ReadBand>
    </section>
  );
};
