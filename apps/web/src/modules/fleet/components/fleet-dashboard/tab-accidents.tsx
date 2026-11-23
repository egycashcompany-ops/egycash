// «الحوادث ومطالبات التأمين» — the owner-approved sample (approved/acc-dark.png, acc-branch-dark.png;
// harness zz-accidents.tsx; DECISIONS §6, «اعمل اللى انت بتفضله» = every recommendation), a tab of
// «الآن» and a period both, drawn over the real reads in place of the old «الحوادث» body:
//
//   1  the heading «الحوادث وإخطارات التأمين» — its line names only the parts this reader is shown;
//      «تحديث» refreshes both reads and «آخر تحديث» is the older of the two (the page hands both in)
//   2  «الآن» (R1): «ملفات حوادث مفتوحة» (every date, and what remains on them) beside ONE amber card
//      «إخطارات تأمين مفتوحة» (critic C1/C2: never red), then «إخطارات ينقصها مرفق», the page's full
//      width — at most FLEET_DASHBOARD_NOTICE_ROWS rows, the oldest notice first, as the server sends
//      them. A notice follows its car's branch; one with no car is in the company view only.
//   3  «خلال الفترة» (the page's R2, under the page's own filters): its head, the dashboard's period
//      bar right under it, then «حوادث الفترة» (by accident day) beside «مبالغ ملفات حوادث الفترة»
//      (the register's four totals, in its order and words, as they stand NOW, and the transfers
//      line), then «حوادث الفترة» as a table — at most FLEET_DASHBOARD_ACCIDENT_ROWS rows, open and
//      closed, the newest first — and the page note
//
// EVERY «المتبقي» NAMES ITS BASIS (critic A1): the open files of every date («كل التواريخ»), all the
// period's files («تشمل المفتوحة منها والمغلقة»), and each row as of now («المتبقي (حتى الآن)»).
//
// NOTHING IS COUNTED HERE. Every figure is a field a read sent (`missingAny`, `open`, `count`, the
// totals — never a list's length); «و N أخرى» is `missingAny` less the rows the server caps the table
// at. «صور الرخص», the «ينقصها مرفق» tag, the transfers line and «و N أخرى» have no link: no screen
// lists exactly them. A notice row's «فتح» opens the notices screen on what the notice carries (its
// car, number and day — «the notice and any sharing these»); a notice with none of the three has no
// «فتح». The notices are a table from 1024 px, the period's accidents from 1280 px (under it their
// statement would shrink to a word), each row a block below (no sideways scroll on a phone). There is
// no data bar on this tab; red is for a negative remaining only.
import { type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_NOTICE_ROWS,
  type FleetDashboardNoticeRowDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodAccidentRowDto,
  type FleetDashboardPeriodAccidentTotalsDto,
  type FleetDashboardPeriodDto,
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
import { sectionPermitted, slashDay } from '../../lib/fleet-dashboard-tabs';
import { NOTICE_INSURER } from '../../lib/notice-insurers';
import { DriverHoverText } from '../DriverHoverCard';
import { useEmployeeRecords } from '../EmployeeName';
import {
  BAND,
  BOX,
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
  N,
  RED,
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
  Amount,
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
  Kpi,
  NoteLine,
  RangeChip,
  ReadBand,
  Sep,
  Small,
  WORDS,
} from './dash-blocks';
import { PeriodFilterBar } from './period-filter-bar';

/** The word of a key under the tab's own namespace. */
const useWords = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.accidents.${key}`, params);
};

/** «⇄» before the transfers line: money moved between cars' files (the line opens no list). */
const SWAP: IconPath = ['M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'];

type NowSection = 'accidentsOpen' | 'notices';
type SectionView = 'hidden' | 'shown' | 'failed';

/** An R1 section as this reader meets it: not theirs, drawn, or failed (its error in its place). */
const nowState = (
  now: FleetDashboardNowDto | null,
  section: NowSection,
  can: (permission: string) => boolean,
): SectionView => {
  if (now === null || !sectionPermitted(section, can)) return 'hidden';
  if (now.unavailable.includes(section)) return 'failed';
  return now[section] === null ? 'hidden' : 'shown';
};

/** An R2 section of this tab, the same way. */
const periodState = (
  data: FleetDashboardPeriodDto,
  section: 'accidents' | 'accidentList',
): SectionView => {
  if (data.unavailable.includes(section)) return 'failed';
  return data[section] === null ? 'hidden' : 'shown';
};

/** A 0.00 amount reads muted wherever it stands (the tiles, the lines, the table). */
const ZERO = '!text-slate-500 dark:!text-slate-400';

/** An amount and «ج.م.»: red with «−» when negative, muted at 0.00, and opening its list when given
 *  a link. */
const Money = ({
  value,
  link = null,
  className,
}: {
  value: number;
  link?: DashLink | null;
  className?: string;
}): JSX.Element => (
  <Fig link={link} className={value < 0 ? RED : STRONG}>
    <Amount value={value} className={cn(className, value === 0 && ZERO)} />
  </Fig>
);

/** The car and its make, the tables' first column. */
const CarCell = ({
  code,
  typeName,
}: {
  code: string;
  typeName: LocalizedString | null;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div data-acc-car={code} className="flex flex-col items-start gap-1">
      <CarChip code={code} />
      {typeName !== null && (
        <span className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}>
          {localized(typeName, locale)}
        </span>
      )}
    </div>
  );
};

/** A day as the dashboard writes it: «2026/11/09», no time; «—» when none is recorded. */
const Day = ({ ymd }: { ymd: string | null }): JSX.Element =>
  ymd === null ? (
    <span className={MUTED}>—</span>
  ) : (
    <N className="font-semibold text-slate-700 dark:text-slate-200">{slashDay(ymd)}</N>
  );

/** A table's end in words: that it is empty, or what it leaves out. */
const EndRow = ({ marker, children }: { marker: string; children: ReactNode }): JSX.Element => (
  <div
    data-acc-end={marker}
    className={cn(
      'flex items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
      RULE,
      MUTED,
    )}
  >
    {children}
  </div>
);

// ── The tables: a table on a wide screen, each row a block under it (no sideways scroll on a phone) ──

const CELL = 'px-4 py-3.5 align-middle first:ps-5 last:pe-5';

/** How a table folds into blocks under its breakpoint: the row's first line holds the car at the
 *  start and «فتح» at the end, every other cell a line of its own with its column's name. */
interface Fold {
  table: string;
  head: string;
  body: string;
  row: string;
  cell: string;
  car: string;
  open: string;
  line: string;
  /** The column's name beside a value: shown only while the row is a block. */
  label: string;
  scroll: string;
}

/** «إخطارات ينقصها مرفق»: a table from 1024 px (its columns are short). */
const NOTICE_FOLD: Fold = {
  table: 'max-lg:block',
  head: 'max-lg:hidden',
  body: 'max-lg:block max-lg:border-t',
  row: 'max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:px-4 max-lg:py-3.5',
  cell: 'max-lg:block max-lg:p-0 max-lg:first:ps-0 max-lg:last:pe-0',
  car: 'max-lg:col-start-1 max-lg:row-start-1',
  open: 'max-lg:col-start-2 max-lg:row-start-1',
  line: 'max-lg:col-span-2',
  label: 'lg:hidden',
  scroll: 'lg:overflow-x-auto',
};

/** «حوادث الفترة»: a table from 1280 px — under it the statement's column would shrink to a word,
 *  so a row is a block there and the statement keeps a line of its own. */
const LIST_FOLD: Fold = {
  table: 'max-xl:block',
  head: 'max-xl:hidden',
  body: 'max-xl:block max-xl:border-t',
  row: 'max-xl:grid max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:items-center max-xl:gap-x-3 max-xl:gap-y-2 max-xl:px-4 max-xl:py-3.5',
  cell: 'max-xl:block max-xl:p-0 max-xl:first:ps-0 max-xl:last:pe-0',
  car: 'max-xl:col-start-1 max-xl:row-start-1',
  open: 'max-xl:col-start-2 max-xl:row-start-1',
  line: 'max-xl:col-span-2',
  label: 'xl:hidden',
  scroll: 'xl:overflow-x-auto',
};

/** A column's name beside its value, while the row is a block (the table's heading says it after). */
const PhoneLabel = ({ fold, children }: { fold: Fold; children: ReactNode }): JSX.Element => (
  <span className={cn('me-1.5 text-xs font-semibold', fold.label, MUTED)}>{children}</span>
);

// ── 1 · The heading ───────────────────────────────────────────────────────────────────────────

const Heading = ({
  props,
  files,
  notices,
  period,
}: {
  props: MixedTabProps;
  files: boolean;
  notices: boolean;
  period: boolean;
}): JSX.Element => {
  const w = useWords();
  const nowPart =
    files && notices
      ? w('headingSub.both')
      : files
        ? w('headingSub.files')
        : notices
          ? w('headingSub.notices')
          : null;
  const periodPart = period ? w('headingSub.period') : null;
  const line =
    nowPart !== null && periodPart !== null
      ? w('headingSub.line', { now: nowPart, period: periodPart })
      : nowPart !== null || periodPart !== null
        ? w('headingSub.one', { part: nowPart ?? periodPart ?? '' })
        : null;
  return (
    <TabHead
      icon={I.shield}
      title={w('heading')}
      live={false}
      sub={line === null ? undefined : line.charAt(0).toUpperCase() + line.slice(1)}
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

// ── 2 · «الآن»: the open files, the open notices, and the notices that lack an attachment ──────

/** Below 1280 px a «الآن» card is too narrow for the notices' two rules on one line (they stack);
 *  both feet then keep that height, so the pair's bands stay level. */
const NOW_FOOT = 'flex max-xl:min-h-10 items-center';

const FilesKpi = ({
  files,
  links,
}: {
  files: NonNullable<FleetDashboardNowDto['accidentsOpen']>;
  links: NowLinks;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  return (
    <Kpi
      id="accidentsOpen"
      data-acc-kpi="files"
      tone="rose"
      icon={I.clipboard}
      title={w('files.title')}
      tag={
        <Tag tone="rose" dot>
          {w('files.tag')}
        </Tag>
      }
      figure={
        <>
          <Big link={links.accidentsOpen()}>{count(files.count)}</Big>
          <span className={WORDS}>{noun('file', files.count)}</span>
        </>
      }
      sub={
        <span
          data-acc-files-remaining={String(files.remaining)}
          className={cn('flex items-center gap-1.5 whitespace-nowrap', MUTED)}
        >
          {w('files.remaining')}
          <Money value={files.remaining} className="text-[13px]" />
        </span>
      }
      foot={
        <span className={NOW_FOOT}>
          <FootLink link={links.accidentsOpenAll()}>{w('files.all')}</FootLink>
        </span>
      }
    />
  );
};

const NoticesKpi = ({
  notices,
  links,
}: {
  notices: NonNullable<FleetDashboardNowDto['notices']>;
  links: NowLinks;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  return (
    <Kpi
      id="notices"
      data-acc-kpi="notices"
      tone="amber"
      icon={I.paperclip}
      title={w('notices.title')}
      tag={
        <span data-acc-missing-tag={String(notices.missingAny)}>
          <Tag tone="amber" dot>
            <Phrase
              text={w('notices.missingTag')}
              parts={{ count: <N>{count(notices.missingAny)}</N> }}
            />
          </Tag>
        </span>
      }
      figure={
        <>
          <Big link={links.noticesOpenAll()}>{count(notices.open)}</Big>
          <span className={WORDS}>{noun('notice', notices.open)}</span>
        </>
      }
      sub={
        <span data-acc-notice-parts="true" className={cn('whitespace-nowrap', MUTED)}>
          {w('notices.licences')} <Small>{count(notices.missingLicences)}</Small>
          <Sep />
          {w('notices.cheque')}{' '}
          <Small link={links.noticesCheckImage()}>{count(notices.missingCheckImage)}</Small>
        </span>
      }
      footIcon={I.info}
      foot={
        <span data-acc-notice-rules="true" className={cn(NOW_FOOT, MUTED)}>
          <span className="flex flex-col gap-0.5 xl:block">
            <span>{w('notices.once')}</span>
            <span className="hidden xl:inline">
              <Sep />
            </span>
            <span>{w('notices.rule')}</span>
          </span>
        </span>
      }
    />
  );
};

/** «صور الرخص» / «صورة الشيك» — what a notice still owes, in the warning amber (never red). */
const MissingTag = ({ id, children }: { id: string; children: ReactNode }): JSX.Element => (
  <span data-acc-missing={id}>
    <Tag tone="amber" dot>
      {children}
    </Tag>
  </span>
);

const NoticeRow = ({
  row,
  links,
}: {
  row: FleetDashboardNoticeRowDto;
  links: NowLinks;
}): JSX.Element => {
  const w = useWords();
  const F = NOTICE_FOLD;
  const licences = row.missing.vehicleLicense || row.missing.driverLicense;
  const open = links.noticeRow({ code: row.code, number: row.noticeNumber, date: row.noticeDate });
  return (
    <tr data-notice-row={row.noticeId} className={F.row}>
      <td className={cn(CELL, F.cell, F.car)}>
        {row.code === null ? (
          <span data-acc-car="none" className={cn('text-xs font-semibold', MUTED)}>
            {w('missing.noVehicle')}
          </span>
        ) : (
          <CarCell code={row.code} typeName={row.typeName} />
        )}
      </td>
      <td className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel fold={F}>{w('missing.col.insurer')}</PhoneLabel>
        <span data-acc-insurer={row.template} className={cn('font-bold', STRONG)}>
          {NOTICE_INSURER[row.template]}
        </span>
      </td>
      <td className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel fold={F}>{w('missing.col.number')}</PhoneLabel>
        {row.noticeNumber === null ? (
          <span className={MUTED}>—</span>
        ) : (
          <N className={cn('font-bold', STRONG)}>{row.noticeNumber}</N>
        )}
      </td>
      <td data-acc-date="true" className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel fold={F}>{w('missing.col.date')}</PhoneLabel>
        <Day ymd={row.noticeDate} />
      </td>
      <td className={cn(CELL, F.cell, F.line)}>
        <div className="flex flex-wrap items-center gap-1.5">
          {licences && <MissingTag id="licences">{w('notices.licences')}</MissingTag>}
          {row.missing.checkImage && <MissingTag id="cheque">{w('notices.cheque')}</MissingTag>}
        </div>
      </td>
      <td className={cn(CELL, F.cell, F.open, 'text-end')}>
        {open !== null && (
          <Btn link={open} className="h-9 px-4">
            {w('openRow')}
          </Btn>
        )}
      </td>
    </tr>
  );
};

const NoticesTable = ({
  notices,
  links,
}: {
  notices: NonNullable<FleetDashboardNowDto['notices']>;
  links: NowLinks;
}): JSX.Element => {
  const w = useWords();
  const noun = useNoun();
  const F = NOTICE_FOLD;
  // The rows the server left out: its count less the rows it caps the table at — never a length.
  const more = notices.missingAny - FLEET_DASHBOARD_NOTICE_ROWS;
  // `null` for a reader whose reach holds no branch (D21): no foot link, never the whole company.
  const cheque = links.noticesCheckImage();
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-acc-block="notices" className="mt-5">
      <BlockHead
        icon={I.paperclip}
        tone="amber"
        title={w('missing.title')}
        note={w('missing.note')}
        chips={
          <span data-acc-chip="notices" className={cn(COUNT_CHIP, TONE.amber.soft)}>
            <N>{count(notices.missingAny)}</N> {noun('notice', notices.missingAny)}
          </span>
        }
      />
      {notices.rows.length === 0 ? (
        <EndRow marker="notices">
          <IconTile d={I.tick} tone="emerald" size="sm" />
          <span>{w('missing.empty')}</span>
        </EndRow>
      ) : (
        <>
          <div className={F.scroll}>
            <table className={cn('w-full border-collapse text-[13px] lg:min-w-[820px]', F.table)}>
              <thead className={cn(TH_ROW, F.head)}>
                <tr className={cn('border-y', RULE)}>
                  <th className={cn(th, 'w-[22%]')}>{w('missing.col.vehicle')}</th>
                  <th className={cn(th, 'w-[16%]')}>{w('missing.col.insurer')}</th>
                  <th className={cn(th, 'w-[13%]')}>{w('missing.col.number')}</th>
                  <th className={cn(th, 'w-[13%]')}>{w('missing.col.date')}</th>
                  <th className={th}>{w('missing.col.missing')}</th>
                  <th className={cn(CELL, 'w-px py-2.5')}>
                    <span className="sr-only">{w('openRow')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className={cn(DIVIDE, F.body, RULE)}>
                {notices.rows.map((row) => (
                  <NoticeRow key={row.noticeId} row={row} links={links} />
                ))}
              </tbody>
            </table>
          </div>
          {more > 0 && (
            <EndRow marker="notices-more">
              <span data-acc-more="notices">
                <Phrase text={w('missing.more')} parts={{ count: <N>{count(more)}</N> }} />
              </span>
            </EndRow>
          )}
        </>
      )}
      <BlockFoot>
        <FootLink link={links.noticesOpenAll('notices.all')}>
          <span data-acc-foot="open">
            <Phrase text={w('missing.allOpen')} parts={{ count: <N>{count(notices.open)}</N> }} />
          </span>
        </FootLink>
        <FootLink link={cheque && { ...cheque, metric: 'notices.missingCheckImage.all' }}>
          <span data-acc-foot="cheque">
            <Phrase
              text={w('missing.noCheque')}
              parts={{ count: <N>{count(notices.missingCheckImage)}</N> }}
            />
          </span>
        </FootLink>
      </BlockFoot>
    </Card>
  );
};

/** R1 on its way: its cards and the notices table in grey, never zeroes pretending to be data. */
const NowSkeleton = ({ cards, table }: { cards: number; table: boolean }): JSX.Element => (
  <div className="space-y-5">
    {cards > 0 && (
      <div className={cn('grid grid-cols-1 gap-4', cards > 1 && 'md:grid-cols-2')}>
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
  const filesState = nowState(now, 'accidentsOpen', can);
  const noticesState = nowState(now, 'notices', can);
  const links = now === null ? null : nowLinks(now);
  // A section's figures only when this reader may see it (its state says so), never because the
  // read happened to carry them.
  const files = filesState === 'shown' ? (now?.accidentsOpen ?? null) : null;
  const notices = noticesState === 'shown' ? (now?.notices ?? null) : null;

  const cards: ReactNode[] = [];
  if (links !== null) {
    if (filesState === 'failed') {
      cards.push(<SectionError key="files" section="accidentsOpen" onRetry={props.onRetry} />);
    } else if (files !== null) {
      cards.push(<FilesKpi key="files" files={files} links={links} />);
    }
    if (noticesState === 'failed') {
      cards.push(<SectionError key="notices" section="notices" onRetry={props.onRetry} />);
    } else if (notices !== null) {
      cards.push(<NoticesKpi key="notices" notices={notices} links={links} />);
    }
  }
  // One card takes the row's full width when the other is not this reader's.
  const width = (filesState === 'hidden' ? 0 : 1) + (noticesState === 'hidden' ? 0 : 1);
  const pendingCards =
    (sectionPermitted('accidentsOpen', can) ? 1 : 0) + (sectionPermitted('notices', can) ? 1 : 0);

  return (
    <section data-acc-band="now" aria-label={w('now')}>
      <BandHead id="now" tone="emerald" first title={w('now')} chips={<LiveChip />} />
      <ReadBand
        state={nowPending?.state ?? 'ready'}
        error={nowPending?.error ?? null}
        onRetry={props.onRetry}
        skeleton={<NowSkeleton cards={pendingCards} table={sectionPermitted('notices', can)} />}
      >
        {width > 0 && (
          <div
            data-acc-kpis="now"
            className={cn('grid grid-cols-1 gap-4', width > 1 && 'md:grid-cols-2')}
          >
            {cards}
          </div>
        )}
        {links !== null && notices !== null && <NoticesTable notices={notices} links={links} />}
      </ReadBand>
    </section>
  );
};

// ── 3 · «خلال الفترة»: the period's count, the money of its files, its accidents ────────────────

type Accidents = NonNullable<FleetDashboardPeriodDto['accidents']>;
type AccidentList = NonNullable<FleetDashboardPeriodDto['accidentList']>;

const PeriodKpi = ({
  accidents,
  links,
}: {
  accidents: Accidents;
  links: PeriodLinks;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  const noun = useNoun();
  return (
    <Kpi
      id="accidents"
      data-acc-kpi="period"
      tone="sky"
      icon={I.calendar}
      title={t('fleet.dash.accidents.title')}
      tag={
        <Tag tone="sky" dot>
          {w('period.tag')}
        </Tag>
      }
      figure={
        <>
          <Big link={links.accidents('accidents.count')}>{count(accidents.count)}</Big>
          <span className={WORDS}>{noun('accident', accidents.count)}</span>
        </>
      }
      sub={
        <span
          data-acc-period-open={String(accidents.open)}
          className={cn('whitespace-nowrap', MUTED)}
        >
          <Phrase
            text={w('period.open')}
            parts={{
              count: (
                <Small link={links.accidents('accidents.open', 'open')}>
                  {count(accidents.open)}
                </Small>
              ),
            }}
          />
        </span>
      }
      foot={<FootLink link={links.accidents('accidents.period')}>{w('period.all')}</FootLink>}
    />
  );
};

/** The register's «الإحصائيات» order, words and icons (AccidentsPage; `fleet.accidents.totals.*`). */
const MONEY_TILES: readonly {
  key: keyof Pick<
    FleetDashboardPeriodAccidentTotalsDto,
    'amountCollected' | 'companyCost' | 'paidAmount' | 'remaining'
  >;
  icon: IconPath;
  tone: Tone;
}[] = [
  { key: 'amountCollected', icon: I.wallet, tone: 'blue' },
  { key: 'companyCost', icon: I.building, tone: 'violet' },
  { key: 'paidAmount', icon: I.card, tone: 'sky' },
  { key: 'remaining', icon: I.trend, tone: 'emerald' },
];

const MoneyCard = ({
  totals,
  links,
}: {
  totals: FleetDashboardPeriodAccidentTotalsDto;
  links: PeriodLinks;
}): JSX.Element => {
  const t = useT();
  const w = useWords();
  return (
    <Card data-acc-block="money">
      <BlockHead
        icon={I.cash}
        tone="emerald"
        title={w('money.title')}
        note={w('money.note')}
        chips={
          <span data-acc-chip="asNow" className={cn(CHIP, 'inline-flex items-center gap-1 py-1')}>
            <Icon d={I.clock} className="h-3.5 w-3.5 text-slate-400" />
            {w('money.asNow')}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-3 px-5 sm:grid-cols-2 xl:grid-cols-4">
        {MONEY_TILES.map((tile) => {
          const value = totals[tile.key];
          const tone: Tone = tile.key === 'remaining' && value < 0 ? 'red' : tile.tone;
          return (
            <div
              key={tile.key}
              data-acc-money={tile.key}
              className={cn(BOX, 'flex min-w-0 flex-col gap-3 px-4 py-3.5')}
            >
              <div className="flex items-center gap-2.5">
                <IconTile d={tile.icon} tone={tone} size="sm" />
                <span className="text-[13px] font-bold text-slate-600 dark:font-semibold dark:text-slate-300">
                  {t(`fleet.accidents.totals.${tile.key}`)}
                </span>
              </div>
              <Money
                value={value}
                link={links.accidents(`accidents.${tile.key}`)}
                className="text-[21px] leading-7"
              />
            </div>
          );
        })}
      </div>
      {/* Money moved between cars' files: the register lists no transfer total, so no link. */}
      <div
        data-acc-transfers="true"
        className={cn(
          'flex flex-wrap items-center gap-x-1 gap-y-1 px-5 pb-4 pt-3 text-[12.5px] font-semibold',
          MUTED,
        )}
      >
        <Icon d={SWAP} className="me-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="whitespace-nowrap">
          {t('fleet.accidents.transferLine.in')}{' '}
          <Money value={totals.transferredIn} className="text-[12.5px]" />
        </span>
        <Sep />
        <span className="whitespace-nowrap">
          {t('fleet.accidents.transferLine.out')}{' '}
          <Money value={totals.transferredOut} className="text-[12.5px]" />
        </span>
      </div>
      <div
        data-acc-formula="true"
        className={cn(
          BAND,
          'mt-auto flex min-h-[46px] items-center gap-2 px-5 py-3 text-[12.5px] font-semibold',
          MUTED,
        )}
      >
        <Icon d={I.info} className="h-4 w-4 shrink-0 text-slate-400" />
        <span>{w('money.formula')}</span>
      </div>
    </Card>
  );
};

/** The driver card on a culprit who is one of ours; the text as written otherwise (R-23). */
const Culprit = ({ row }: { row: FleetDashboardPeriodAccidentRowDto }): JSX.Element => {
  const t = useT();
  const people = useEmployeeRecords(row.culpritEmployeeIds);
  const text = row.culprit ?? t('fleet.dash.accidents.noCulprit');
  if (row.culpritEmployeeIds.length === 0) return <span data-culprit="text">{text}</span>;
  return (
    <DriverHoverText
      people={[...people.values()]}
      className="cursor-pointer font-semibold underline decoration-slate-400 decoration-dotted decoration-[1.5px] underline-offset-[5px] dark:decoration-slate-500"
    >
      <span data-culprit="driver">{text}</span>
    </DriverHoverText>
  );
};

const AccidentRow = ({
  row,
  links,
}: {
  row: FleetDashboardPeriodAccidentRowDto;
  links: PeriodLinks;
}): JSX.Element => {
  const F = LIST_FOLD;
  const t = useT();
  const w = useWords();
  return (
    <tr data-accident-row={row.accidentId} className={F.row}>
      <td className={cn(CELL, F.cell, F.car)}>
        <CarCell code={row.code} typeName={row.typeName} />
      </td>
      <td data-acc-date="true" className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel fold={F}>{w('col.date')}</PhoneLabel>
        <Day ymd={row.date} />
      </td>
      <td className={cn(CELL, F.cell, F.line, 'min-w-0')}>
        {row.statement === '' ? (
          <span className={MUTED}>—</span>
        ) : (
          // One line, the whole text on hover, from 1536 px (as approved). Below it no pointer
          // may hover (a phone) or the column is narrow (1280–1535): the line wraps — up to three
          // lines while the row is a block, two in the table — so the statement stays readable.
          <p
            data-acc-statement={row.accidentId}
            title={row.statement}
            className="truncate text-slate-700 max-2xl:whitespace-normal max-xl:line-clamp-3 xl:max-2xl:line-clamp-2 dark:text-slate-200"
          >
            {row.statement}
          </p>
        )}
      </td>
      <td
        className={cn(
          CELL,
          F.cell,
          F.line,
          'truncate whitespace-nowrap text-slate-700 dark:text-slate-200',
        )}
      >
        <PhoneLabel fold={F}>{w('col.culprit')}</PhoneLabel>
        <Culprit row={row} />
      </td>
      <td className={cn(CELL, F.cell, F.line)}>
        <span data-acc-status={row.status}>
          <Tag tone={row.status === 'open' ? 'amber' : 'slate'} dot>
            {t(`fleet.accidents.status.${row.status}`)}
          </Tag>
        </span>
      </td>
      <td className={cn(CELL, F.cell, F.line, 'whitespace-nowrap')}>
        <PhoneLabel fold={F}>{w('col.remaining')}</PhoneLabel>
        <Money value={row.remaining} className="text-[13px]" />
      </td>
      <td className={cn(CELL, F.cell, F.open, 'text-end')}>
        <Btn link={links.accidentDay(row.code, row.date)} className="h-9 px-4">
          {w('openRow')}
        </Btn>
      </td>
    </tr>
  );
};

const AccidentTable = ({
  list,
  accidents,
  links,
}: {
  list: AccidentList;
  /** The period's count for the chip; `null` when its section is not drawn. */
  accidents: Accidents | null;
  links: PeriodLinks;
}): JSX.Element => {
  const F = LIST_FOLD;
  const t = useT();
  const w = useWords();
  const noun = useNoun();
  const th = cn(CELL, TH, 'py-2.5 text-start');
  return (
    <Card data-acc-block="list" className="mt-5">
      <BlockHead
        icon={I.doc}
        tone="sky"
        title={t('fleet.dash.accidents.title')}
        note={w('list.note')}
        chips={
          accidents === null ? undefined : (
            <span data-acc-chip="list" className={cn(COUNT_CHIP, TONE.sky.soft)}>
              <N>{count(accidents.count)}</N> {noun('accident', accidents.count)}
            </span>
          )
        }
      />
      {list.rows.length === 0 ? (
        <EndRow marker="list">
          <span>{w('empty')}</span>
        </EndRow>
      ) : (
        <div className={F.scroll}>
          <table
            className={cn(
              'w-full border-collapse text-[13px] xl:min-w-[980px] xl:table-fixed',
              F.table,
            )}
          >
            <colgroup className={F.head}>
              <col className="w-[170px]" />
              <col className="w-[124px]" />
              <col />
              <col className="w-[180px]" />
              <col className="w-[104px]" />
              <col className="w-[160px]" />
              <col className="w-[104px]" />
            </colgroup>
            <thead className={cn(TH_ROW, F.head)}>
              <tr className={cn('border-y', RULE)}>
                <th className={th}>{w('col.vehicle')}</th>
                <th className={th}>{w('col.date')}</th>
                <th className={th}>{w('col.statement')}</th>
                <th className={th}>{w('col.culprit')}</th>
                <th className={th}>{w('col.status')}</th>
                <th className={th}>{w('col.remaining')}</th>
                <th className={cn(CELL, 'py-2.5')}>
                  <span className="sr-only">{w('openRow')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(DIVIDE, F.body, RULE)}>
              {list.rows.map((row) => (
                <AccidentRow key={row.accidentId} row={row} links={links} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BlockFoot>
        {list.more > 0 && (
          <FootLink link={links.accidents('accidentList.more')}>
            <span data-acc-foot="more">
              <Phrase text={w('more')} parts={{ count: <N>{count(list.more)}</N> }} />
            </span>
          </FootLink>
        )}
        <FootLink link={links.accidents('accidentList.all')}>
          {t('fleet.dash.accidents.register')}
        </FootLink>
      </BlockFoot>
    </Card>
  );
};

/** The period's figures on their way: the row of two and the table in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
    <Skeleton className="h-72 rounded-2xl" />
  </div>
);

const PeriodBody = ({
  data,
  onRetry,
}: {
  data: FleetDashboardPeriodDto;
  onRetry: () => void;
}): JSX.Element => {
  const w = useWords();
  const links = periodLinks(data);
  const accidentsState = periodState(data, 'accidents');
  const listState = periodState(data, 'accidentList');
  const accidents = accidentsState === 'shown' ? data.accidents : null;
  const list = listState === 'shown' ? data.accidentList : null;
  const undated = accidents?.undated ?? null;
  return (
    <>
      {accidentsState === 'failed' && <SectionError section="accidents" onRetry={onRetry} />}
      {accidents !== null && (
        <div
          data-acc-period-row="true"
          className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]"
        >
          <PeriodKpi accidents={accidents} links={links} />
          <MoneyCard totals={accidents.totals} links={links} />
        </div>
      )}
      {listState === 'failed' && (
        <SectionError section="accidentList" onRetry={onRetry} className="mt-5" />
      )}
      {list !== null && <AccidentTable list={list} accidents={accidents} links={links} />}
      {(accidents !== null || list !== null) && (
        <div className="mt-4 px-1">
          <NoteLine>
            <span data-acc-note="true">
              {w('note')}
              {/* The files with no day are open «الآن» but in no period — the company view only
                  (the server leaves the count out under any narrowing). */}
              {undated !== null && undated > 0 && (
                <span data-undated="true">
                  {' '}
                  <Phrase text={w('undated')} parts={{ count: <N>{count(undated)}</N> }} />
                </span>
              )}
            </span>
          </NoteLine>
        </div>
      )}
    </>
  );
};

const PeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const w = useWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  return (
    <section data-acc-band="period" aria-label={w('period')} className="mt-8">
      <BandHead
        id="period"
        tone="sky"
        title={w('period')}
        chips={data === undefined ? undefined : <RangeChip range={data.range} />}
        sub={w('periodSub')}
      />
      {/* The dashboard's own period bar, right under the band's head and above what it moves: the
          page's ONE filter state (the other period tabs share it), written to the address bar. */}
      <PeriodFilterBar
        filters={period.filters}
        onFilters={period.onFilters}
        data={data}
        can={can}
      />
      <ReadBand state={state} onRetry={period.onRetry} skeleton={<PeriodSkeleton />}>
        {data !== undefined && <PeriodBody data={data} onRetry={period.onRetry} />}
      </ReadBand>
    </section>
  );
};

// ── The tab ───────────────────────────────────────────────────────────────────────────────────

export const AccidentsTab = (props: MixedTabProps): JSX.Element => {
  const { can } = props;
  const filesOk = sectionPermitted('accidentsOpen', can);
  const noticesOk = sectionPermitted('notices', can);
  // The period band is drawn for a reader of R2's accidents (the same key as the open files'): a
  // reader of the notices alone sees «الآن» and sends no period read.
  const periodOk = props.period.enabled && sectionPermitted('accidents', can);
  return (
    <div data-dash-tab-body="accidents">
      <Heading props={props} files={filesOk} notices={noticesOk} period={periodOk} />
      {(filesOk || noticesOk) && <NowBand props={props} />}
      {periodOk && <PeriodBand props={props} />}
    </div>
  );
};
