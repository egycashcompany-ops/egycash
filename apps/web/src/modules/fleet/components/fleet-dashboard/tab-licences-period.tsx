// «التراخيص والتجديدات» — the «خلال الفترة» band (approved/lic-dark.png and lic-branch-dark.png;
// harness zz-licences-tab.tsx `PeriodBand`; DECISIONS §11, critic A3/B2/B3/B9), over the page's R2
// `licenceSpend`: the licence-expense memos by the MEMO DAY, for the whole company.
//
//   · the band's head (sky, the range the read answered for, «الشركة كلها» while the figures are
//     narrowed — a chosen branch AND «كل فروعي»: a memo has no branch), its line, then the
//     dashboard's period bar with the PERIOD CHOICES ONLY (`periodOnly`, critic A3 — told): a memo
//     carries no branch, car type, operation or amount per car, so nothing else would move it;
//   · the row [«مصروفات التراخيص في الفترة» (sky: the total opening the register on the range; the
//     register's own «عدد المذكرات» and «السيارات», plain — B9) | «تفصيل مصروفات الفترة» (two groups
//     of brand bars, each the whole total: by memo kind, by payment — plain figures, no register
//     filter matches them exactly (B3); one-decimal shares (B2))];
//   · under the row, the custody note and the link to «العهدة» (plain when the reader has no such
//     tab): the settled memos left the custody, the waiting ones are there — never added together.
//
// NOTHING IS COUNTED HERE: every figure is a field R2 sent (renewal + extension = visa + cash =
// total, the server's); the browser draws a bar's length and a share.
import { type FleetDashboardPeriodDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { periodLinks, type PeriodLinks } from '../../lib/fleet-dashboard-links';
import { shareText } from '../../lib/fleet-dashboard-tabs';
import {
  Card,
  CompanyWide,
  DIVIDE,
  FootLink,
  I,
  IconTile,
  MUTED,
  N,
  PCT,
  RULE,
  STRONG,
  TITLE,
  TONE,
  Tag,
  WELL,
  cn,
} from './dash-kit';
import { Amount, SectionError, count, type MixedTabProps } from './dash-shell';
import {
  BandHead,
  BigMoney,
  BlockHead,
  COUNT_CHIP,
  NoteLine,
  RangeChip,
  ReadBand,
} from './dash-blocks';
import { PeriodFilterBar } from './period-filter-bar';
import { FOOT, Money, narrowedView, spendView, useLicenceWords } from './tab-licences-words';

type Spend = NonNullable<FleetDashboardPeriodDto['licenceSpend']>;

/** The share box beside a bar: one width for every share, so the boxes' edges line up. */
const SHARE_BOX = cn(PCT, 'inline-block min-w-[3.25rem] text-center');

// ── 1 · «مصروفات التراخيص في الفترة» ──────────────────────────────────────────────────────────

const SpendCard = ({ s, links }: { s: Spend; links: PeriodLinks }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  const stat = (id: 'count' | 'cars', label: string, n: number): JSX.Element => (
    <div
      data-lic-stat={id}
      data-lic-n={String(n)}
      className="col-span-2 grid grid-cols-subgrid items-center text-[13px] leading-6"
    >
      <dt className="whitespace-nowrap font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </dt>
      <dd>
        <N className={cn('font-bold', STRONG)}>{count(n)}</N>
      </dd>
    </div>
  );
  return (
    <Card accent="sky" data-lic-spend="card" data-lic-tone="sky">
      <div className="flex flex-1 flex-col px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn(TITLE, 'flex items-center gap-2 whitespace-nowrap')}>
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', TONE.sky.dot)}
              />
              {w('spend.title')}
            </h3>
            <div className="mt-2 flex h-5 items-center gap-1.5">
              <Tag tone="sky" dot>
                {w('spend.tag')}
              </Tag>
            </div>
          </div>
          <IconTile d={I.receipt} tone="sky" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BigMoney value={s.total} link={links.licenceSpend('licenceSpend.total')} />
        </div>
        {/* The register's own counts, as it labels them (critic B9): plain — the register's list is
            the total's link already. */}
        <dl
          className={cn(
            WELL,
            'mt-4 grid grid-cols-[max-content_max-content] gap-x-6 gap-y-1 px-4 py-3',
          )}
        >
          {stat('count', t('fleet.licenseExpenses.stats.memos'), s.count)}
          {stat('cars', t('fleet.licenseExpenses.stats.cars'), s.cars)}
        </dl>
      </div>
      <div data-lic-foot="spend" className={FOOT}>
        <FootLink link={links.licenceSpend('licenceSpend.screen')}>{w('spend.screen')}</FootLink>
      </div>
    </Card>
  );
};

// ── 2 · «تفصيل مصروفات الفترة» ────────────────────────────────────────────────────────────────

type SplitKey = 'renewal' | 'extension' | 'visa' | 'cash';
const GROUPS: readonly { id: 'kind' | 'pay'; title: string; rows: readonly SplitKey[] }[] = [
  { id: 'kind', title: 'split.byKind', rows: ['renewal', 'extension'] },
  { id: 'pay', title: 'split.byPay', rows: ['visa', 'cash'] },
];
/** The register's own words: the memo kinds and the ways of payment. */
const SPLIT_WORD: Record<SplitKey, string> = {
  renewal: 'fleet.licenseExpenses.kinds.renewal',
  extension: 'fleet.licenseExpenses.kinds.extension',
  visa: 'fleet.licenseExpenses.paidBy.visa',
  cash: 'fleet.licenseExpenses.paidBy.cash',
};

const SplitCard = ({ s }: { s: Spend }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  return (
    <Card data-lic-block="split">
      <BlockHead
        icon={I.rank}
        tone="brand"
        title={w('split.title')}
        note={w('split.note')}
        chips={
          <span data-lic-chip="split" className={cn(COUNT_CHIP, TONE.sky.soft)}>
            <Amount value={s.total} />
          </span>
        }
      />
      {GROUPS.map((group) => (
        <div key={group.id} data-lic-group={group.id} className={cn('border-t', RULE)}>
          <p className={cn('px-5 pb-0.5 pt-3 text-xs font-bold', MUTED)}>{w(group.title)}</p>
          <ol className={DIVIDE}>
            {group.rows.map((key) => {
              // Each bar is its share of the whole (display only; the parts are the server's).
              const pct = s.total > 0 ? (s[key] / s.total) * 100 : 0;
              return (
                <li
                  key={key}
                  data-lic-split={key}
                  data-lic-amount={String(s[key])}
                  className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3"
                >
                  <span
                    className={cn(
                      'w-28 shrink-0 whitespace-nowrap text-[14px] font-bold max-sm:flex-1',
                      STRONG,
                    )}
                  >
                    {t(SPLIT_WORD[key])}
                  </span>
                  <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-[#162135]">
                      <div
                        data-lic-split-fill={key}
                        className={cn('h-2 rounded-full', TONE.brand.bar)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-32 shrink-0 whitespace-nowrap text-end max-sm:w-auto">
                    <Money value={s[key]} className="text-[13.5px]" />
                  </span>
                  <span data-lic-share={key} className="shrink-0">
                    <span dir="ltr" className={SHARE_BOX}>
                      {shareText(s[key], s.total)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </Card>
  );
};

// ── The band ──────────────────────────────────────────────────────────────────────────────────

/** The period's figures on their way: the row of two in grey. */
const PeriodSkeleton = (): JSX.Element => (
  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
    <Skeleton className="h-64 rounded-2xl" />
    <Skeleton className="h-64 rounded-2xl" />
  </div>
);

const PeriodBody = ({
  data,
  can,
  onRetry,
}: {
  data: FleetDashboardPeriodDto;
  can: (permission: string) => boolean;
  onRetry: () => void;
}): JSX.Element | null => {
  const view = spendView(data, can);
  if (view === 'failed') return <SectionError section="licenceSpend" onRetry={onRetry} />;
  if (view === 'hidden' || data.licenceSpend === null) return null;
  const links = periodLinks(data);
  return (
    <div
      data-lic-row="period"
      className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <SpendCard s={data.licenceSpend} links={links} />
      <SplitCard s={data.licenceSpend} />
    </div>
  );
};

export const LicencesPeriodBand = ({ props }: { props: MixedTabProps }): JSX.Element => {
  const t = useT();
  const w = useLicenceWords();
  const { period, can } = props;
  const data = period.data;
  const state = data !== undefined ? 'ready' : period.failed ? 'error' : 'loading';
  const custodyTab = props.tabLink('custody', 'licenceSpend.custody.tab');
  return (
    <section data-lic-band="period" aria-label={w('period')} className="mt-8">
      <BandHead
        id="period"
        tone="sky"
        title={w('period')}
        chips={
          <>
            {data !== undefined && <RangeChip range={data.range} />}
            <CompanyWide show={narrowedView(props)} />
          </>
        }
        sub={w('periodSub')}
      />
      {/* The dashboard's own period bar, the period choices only (critic A3): the page's ONE filter
          state, so the other tabs' type / operation / codes ride along untouched. */}
      <PeriodFilterBar
        filters={period.filters}
        onFilters={period.onFilters}
        data={data}
        can={can}
        periodOnly
      />
      <ReadBand state={state} onRetry={period.onRetry} skeleton={<PeriodSkeleton />}>
        {data !== undefined && <PeriodBody data={data} can={can} onRetry={period.onRetry} />}
      </ReadBand>
      <div
        data-lic-custody-note="true"
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1"
      >
        <NoteLine>{w('custodyNote')}</NoteLine>
        {custodyTab !== null && (
          <FootLink link={custodyTab}>{t('fleet.dash.shell.tab.custody')}</FootLink>
        )}
      </div>
    </section>
  );
};
