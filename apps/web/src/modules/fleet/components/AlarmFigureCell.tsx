// «فارق عداد الصيانة» after batch 3: the figure, and «كيف حُسب الفارق» on it.
//
// «مش بيخصم الكيلومترات اللى بتخش كل يوم … مش بيزود على فارق الصيانه»: the register used to print
// the car's figure of TODAY down every reading of the car, so 295 read 5,507 on every day and the
// distance seemed never to grow. Now:
//   · every reading row shows the gap AT THAT READING (`serviceGapKm`, a server fact on the row):
//     that day's reading less the counter of the counting service in force on it, or «—» before
//     any service and on a day without a reading (`RowGapCell`);
//   · the car's NEWEST row on the page carries what is about the car NOW (`NewestGapCell`): its
//     figure today with the ⓘ that opens the card, and nothing else — the owner: «I want the rest
//     of it removed, leaving only the exclamation mark next to the reading». The level, «المتبقي X
//     من Y كم», the reading the figure stands on and a newer visit that does not count yet are all
//     in the card;
//   · the alarms board's «منذ الخدمة» opens the same card (`BoardSinceCell`), and its «المتبقي»
//     says «من Y كم» beside what is left (`BoardRemaining`).
//
// The card opens as the reason card does — 250 ms on hover, at once on keyboard focus, closed on
// leave, blur and Escape, one open at a time — in the same frame (`ReasonCardLayer`).
import { useId, useRef, type ReactNode } from 'react';
import { type FleetAlarmLevel, type FleetMaintenanceAlarmDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { bindFigures, remainingOf, type HoverControl } from '../lib/alarm-reason-card';
import { Glyph, INFO, ReasonCardLayer, keyboardFocus, useReasonCard } from './AlarmReasonCell';
import { Sentence } from './AlarmReasonFacts';
import { FIGURE_WORDS, HowComputedCard, NEWER_MARK, WARN } from './alarm-figure-card';
import { NUM } from './FuelCardBoard';

const LATIN = new Intl.NumberFormat('en-US');
const F = FIGURE_WORDS;

/**
 * The amber mark under the board's figure is a step smaller than the row — RELATIVE to the row's
 * own type (the alarms board's sizes), never a size of its own.
 */
const MARK_SIZE = 'text-[0.78em] leading-4';

/** A figure in the boards' digits, left to right, never broken. */
const Num = ({ value, className }: { value: number; className?: string }): JSX.Element => (
  <span dir="ltr" className={cn(NUM, 'whitespace-nowrap', className)}>
    {LATIN.format(value)}
  </span>
);

/** «5,507 كم»: the figure in the boards' digits, the unit in the page's words, in its order. */
export const KmFigure = ({ km }: { km: number }): JSX.Element => {
  const t = useT();
  const [before = '', after = ''] = t('fleet.odometer.kmValue', { km: '\u0000' }).split('\u0000');
  return (
    <span className="whitespace-nowrap">
      {before}
      <Num value={km} />
      {after}
    </span>
  );
};

const TRIGGER =
  'inline-flex cursor-help items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

/** The figure, dotted, with an ⓘ: hovering or focusing it opens «كيف حُسب الفارق». */
const FigureTrigger = ({
  children,
  control,
  describedBy,
}: {
  children: ReactNode;
  control: HoverControl;
  describedBy: string | undefined;
}): JSX.Element => (
  <span
    tabIndex={0}
    aria-describedby={describedBy}
    data-odo-figure-trigger="true"
    onMouseEnter={control.enter}
    onMouseLeave={control.leave}
    onFocus={(e) => control.focus(keyboardFocus(e.currentTarget))}
    onBlur={control.blur}
    onKeyDown={(e) => {
      // Escape closes the card and only the card — not a dialog or a list around it.
      if (e.key === 'Escape' && control.escape()) e.stopPropagation();
    }}
    className={TRIGGER}
  >
    <span className="underline decoration-slate-400 decoration-dotted decoration-2 underline-offset-[6px] dark:decoration-slate-500">
      {children}
    </span>
    <Glyph className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400">{INFO}</Glyph>
  </span>
);

/** The amber mark under the board's figure: a newer visit that does not count (yet). */
const NewerMark = ({ alarm }: { alarm: FleetMaintenanceAlarmDto }): JSX.Element | null => {
  const t = useT();
  const newer = alarm.newerUncountedVisit;
  if (newer === null) return null;
  return (
    <span
      data-odo-newer-mark={newer.why}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 whitespace-normal rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-start text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200',
        MARK_SIZE,
      )}
    >
      <Glyph className="h-3.5 w-3.5 shrink-0">{WARN}</Glyph>
      {t(NEWER_MARK[newer.why])}
    </span>
  );
};

/**
 * The car's NEWEST row on the page: today's figure with its ⓘ — the trigger of «كيف حُسب الفارق» —
 * and nothing under or beside it. Everything else about the car now (the level, what is left of
 * the interval, the reading the figure stands on, a newer visit that does not count yet) is in the
 * card. `tint`: the page's cell tint for the car's level, on the figure.
 */
export const NewestGapCell = ({
  alarm,
  tint,
}: {
  alarm: FleetMaintenanceAlarmDto;
  tint?: string | undefined;
}): JSX.Element | null => {
  const t = useT();
  const id = useId();
  const anchor = useRef<HTMLSpanElement | null>(null);
  const { open, control } = useReasonCard();
  if (alarm.sinceServiceKm === null) return null;
  return (
    <span
      ref={anchor}
      className="inline-flex items-center justify-center"
      data-odo-gap="newest"
      data-odo-car={alarm.code}
    >
      <span className={cn('inline-flex items-center justify-center', tint)}>
        <FigureTrigger control={control} describedBy={open ? id : undefined}>
          <KmFigure km={alarm.sinceServiceKm} />
        </FigureTrigger>
      </span>
      {open && (
        <ReasonCardLayer id={id} anchor={anchor} figure>
          <HowComputedCard alarm={alarm} footer={t(`${F}footer`)} />
        </ReasonCardLayer>
      )}
    </span>
  );
};

/** Any other row: the gap at that row's own reading, or a dash. */
export const RowGapCell = ({ km }: { km: number | null }): JSX.Element =>
  km === null ? (
    <span className="text-slate-400" data-odo-gap="none">
      —
    </span>
  ) : (
    <span data-odo-gap="row" className="text-slate-700 dark:text-slate-200">
      <KmFigure km={km} />
    </span>
  );

/** The alarms board's «منذ الخدمة»: the figure, opening the same card. */
export const BoardSinceCell = ({
  alarm,
  figureClassName,
}: {
  alarm: FleetMaintenanceAlarmDto;
  figureClassName: string;
}): JSX.Element | null => {
  const t = useT();
  const id = useId();
  const anchor = useRef<HTMLSpanElement | null>(null);
  const { open, control } = useReasonCard();
  if (alarm.sinceServiceKm === null) return null;
  return (
    <span
      ref={anchor}
      className="inline-flex flex-col items-center gap-1"
      data-odo-gap="board"
      data-odo-car={alarm.code}
    >
      <FigureTrigger control={control} describedBy={open ? id : undefined}>
        <span dir="ltr" className={figureClassName}>
          {LATIN.format(alarm.sinceServiceKm)}
        </span>
      </FigureTrigger>
      <NewerMark alarm={alarm} />
      {open && (
        <ReasonCardLayer id={id} anchor={anchor} figure>
          <HowComputedCard alarm={alarm} footer={t('fleet.alarms.figure.footer')} />
        </ReasonCardLayer>
      )}
    </span>
  );
};

/** What is left, in the car's level colour — the board's own `RemainingKm` tones. */
const LEFT_TONE: Record<FleetAlarmLevel, string> = {
  red: 'text-red-700 dark:text-red-400',
  yellow: 'text-amber-800 dark:text-amber-400',
  none: 'text-emerald-700 dark:text-emerald-400',
};

/**
 * The alarms board's «المتبقي (كم)»: «1,993 من 7,500 كم» — what is left in the level's colour, then
 * the make's interval. With no rule, or past the interval, the board's own cell (`fallback`) as
 * it was: «متأخر … كم» says the overdue case already.
 */
export const BoardRemaining = ({
  alarm,
  figureClassName,
  fallback,
}: {
  alarm: FleetMaintenanceAlarmDto;
  figureClassName: string;
  fallback: ReactNode;
}): JSX.Element => {
  const t = useT();
  const of = remainingOf(alarm);
  if (of === null || of.overdue) return <>{fallback}</>;
  return (
    <span
      className="inline-flex items-baseline justify-center gap-1.5 whitespace-nowrap"
      data-odo-board-of="true"
    >
      <span dir="ltr" className={cn(figureClassName, LEFT_TONE[alarm.level])}>
        {LATIN.format(of.left)}
      </span>
      <span className="text-[0.875em] text-slate-500 dark:text-slate-400">
        <Sentence
          template={bindFigures(t('fleet.alarms.figure.of'))}
          parts={{ interval: <Num value={of.interval} /> }}
        />
      </span>
    </span>
  );
};
