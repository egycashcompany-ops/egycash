// «تعيين السيارات» on a computer: the toolbar and filter-bar pieces in the new Fleet boards' look
// (AccidentsPage, MaintenancePage, MaintenanceAlarmsPage), and the ONE drivers panel — «شاشه
// الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui».
//
//   ExcelPill       the boards' Excel pill, busy while it writes, a failure toasted — as
//                   `ExportSheetButton` / every board's `runExport`.
//   DeskDayStepper  the approved stepper (weekday · 2026/11/09 · «اليوم») at the toolbar's 36px.
//                   The date opens the browser's calendar through the date box's own calendar
//                   button and through the date itself.
//   DeskCounters    the day's seven counters, tap = filter, active = ring — on the filter bar's
//                   36px line, figures in Latin digits.
//   DriversPanel    «السائقون المتاحون (n)» / «غير المتاحين (n)» as tabs over ONE list (both lists
//                   are in the page, the other one hidden), the lists draggable on a computer with
//                   the driver card on every name, and the licence block pinned under the list.
import { useId, useRef, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { errorMessage } from '../../../../shared/lib/errors';
import { openDatePicker } from '../../../../shared/lib/open-date-picker';
import { Spinner } from '../../../../shared/ui/Spinner';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ChevronEndIcon, ChevronStartIcon } from '../../../../shared/ui/icons';
import { BoardIcon, PATH } from '../FuelCardBoard';
import { DateBox } from '../DateBox';
import { type RosterBoardModel, type RosterCounter } from '../../lib/roster-board';
import {
  AvailableList,
  DriverSearch,
  DriverTabs,
  UnavailableList,
  type DriverTab,
} from './roster-drivers';
import { num, slashDate, weekdayOf } from './roster-parts';

// ── the toolbar ─────────────────────────────────────────────────────────────────────────────────
/** The boards' toolbar pill — local to every board (Accidents, Maintenance, Receipts). */
const PILL =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

/**
 * The boards' Excel pill, with what `ExportSheetButton` and every board's `runExport` own: one
 * file at a time (busy → a spinner, the button disabled) and a failure NAMED in a toast
 * (`errorMessage`), never an uncaught error and a button that silently did nothing.
 */
export const ExcelPill = ({ onExport }: { onExport: () => void | Promise<void> }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={PILL}>
      <button
        type="button"
        data-export="roster"
        title={t('fleet.export.excel')}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void run()}
        className={cn(
          PILL_BUTTON,
          'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
        )}
      >
        {busy ? (
          <Spinner className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <BoardIcon
            d={PATH.excel}
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
          />
        )}
        <span>{t('fleet.fuelCards.board.excel')}</span>
      </button>
    </div>
  );
};

/**
 * ‹ اليوم السابق | الاثنين 2026/11/09 «اليوم» | اليوم التالي › — the approved stepper, 36px.
 * On any other day than today, «اليوم» is a button back to it. Stepping back is READING; what
 * the past cannot do is change, and that is the board's `mayPlan`.
 */
export const DeskDayStepper = ({
  date,
  isToday,
  onStep,
  onPick,
  onToday,
}: {
  date: string;
  isToday: boolean;
  onStep: (delta: number) => void;
  onPick: (ymd: string) => void;
  onToday: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const input = useRef<HTMLInputElement>(null);
  const arrow =
    'flex w-9 shrink-0 items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700';
  return (
    <div
      data-day-stepper="true"
      className="flex h-9 shrink-0 items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111827]"
    >
      <button
        type="button"
        aria-label={t('fleet.roster.prevDay')}
        title={t('fleet.roster.prevDay')}
        onClick={() => onStep(-1)}
        className={cn(arrow, 'border-e border-slate-300 dark:border-slate-700')}
      >
        <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
      </button>
      {/* The date box, with the Fleet calendar at its start (`DateBox`): the cyan calendar and
          the day itself both open the browser's picker on the hidden box, which is also where the
          browser anchors it. */}
      <DateBox label={t('fleet.roster.date')} className="flex">
        <button
          type="button"
          data-open-date="true"
          aria-label={t('fleet.roster.date')}
          title={t('fleet.roster.date')}
          onClick={() => {
            if (input.current !== null) openDatePicker(input.current);
          }}
          className="flex items-center gap-2 pe-3 ps-9 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {weekdayOf(date, locale)}
          </span>
          <bdi
            dir="ltr"
            data-day={date}
            className="font-figures text-sm font-semibold text-slate-900 dark:text-slate-50"
          >
            {slashDate(date)}
          </bdi>
          {isToday && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              {t('fleet.dash.common.today')}
            </span>
          )}
        </button>
        {/* Out of the Tab order (the button above is the stop) but NAMED, not hidden: both the
            button and the calendar move the focus here before the picker opens, so the keyboard
            and a screen reader land on «التاريخ» — and a date can still be typed. */}
        <input
          ref={input}
          type="date"
          tabIndex={-1}
          aria-label={t('fleet.roster.date')}
          value={date}
          onChange={(event) => {
            if (event.target.value !== '') onPick(event.target.value);
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      </DateBox>
      {!isToday && (
        <button
          type="button"
          data-go-today="true"
          onClick={onToday}
          className="flex shrink-0 items-center border-s border-slate-300 px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
        >
          {t('fleet.dash.common.today')}
        </button>
      )}
      <button
        type="button"
        aria-label={t('fleet.roster.nextDay')}
        title={t('fleet.roster.nextDay')}
        onClick={() => onStep(1)}
        className={cn(arrow, 'border-s border-slate-300 dark:border-slate-700')}
      >
        <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
};

// ── the counters ────────────────────────────────────────────────────────────────────────────────
/**
 * The day's tally (same tones, click = filter, active = ring) on the filter bar's 36px line. The
 * per-mission chip is the computer's only mission control now — «شيل الفلتر بتاع كل المهمات اللى
 * جمب كود السيارة بس وسيب الباقى».
 */
export const DeskCounters = ({
  counters,
  onApply,
}: {
  counters: readonly RosterCounter[];
  onApply: (apply: Record<string, string | null>) => void;
}): JSX.Element => (
  <div
    data-counters="true"
    // `px-1 py-1`: the active chip's ring sits 3px outside it — room for it inside the scroller.
    className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    {counters.map((counter) => (
      <button
        key={counter.key}
        type="button"
        data-counter={counter.key}
        data-active={counter.active ? 'true' : undefined}
        aria-pressed={counter.active}
        onClick={() => onApply(counter.apply)}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-shadow',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          counter.tone,
          counter.active
            ? 'ring-2 ring-offset-1 ring-offset-white dark:ring-offset-[#111827]'
            : 'ring-0',
        )}
      >
        <span>{counter.label}</span>
        <span className="font-figures text-sm font-bold">{num(counter.value)}</span>
      </button>
    ))}
  </div>
);

// ── the drivers panel ───────────────────────────────────────────────────────────────────────────
/**
 * At a computer's size, inside the boards' 36–38px controls: the tabs 36px, the search 36px with
 * 14px words, the reason chips and the licence links 32px — the touch lists themselves, only
 * their controls resized. (Reached by role and by the footer, so the panel's class never spells the
 * lists' own hooks.)
 */
const DESK_CONTROLS =
  '[&_input]:!h-9 [&_input]:!text-sm [&_[role=group]_button]:!h-8 [&_[role=group]_button]:!px-2.5 [&_[role=group]_button]:!text-xs [&_[data-licence-footer]_a]:!min-h-8';

/** A list's own scroll, inside its tab. */
const LIST_SCROLL = 'min-h-0 flex-1 overflow-y-auto overscroll-contain';

/**
 * ONE panel, two tabs, in place of the two side-by-side columns that took «إجراءات» off the
 * screen. Available drivers drag onto a seat; the unavailable never drag. The licence block is
 * pinned under the available list (a `max-h-[45%]` footer), so it is in sight on arrival however
 * long the list above it is.
 *
 * Each list keeps its OWN search term — a name typed to find somebody available is not a filter
 * on who is out, and switching tabs shows the other list's own box with its own term.
 */
export const DriversPanel = ({
  m,
  mayPlan,
  reasons,
  onToggleReason,
}: {
  m: RosterBoardModel;
  mayPlan: boolean;
  reasons: readonly string[];
  onToggleReason: (reason: string) => void;
}): JSX.Element => {
  const ids = useId();
  // A link that asks for reasons (the dashboard's «غائبون اليوم») lands on the list it narrows.
  const [tab, setTab] = useState<DriverTab>(reasons.length > 0 ? 'unavailable' : 'available');
  const [availableSearch, setAvailableSearch] = useState('');
  const [unavailableSearch, setUnavailableSearch] = useState('');
  const options = m.availableFor(availableSearch, null);
  const unavailable = m.unavailableFor(unavailableSearch, reasons);
  const panelIds = { available: `${ids}-available`, unavailable: `${ids}-unavailable` };
  const panel = (key: DriverTab): string =>
    cn('min-h-0 flex-1 flex-col', tab === key ? 'flex' : 'hidden');
  return (
    <aside
      data-drivers-panel="true"
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]',
        DESK_CONTROLS,
      )}
    >
      {/* 12px around the tabs and the search; 8px on a laptop, whose panel is 18.25rem
          (RosterDeskBoard's THE LAPTOP — «تمام اعتمد»). */}
      <div className="shrink-0 space-y-2.5 border-b border-slate-200 p-3 max-[1535px]:p-2 dark:border-slate-800">
        {/* The approved tabs at a computer's size: 36px, 13px words — both titles whole in 20rem.
            In the laptop's 18.25rem the tabs' own gaps close up (4px → 2px) so both titles stay
            whole on one line, with room for a two-digit count. */}
        <div className="[&_[role=tab]]:!h-9 [&_[role=tab]]:!gap-1 [&_[role=tab]]:!px-1 [&_[role=tab]]:!text-[13px] max-[1535px]:[&_[role=tab]]:!gap-0.5 max-[1535px]:[&_[role=tab]]:!px-0.5 max-[1535px]:[&_[role=tablist]]:!gap-0.5">
          <DriverTabs
            tab={tab}
            onTab={setTab}
            availableCount={m.poolLicensed.length}
            unavailableCount={m.unavailable.length}
            panelIds={panelIds}
          />
        </div>
        {/* One box per list, the other one hidden rather than unmounted: the box reports what is
            typed a moment later, and a tab switched in that moment must not lose the last keys. */}
        <div hidden={tab !== 'available'}>
          <DriverSearch value={availableSearch} onChange={setAvailableSearch} />
        </div>
        <div hidden={tab !== 'unavailable'}>
          <DriverSearch value={unavailableSearch} onChange={setUnavailableSearch} />
        </div>
      </div>
      <div
        role="tabpanel"
        id={panelIds.available}
        hidden={tab !== 'available'}
        className={panel('available')}
      >
        <div className={LIST_SCROLL} data-drivers-list="available">
          <AvailableList
            options={options}
            person={m.person}
            onPick={null}
            licence={m.licence}
            dayHasDrivers={m.dayHasDrivers}
            searched={availableSearch.trim() !== ''}
            draggable={mayPlan}
            hoverCard
            part="list"
          />
        </div>
      </div>
      <div
        role="tabpanel"
        id={panelIds.unavailable}
        hidden={tab !== 'unavailable'}
        className={panel('unavailable')}
      >
        <div className={LIST_SCROLL} data-drivers-list="unavailable">
          <UnavailableList
            drivers={unavailable}
            person={m.person}
            chips={m.chips}
            reasons={reasons}
            onToggleReason={onToggleReason}
            searched={unavailableSearch.trim() !== ''}
            dayHasAny={m.unavailable.length > 0}
            hoverCard
          />
        </div>
      </div>
      {/* The licence block belongs to the available tab and is pinned under its list: a child of
          the panel itself, so its `max-h-[45%]` is the panel's, as the board always sized it. */}
      {m.licence !== null && (
        <div
          data-licence-footer="true"
          hidden={tab !== 'available'}
          className={cn(
            'max-h-[45%] shrink-0 overflow-y-auto overscroll-contain border-t border-slate-200 pb-2 dark:border-slate-800',
            tab !== 'available' && 'hidden',
          )}
        >
          <AvailableList
            options={options}
            person={m.person}
            onPick={null}
            licence={m.licence}
            dayHasDrivers={m.dayHasDrivers}
            searched={availableSearch.trim() !== ''}
            draggable={mayPlan}
            hoverCard
            part="licence"
          />
        </div>
      )}
    </aside>
  );
};
