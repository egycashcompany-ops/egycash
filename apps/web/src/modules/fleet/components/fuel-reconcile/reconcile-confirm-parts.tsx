// «اعتماد رصيد الشيت» — the confirm's 6a pieces (a split of `ReconcileConfirmDialog.tsx`, plan §8
// 6a, M16/M17/M23): the sheet's date and how old it is; per card «شحن لا يظهر في الشيت» — the live
// charges the sheet does not show, a checklist pre-ticked when the amount is exactly what the
// sheet is short, the charges after the sheet's date listed apart and never pre-ticked; the
// warning «في سجل الكارت حركات بعد تاريخ الشيت»; and, when the sheet is higher by exactly the
// pending «طلب رصيد», the choice «اعتماد طلب الرصيد» / «تسوية فقط».
import { type ReactNode } from 'react';
import { type FleetFuelReconcileChargeDto, type FleetFuelReconcileLineDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, CompanyBadge, NUM, PATH } from '../FuelCardBoard';
import { CodeChip } from '../custody-memo-parts';
import { MONO } from '../FuelCardDialog';
import {
  cairoToday,
  datedCharges,
  dayText,
  daysBetween,
  laterCharges,
  markedOf,
  markedTooMuch,
  money,
  sheetDateOfName,
  signed,
  stampOf,
  type LineChoices,
  type RequestChoice,
} from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { DateText, Filled, KeepQuotes } from './reconcile-cells';

const R = 'fleet.fuelCards.reconcile.';

/** M23 — «تاريخ الشيت»: the day the sheet describes, how old it is, where it came from. */
export const SheetDateLine = ({
  sheetDate,
  fileName,
}: {
  sheetDate: string | null;
  fileName: string;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const days = sheetDate === null ? 0 : daysBetween(sheetDate, cairoToday());
  const fromName = sheetDateOfName(fileName);
  return (
    <div
      data-recon-confirm-sheet-date={sheetDate ?? 'none'}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm dark:border-[#2b3b6b] dark:bg-[#0a1233]/60"
    >
      <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
        <BoardIcon d={PATH.calendar} className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
        {t(`${R}sheetDate`)}
      </span>
      {sheetDate === null ? (
        <span className="text-slate-600 dark:text-slate-300">{t(`${R}sheetDateNone`)}</span>
      ) : (
        <>
          <b dir="ltr" className={cn(MONO, 'text-[15px] text-slate-900 dark:text-white')}>
            {dayText(sheetDate)}
          </b>
          <span
            data-recon-confirm-sheet-age={days}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-bold',
              days <= 0
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
            )}
          >
            {days <= 0
              ? t(`${R}sheetDateToday`)
              : t(`${R}sheetDateAgo`, { days: count.daysAgo(days) })}
          </span>
          {fromName !== null && fromName.day === sheetDate && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              <Filled
                template={t(`${R}sheetDateFromFile`)}
                values={{ text: <DateText text={fromName.text} /> }}
              />
            </span>
          )}
        </>
      )}
    </div>
  );
};

/** One charge the sheet does not show: its tick, when, how much, who — and why it is (not) ticked. */
const ChargeTick = ({
  charge,
  on,
  preTicked,
  onChange,
}: {
  charge: FleetFuelReconcileChargeDto;
  on: boolean;
  preTicked: boolean;
  onChange: (on: boolean) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <label
      data-recon-confirm-charge={charge.id}
      data-recon-confirm-charge-on={on ? 'yes' : 'no'}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition',
        on
          ? 'border-violet-400 bg-violet-50 dark:border-violet-500/50 dark:bg-violet-500/10'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60',
      )}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-900"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span dir="ltr" className={cn(MONO, 'text-xs text-slate-500 dark:text-slate-400')}>
            {stampOf(charge.at)}
          </span>
          <span className="rounded-md border border-emerald-300 bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
            {t('fleet.fuelCards.history.kind.charge')}
          </span>
          <b dir="ltr" className={cn(MONO, 'text-base text-emerald-600 dark:text-emerald-400')}>
            +{money(charge.amount)}
          </b>
          {charge.byName !== null && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.fuelCards.history.by', { name: charge.byName })}
            </span>
          )}
          {preTicked && (
            <span
              data-recon-confirm-pre-ticked={charge.id}
              className="ms-auto whitespace-nowrap rounded-full border border-violet-300 bg-white px-2.5 py-0.5 text-[11px] font-bold text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
            >
              {t(`${R}preTicked`)}
            </span>
          )}
          {charge.afterSheetDate && (
            <span className="ms-auto whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              {t(`${R}afterSheetDateTag`)}
            </span>
          )}
        </span>
        <span
          className={cn(
            'text-[13px] font-semibold',
            on ? 'text-violet-800 dark:text-violet-200' : 'text-slate-600 dark:text-slate-300',
          )}
        >
          {t(`${R}cancelCharge`)}
        </span>
      </span>
    </label>
  );
};

/** M16 — one card's «شحن لا يظهر في الشيت»: the checklist, the later charges apart, the sum. */
export const UnseenCharges = ({
  line,
  choice,
  preTicked,
  sheetDate,
  onToggle,
}: {
  line: FleetFuelReconcileLineDto;
  choice: LineChoices;
  /** What was ticked before the reader touched it — tagged «معلَّم مسبقًا». */
  preTicked: ReadonlySet<string>;
  sheetDate: string | null;
  onToggle: (chargeId: string, on: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const dated = datedCharges(line);
  const later = laterCharges(line);
  const marked = markedOf(line, choice);
  const over = markedTooMuch(line, choice);
  const tick = (charge: FleetFuelReconcileChargeDto): JSX.Element => (
    <ChargeTick
      key={charge.id}
      charge={charge}
      on={choice.cancel.has(charge.id)}
      preTicked={preTicked.has(charge.id)}
      onChange={(on) => onToggle(charge.id, on)}
    />
  );
  return (
    <div className="space-y-2.5" data-recon-confirm-unseen={line.card.id}>
      {dated.length > 0 && <div className="space-y-2">{dated.map(tick)}</div>}
      {later.length > 0 && (
        <div className="space-y-2" data-recon-confirm-later="true">
          <p className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
            <span className="h-px flex-1 bg-amber-300/70 dark:bg-amber-500/30" />
            {t(`${R}afterSheetDate`)}
            {sheetDate !== null && (
              <span dir="ltr" className={MONO}>
                ({dayText(sheetDate)})
              </span>
            )}
            <span className="h-px flex-1 bg-amber-300/70 dark:bg-amber-500/30" />
          </p>
          {later.map(tick)}
        </div>
      )}
      <p
        data-recon-confirm-marked={marked}
        data-recon-confirm-over={over ? 'true' : undefined}
        className={cn(
          'flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border px-3.5 py-2 text-[13px] font-bold',
          over
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:text-slate-200',
        )}
      >
        <span className="whitespace-nowrap">
          <Filled
            template={t(`${R}markedSum`)}
            values={{
              marked: (
                <b dir="ltr" className={cn(MONO, 'text-violet-700 dark:text-violet-300')}>
                  {money(marked)}
                </b>
              ),
              difference: (
                <b dir="ltr" className={MONO}>
                  {money(-line.difference)}
                </b>
              ),
            }}
          />
        </span>
        <span className="ms-auto text-xs font-semibold text-slate-500 dark:text-slate-400">
          {t(`${R}noSecondDeduction`)}
        </span>
      </p>
    </div>
  );
};

/** M17 — the sheet is higher by exactly the pending request: approve it, or adjust only. */
export const RequestChoiceBox = ({
  line,
  choice,
  onChoice,
}: {
  line: FleetFuelReconcileLineDto;
  choice: RequestChoice;
  onChoice: (choice: RequestChoice) => void;
}): JSX.Element => {
  const t = useT();
  const option = (
    value: RequestChoice,
    title: string,
    note: string,
    suggested: boolean,
  ): JSX.Element => {
    const on = choice === value;
    return (
      <label
        data-recon-confirm-request={value}
        data-recon-confirm-request-on={on ? 'yes' : 'no'}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition',
          on
            ? value === 'approve'
              ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10'
              : 'border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800/70'
            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60',
        )}
      >
        <input
          type="radio"
          name={`request-${line.card.id}`}
          checked={on}
          onChange={() => onChoice(value)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900"
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            {title}
            {suggested && (
              <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                {t(`${R}suggested`)}
              </span>
            )}
          </span>
          <span className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            <KeepQuotes text={note} />
          </span>
        </span>
      </label>
    );
  };
  return (
    <div className="space-y-2.5" data-recon-confirm-request-box={line.card.id}>
      {line.card.requestedAmount !== null && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <span className="font-bold text-amber-800 dark:text-amber-300">
            {t(`${R}requestStrip`)}
          </span>
          <b dir="ltr" className={cn(MONO, 'text-base text-amber-700 dark:text-amber-300')}>
            {money(line.card.requestedAmount)}
          </b>
          <span className="text-xs text-amber-800/80 dark:text-amber-300/80">
            {t('fleet.fuelCards.board.kpi.currency')}
          </span>
          {line.card.requestedAt !== null && (
            <span dir="ltr" className={cn(MONO, 'text-xs text-slate-500 dark:text-slate-400')}>
              {stampOf(line.card.requestedAt)}
            </span>
          )}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {option('approve', t(`${R}approveRequest`), t(`${R}approveRequestNote`), true)}
        {option('adjust', t(`${R}adjustOnly`), t(`${R}adjustOnlyNote`), false)}
      </div>
    </div>
  );
};

/** A section of the confirm in the dialog's own heading style. */
export const Block = ({
  title,
  note,
  tone,
  children,
  mark,
}: {
  title: string;
  note: string;
  tone: 'violet' | 'amber';
  children: ReactNode;
  mark: string;
}): JSX.Element => (
  <section className="space-y-3" data-recon-confirm-block={mark}>
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
        <span
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            tone === 'violet' ? 'bg-violet-500' : 'bg-amber-500',
          )}
        />
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        <KeepQuotes text={note} />
      </p>
    </div>
    {children}
  </section>
);

/** «في سجل الكارت حركات بعد تاريخ الشيت» — a ✓ rolls each such card back to the sheet's day. */
export const MovedAfterWarning = ({
  lines,
  sheetDate,
}: {
  lines: readonly FleetFuelReconcileLineDto[];
  sheetDate: string;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="alert"
      data-recon-confirm-moved-after="true"
      className="flex items-start gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 dark:border-amber-500/50 dark:bg-amber-500/10"
    >
      <BoardIcon
        d={PATH.warn}
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <span className="space-y-1">
        <b className="block text-[15px] text-amber-900 dark:text-amber-200">
          {t(`${R}movedAfterSheetDate`)}
        </b>
        {lines.map((line) => (
          <span
            key={line.card.id}
            className="block text-[13px] leading-relaxed text-amber-900/90 dark:text-amber-100/90"
          >
            <Filled
              template={t(`${R}movedAfterSheetDateBody`)}
              values={{
                date: (
                  <b dir="ltr" className={MONO}>
                    {dayText(sheetDate)}
                  </b>
                ),
                balance: (
                  <b dir="ltr" className={MONO}>
                    {money(line.sheet.balance)}
                  </b>
                ),
              }}
            />
          </span>
        ))}
      </span>
    </div>
  );
};

/** The card a block is about, when the confirm holds several. */
export const CardTag = ({ line }: { line: FleetFuelReconcileLineDto }): JSX.Element => {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CompanyBadge company={line.card.company} />
      <span
        dir="ltr"
        className="whitespace-nowrap font-figures text-[14px] font-bold text-slate-900 dark:text-white"
      >
        {line.card.name}
      </span>
      {line.card.vehicleCode !== null && <CodeChip code={line.card.vehicleCode} />}
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {t(`${R}colDiff`)}{' '}
        <b
          dir="ltr"
          className={cn(
            NUM,
            line.difference < 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {signed(line.difference)}
        </b>
      </span>
    </span>
  );
};
