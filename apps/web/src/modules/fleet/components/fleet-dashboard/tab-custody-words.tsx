// «العهدة» — the tab's own words and the small faces its two bands share (tab-custody-now.tsx,
// tab-custody-history.tsx, tab-custody-period.tsx), as the approved sample writes them
// (approved/cust-dark.png, cust-branch-dark.png; harness zz-custody-tab.tsx):
//
//   · the counted words with a dual, in the custody pages' five forms («إيصال واحد»، «إيصالان»،
//     «5 إيصالات»، «361 إيصالًا»، «100 إيصال»): the receipts and the memos from the custody pages'
//     own keys (`fleet.custody.count.*`), the requests from the ledger tiles' («طلبان»), the alerts
//     and the cars under the tab's own keys; the kit's counted noun (`useNoun`) has no dual;
//   · an amount (muted at 0.00, red with «−» below zero), a day as the boards write it, a memo's name
//     as the custody pages write it (a typed name, else «مذكرة وقود رقم 34» — critic B6), an age and
//     its chip (whole UTC days from the board's day, AMBER with a clock past 30 days — never red,
//     critic A3, E3);
//   · whether the figures are narrowed to the reader's branches — the «الآن» band then says «الشركة
//     كلها» (a chosen branch AND «كل فروعي», critic E1);
//   · which of the tab's R2 sections a reader meets drawn, failed or not at all.
//
// Nothing is counted here: every `n` is a server field or a custody lib count
// (lib/custody-dashboard-fund.ts).
import { type ReactNode } from 'react';
import { type FleetCustodyMemoRowDto, type FleetDashboardPeriodDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { sectionPermitted, slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyAgeDays, custodyIsLate } from '../../lib/custody-dashboard-fund';
import { useCustodyCount } from '../../lib/custody-words';
import { HOLD_CLOCK } from '../custody-hold-parts';
import { memoDisplayName } from '../custody-memo-parts';
import { Amount, Phrase, count, type MixedTabProps } from './dash-shell';
import { FOOT_BAND, Small } from './dash-blocks';
import { Fig, Icon, MUTED, N, RED, RULE, STRONG, cn } from './dash-kit';

/** The word of a key under the tab's own namespace. */
export const useCustodyWords = (): ((
  key: string,
  params?: Record<string, string | number>,
) => string) => {
  const t = useT();
  return (key, params) => t(`fleet.dash.custody.${key}`, params);
};

// ── Counted words with a dual ─────────────────────────────────────────────────────────────────

export type CustodyNoun = 'receipt' | 'memo' | 'request' | 'part' | 'alert' | 'car';

/** Each noun's five forms: the custody pages' own keys where they have one. */
const NOUN_KEY: Record<CustodyNoun, string> = {
  receipt: 'fleet.custody.count.receipt',
  memo: 'fleet.custody.count.memo',
  request: 'fleet.custody.ledger.tiles.requestedNote',
  part: 'fleet.custody.ledger.parts',
  alert: 'fleet.dash.custody.count.alert',
  car: 'fleet.dash.custody.count.car',
};

/**
 * «5 مذكرات», «مذكرتان», «361 إيصالًا» — the figure (or the words for one and two) in the figure's
 * colour, opening its list when given a link, the noun in the line's colour. `data-cust-count`
 * carries the server's figure.
 */
export const Counted = ({
  n,
  noun,
  link = null,
  figure = STRONG,
}: {
  n: number;
  noun: CustodyNoun;
  link?: DashLink | null;
  /** The figure's colour (STRONG by default, as the approved counts). */
  figure?: string;
}): JSX.Element => {
  const t = useT();
  const { form } = useCustodyCount();
  const shape = form(n);
  const text = t(`${NOUN_KEY[noun]}.${shape}`);
  return (
    <span data-cust-count={String(n)} data-cust-noun={noun} className="whitespace-nowrap">
      {text.includes('{{count}}') ? (
        <Phrase
          text={text}
          parts={{
            count: (
              <Small link={link} className={figure}>
                {count(n)}
              </Small>
            ),
          }}
        />
      ) : (
        <Fig link={link} className={cn('font-bold', figure)}>
          {text}
        </Fig>
      )}
    </span>
  );
};

/** The same count as plain words — inside a phrase that is itself a string. */
export const useCountedText = (): ((noun: CustodyNoun, n: number) => string) => {
  const t = useT();
  const { form } = useCustodyCount();
  return (noun, n) => t(`${NOUN_KEY[noun]}.${form(n)}`, { count: count(n) });
};

// ── Figures and days ──────────────────────────────────────────────────────────────────────────

/** A 0.00 amount reads muted wherever it stands. */
const ZERO = '!text-slate-500 dark:!text-slate-400';

/** An amount and «ج.م.»: red with «−» below zero, muted at 0.00, opening its list when linked. */
export const Money = ({
  value,
  link = null,
  className,
}: {
  value: number;
  link?: DashLink | null;
  className?: string;
}): JSX.Element => (
  <Fig link={link} className={value < 0 ? RED : STRONG}>
    <Amount value={value} className={cn(className, value === 0 && ZERO, value < 0 && RED)} />
  </Fig>
);

/** A day as the dashboard writes it: «2026/11/09», no time. */
export const Day = ({ ymd, className }: { ymd: string; className?: string }): JSX.Element => (
  <N className={cn('font-semibold text-slate-700 dark:text-slate-200', className)}>
    {slashDay(ymd)}
  </N>
);

/** A memo's name as the custody pages write it: the name he typed, else «مذكرة وقود رقم 34». */
export const useMemoName = (): ((
  memo: Pick<FleetCustodyMemoRowDto, 'kind' | 'no' | 'name'>,
) => string) => {
  const t = useT();
  return (memo) => memoDisplayName(memo, t);
};

/** «اليوم», «منذ يومين», «منذ 35 يومًا» — the custody pages' own words, whole UTC days. */
export const Age = ({ days }: { days: number }): JSX.Element => {
  const t = useT();
  const { form } = useCustodyCount();
  if (days === 0) return <>{t('fleet.custody.dashboard.age.today')}</>;
  const text = t(`fleet.custody.dashboard.age.${form(days)}`);
  return <Phrase text={text} parts={{ count: <N>{count(days)}</N> }} />;
};

/** The custody pages' age chip: slate, AMBER with a clock past 30 days (critic A3: never red).
 *  `lead` writes «أقدمها …» inside it. */
export const AgeChip = ({ day, lead = false }: { day: string; lead?: boolean }): JSX.Element => {
  const t = useT();
  const days = custodyAgeDays(day);
  const late = custodyIsLate(days);
  return (
    <span
      data-cust-age={String(days)}
      {...(late ? { 'data-cust-late': 'true' } : {})}
      title={slashDay(day)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4',
        late
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:font-semibold dark:text-amber-300'
          : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700/60 dark:bg-[#142135] dark:font-medium dark:text-slate-300',
      )}
    >
      {late && <Icon d={HOLD_CLOCK} className="h-3 w-3" />}
      {lead ? (
        <Phrase
          text={t('fleet.custody.dashboard.waiting.oldest')}
          parts={{ age: <Age days={days} /> }}
        />
      ) : (
        <Age days={days} />
      )}
    </span>
  );
};

/** «عن الفترة من 2026/10/26 إلى 2026/11/04» — the ledger's words, its days left to right. */
export const PeriodPhrase = ({ from, to }: { from: string; to: string }): JSX.Element => {
  const t = useT();
  return (
    <Phrase
      text={t('fleet.custody.ledger.detail.period')}
      parts={{ from: <N>{slashDay(from)}</N>, to: <N>{slashDay(to)}</N> }}
    />
  );
};

// ── Looks the bands share ─────────────────────────────────────────────────────────────────────

/** The grey band at a card's foot, its height kept so a row's bands stand level. */
export const FOOT = cn(FOOT_BAND, 'min-h-[46px] max-sm:whitespace-normal', MUTED);

/** A block's end in words: that it is empty. */
export const EndLine = ({
  marker,
  children,
}: {
  marker: string;
  children: ReactNode;
}): JSX.Element => (
  <div
    data-cust-end={marker}
    className={cn(
      'flex items-center justify-center gap-2.5 border-t px-5 py-3.5 text-[13px] font-semibold',
      RULE,
      MUTED,
    )}
  >
    {children}
  </div>
);

// ── What the tab may draw ─────────────────────────────────────────────────────────────────────

/**
 * The figures are narrowed to the reader's branches (one branch, or «كل فروعي»): R1's echo, else
 * R2's. The custody fund is the department's whole — the «الآن» band then says «الشركة كلها».
 */
export const narrowedView = (props: Pick<MixedTabProps, 'now' | 'period'>): boolean =>
  (props.now?.scopeBranches ?? props.period.data?.vehicleScope.scopeBranches ?? null) !== null;

/** A section as this reader meets it: not theirs (or not sent), drawn, or failed (its error). */
export type SectionView = 'hidden' | 'shown' | 'failed';

/** An R2 section of this tab: only when the reader holds every key of its gate. */
export const periodView = (
  data: FleetDashboardPeriodDto,
  can: (permission: string) => boolean,
  section: 'opex' | 'custodyStates',
): SectionView => {
  if (!sectionPermitted(section, can)) return 'hidden';
  if (data.unavailable.includes(section)) return 'failed';
  return data[section] === null ? 'hidden' : 'shown';
};
