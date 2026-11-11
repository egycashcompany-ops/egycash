// «تعيين السيارات» on a phone and a tablet — the touch board's smaller pieces, ported from the
// approved samples («انا برشح دول») without a change of look: the day stepper, the Excel button, the
// counter chips, the filter button and its red reset, the drivers button, the car-code search, the
// workshop group, and the small sheets (filters, mission, note, confirm). Each is the computer's
// control at a finger's size — the same words (`t()`), the same tones (COUNTER_TONES /
// missionTone), the same rules — and every figure in Latin digits.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { Button } from '../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../shared/ui/form';
import {
  CheckIcon,
  ChevronEndIcon,
  ChevronIcon,
  ChevronStartIcon,
  CloseIcon,
  DownloadIcon,
  ResetIcon,
  SearchIcon,
  UsersIcon,
  WrenchIcon,
} from '../../../../shared/ui/icons';
import { DateBox } from '../DateBox';
import { type MissionOption } from '../../lib/roster-board';
import { BottomSheet } from './RosterBottomSheet';
import { CodeList, Count, num, slashDate, weekdayOf } from './roster-parts';

// ── the day ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ‹ اليوم السابق | the day | اليوم التالي › — one 48px control, the date as text (Latin digits).
 * On any other day than today, «اليوم» is a button back to it (one tap, not four arrows).
 *
 * The day's box is a `DateBox` — «أي مكان فيه تاريخ يبقى نفس الشكل»: our cyan calendar opens its
 * picker. Here the calendar stands at the head of the line, where the approved stepper drew it,
 * and the box itself is laid invisibly over the whole line, so a tap anywhere on the day opens the
 * phone's own picker as before.
 */
export const DayStepper = ({
  date,
  isToday,
  onStep,
  onPick,
  onToday,
  className,
}: {
  date: string;
  isToday: boolean;
  onStep: (delta: number) => void;
  onPick: (ymd: string) => void;
  onToday: () => void;
  className?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const arrow =
    'flex w-12 shrink-0 items-center justify-center text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800';
  return (
    <div
      data-day-stepper="true"
      className={cn(
        'flex h-12 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
    >
      <button
        type="button"
        aria-label={t('fleet.roster.prevDay')}
        title={t('fleet.roster.prevDay')}
        onClick={() => onStep(-1)}
        className={cn(arrow, 'border-e border-slate-200 dark:border-slate-700')}
      >
        <ChevronStartIcon className="h-5 w-5 rtl:-scale-x-100" />
      </button>
      <DateBox
        label={t('fleet.roster.date')}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 px-2',
          // The calendar button is the line's first item (in the flow, an 18px icon), not laid
          // over the box's start edge: the line is centred, and so is its calendar. Its press area
          // is the stepper's full height and 8px either side of the icon, taking no room.
          '[&>button]:static [&>button]:-order-1 [&>button]:-mx-2 [&>button]:self-stretch [&>button]:px-2 [&>button>span]:p-0 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        )}
      >
        <input
          type="date"
          aria-label={t('fleet.roster.date')}
          value={date}
          onChange={(event) => {
            if (event.target.value !== '') onPick(event.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {weekdayOf(date, locale)}
        </span>
        <bdi
          dir="ltr"
          data-day={date}
          className="font-figures text-[15px] font-semibold text-slate-900 dark:text-slate-50"
        >
          {slashDate(date)}
        </bdi>
        {isToday && (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {t('fleet.dash.common.today')}
          </span>
        )}
      </DateBox>
      {!isToday && (
        <button
          type="button"
          data-go-today="true"
          onClick={onToday}
          className="flex shrink-0 items-center border-s border-slate-200 px-3 text-[13px] font-semibold text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-100 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
        >
          {t('fleet.dash.common.today')}
        </button>
      )}
      <button
        type="button"
        aria-label={t('fleet.roster.nextDay')}
        title={t('fleet.roster.nextDay')}
        onClick={() => onStep(1)}
        className={cn(arrow, 'border-s border-slate-200 dark:border-slate-700')}
      >
        <ChevronEndIcon className="h-5 w-5 rtl:-scale-x-100" />
      </button>
    </div>
  );
};

/** The Excel action — the computer's green download, at 44px. */
export const ExcelButton = ({ onExport }: { onExport: () => void }): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-export="roster"
      aria-label={t('fleet.export.excel')}
      title={t('fleet.export.excel')}
      onClick={onExport}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-green-700 shadow-sm transition-colors hover:bg-green-50 active:bg-green-100 dark:border-slate-700 dark:bg-slate-900 dark:text-green-400 dark:hover:bg-green-950/40"
    >
      <DownloadIcon className="h-5 w-5" />
    </button>
  );
};

// ── the car-code search ─────────────────────────────────────────────────────────────────────────

/**
 * «ابحث بكود السيارة…» — the owner: «مينفعش ابحث فى الفون او التابلت ؟». The shared SearchInput's
 * look (icon at the start, ✕ at the end, 16px words so a phone does not zoom) at a finger's size:
 * 48px tall, a 48px ✕ that clears the term only.
 *
 * The FULL keyboard (`type="search"`, no `inputMode`): its search key folds the keyboard away, and
 * it has the space and the dash that type several codes at once («120 133», «120 - 489») and the
 * letters of a worded code («كورولا 1», «MG 2») — a number pad has none of them. The browser's own
 * ✕ of a search box is hidden so there is one ✕, not two; ours empties the box and leaves it
 * focused, so the next code is typed at once (the keyboard stays, a screen reader keeps its place).
 */
export const CarSearch = ({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div data-car-search="true" className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5 text-slate-400">
        <SearchIcon className="h-[18px] w-[18px]" />
      </span>
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-label={t('fleet.vehicles.fields.code')}
        placeholder={t('fleet.roster.searchPlaceholder')}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        // The app's focus ring drawn INSIDE the box: on the phone the sticky filter row follows
        // the box at once and would paint over a ring drawn outside it.
        className="h-12 w-full rounded-xl border border-slate-200 bg-white pe-12 ps-10 text-base text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus-visible:ring-inset focus-visible:ring-offset-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== '' && (
        <button
          type="button"
          data-clear-car-search="true"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          aria-label={t('common.clear')}
          title={t('common.clear')}
          className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-e-xl text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

// ── the counters ────────────────────────────────────────────────────────────────────────────────

/** One chip as the touch board draws it: the model's counter, and what a tap does here. */
export interface TouchCounter {
  key: string;
  label: string;
  value: number;
  tone: string;
  active: boolean;
  apply: () => void;
}

/** The computer's chips (same tones, tap = filter, active = ring), 48px tall, one scrolling line. */
export const CounterChips = ({ counters }: { counters: readonly TouchCounter[] }): JSX.Element => (
  <>
    {counters.map((counter) => (
      <button
        key={counter.key}
        type="button"
        data-counter={counter.key}
        data-active={counter.active ? 'true' : undefined}
        aria-pressed={counter.active}
        onClick={counter.apply}
        className={cn(
          'flex h-12 min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-lg px-2.5 font-medium transition-shadow',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          counter.tone,
          // The chips' ring (offset 1): 3px outside the chip, inside the row's own padding.
          counter.active
            ? 'ring-2 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-950'
            : 'ring-0',
        )}
      >
        <span className="whitespace-nowrap text-[11px] leading-4">{counter.label}</span>
        <span className="font-figures text-[15px] font-bold leading-5">{num(counter.value)}</span>
      </button>
    ))}
  </>
);

const FunnelIcon = ({ className }: { className?: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
  </svg>
);

/** «عوامل التصفية» — opens the filters sheet; its badge counts every narrowing the URL holds. */
export const FilterButton = ({
  count,
  onOpen,
  compact = false,
}: {
  count: number;
  onOpen: () => void;
  compact?: boolean;
}): JSX.Element => {
  const t = useT();
  const on = count > 0;
  return (
    <button
      type="button"
      data-open-filters="true"
      aria-label={t('fleet.roster.filters')}
      onClick={onOpen}
      className={cn(
        'relative flex h-12 shrink-0 items-center gap-1.5 rounded-lg border font-semibold transition-colors',
        compact ? 'w-12 justify-center' : 'px-3 text-sm',
        on
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-200'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      <FunnelIcon className="h-[18px] w-[18px]" />
      {!compact && <span>{t('fleet.roster.filters')}</span>}
      {on && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 font-figures text-[11px] font-bold text-white">
          {num(count)}
        </span>
      )}
    </button>
  );
};

/**
 * The red reset, as the Fleet routes paint it — shown only while something narrows the board, and
 * placed right after the filter button so it is never scrolled off with the chips. On a phone it
 * is the icon alone (its words are its accessible name).
 */
export const ResetChip = ({
  onReset,
  compact = false,
}: {
  onReset: () => void;
  compact?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-reset-filters="true"
      onClick={onReset}
      aria-label={t('common.filters.clear')}
      title={t('common.filters.clear')}
      className={cn(
        'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900',
        compact ? 'w-12 justify-center' : 'px-3',
      )}
    >
      <ResetIcon className="h-4 w-4" />
      {!compact && t('common.filters.clear')}
    </button>
  );
};

/**
 * «السائقون» — the day's drivers on a phone and a portrait tablet: in the filter row, next to the
 * counters, on every day (a past day too). Opens the drivers sheet.
 */
export const DriversButton = ({
  count,
  onOpen,
  compact = false,
}: {
  count: number;
  onOpen: () => void;
  compact?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-open-pool="true"
      onClick={onOpen}
      aria-label={t('fleet.roster.availableTitle')}
      title={t('fleet.roster.availableTitle')}
      className={cn(
        'flex h-12 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 active:bg-emerald-900 dark:bg-emerald-600 dark:hover:bg-emerald-500',
        compact ? 'px-2.5' : 'pe-2.5 ps-3 text-sm',
      )}
    >
      <UsersIcon className="h-5 w-5 shrink-0" />
      {!compact && <span className="whitespace-nowrap">{t('fleet.fixedRoster.driversTitle')}</span>}
      <span className="rounded-full bg-white/20 px-1.5 font-figures text-[13px] leading-5">
        {num(count)}
      </span>
    </button>
  );
};

// ── the workshop group ──────────────────────────────────────────────────────────────────────────

/** «في الورشة (n)» — the cars the workshop holds, last and folded: there is nothing to do on them. */
export const WorkshopGroup = ({
  rows,
  open,
  onToggle,
  children,
}: {
  rows: readonly FleetRosterRowDto[];
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <section data-workshop-group="true" data-open={open ? 'true' : 'false'} className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        data-workshop-toggle="true"
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 text-start shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <WrenchIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-50">
            {t('fleet.vehicles.inWorkshop')}{' '}
            <Count value={rows.length} className="font-medium text-slate-500 dark:text-slate-400" />
          </span>
          <CodeList
            codes={rows.map((row) => row.code)}
            className="block text-xs text-slate-500 dark:text-slate-400"
          />
        </span>
        <ChevronIcon
          className={cn(
            'h-5 w-5 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
};

// ── the small sheets ────────────────────────────────────────────────────────────────────────────

const OptionRow = ({
  on,
  onClick,
  children,
  name,
  multi = false,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  name?: string;
  multi?: boolean;
}): JSX.Element => (
  <button
    type="button"
    role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
    aria-checked={on}
    data-option={name}
    onClick={onClick}
    className={cn(
      'flex min-h-14 w-full items-center gap-3 px-4 text-start text-[15px] transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60',
      on ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200',
    )}
  >
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center border-2 transition-colors',
        multi ? 'rounded-md' : 'rounded-full',
        on
          ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500'
          : 'border-slate-300 dark:border-slate-600',
      )}
    >
      {on && <CheckIcon className="h-4 w-4" />}
    </span>
    <span className="min-w-0 flex-1">{children}</span>
  </button>
);

/** The mission pill's sheet: «بدون نوع مهمة», then every active mission type. */
export const MissionSheet = ({
  row,
  missions,
  onPick,
  onClose,
}: {
  row: FleetRosterRowDto | null;
  missions: readonly MissionOption[];
  onPick: (id: string | null) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <BottomSheet
      name="mission"
      open={row !== null}
      onClose={onClose}
      title={t('fleet.roster.assignTitle', { code: row?.code ?? '' })}
      subtitle={t('fleet.roster.fields.mission')}
    >
      <div className="divide-y divide-slate-100 pb-2 dark:divide-slate-800/80" role="menu">
        <OptionRow on={row?.missionTypeId === null} onClick={() => onPick(null)} name="none">
          {t('fleet.fixedRoster.noMissionType')}
        </OptionRow>
        {missions.map((mission) => (
          <OptionRow
            key={mission.id}
            on={row?.missionTypeId === mission.id}
            onClick={() => onPick(mission.id)}
            name={mission.id}
          >
            <span
              className={cn(
                'inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold',
                mission.tone,
              )}
            >
              {mission.label}
            </span>
          </OptionRow>
        ))}
      </div>
    </BottomSheet>
  );
};

/**
 * «عوامل التصفية» — the car codes as buttons (`?q=`) and «نوع المهمة» (`?mission=`, kept on touch:
 * the owner removed only the computer's dropdown). Its footer resets every filter and the typed
 * code, and «عرض النتائج (n)» closes it on what they leave.
 */
export const FiltersSheet = ({
  open,
  onClose,
  codes,
  pickedCodes,
  onToggleCode,
  missions,
  pickedMissions,
  onToggleMission,
  onAllMissions,
  onReset,
  results,
  filtered,
}: {
  open: boolean;
  onClose: () => void;
  codes: readonly string[];
  pickedCodes: readonly string[];
  onToggleCode: (code: string) => void;
  missions: readonly MissionOption[];
  pickedMissions: readonly string[];
  onToggleMission: (id: string) => void;
  onAllMissions: () => void;
  onReset: () => void;
  results: number;
  filtered: boolean;
}): JSX.Element => {
  const t = useT();
  const head = 'px-4 pb-2 pt-4 text-[13px] font-semibold text-slate-500 dark:text-slate-400';
  return (
    <BottomSheet
      name="filters"
      open={open}
      onClose={onClose}
      title={t('fleet.roster.filters')}
      footer={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-reset-filters="sheet"
            disabled={!filtered}
            onClick={onReset}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:disabled:border-slate-800 dark:disabled:bg-transparent dark:disabled:text-slate-600"
          >
            <ResetIcon className="h-4 w-4" />
            {t('common.filters.clear')}
          </button>
          <Button onClick={onClose} className="min-h-11 flex-1">
            {t('fleet.roster.showResults', { count: num(results) })}
          </Button>
        </div>
      }
    >
      <div className={cn(head, '!pt-1')}>{t('fleet.vehicles.fields.code')}</div>
      <div className="grid grid-cols-5 gap-2 px-4 md:grid-cols-7">
        {codes.map((code) => {
          const on = pickedCodes.includes(code);
          return (
            <button
              key={code}
              type="button"
              data-filter-code={code}
              aria-pressed={on}
              onClick={() => onToggleCode(code)}
              className={cn(
                'flex h-11 items-center justify-center rounded-lg border font-figures text-[15px] font-semibold transition-colors',
                on
                  ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-600'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800',
              )}
            >
              <bdi dir="ltr">{code}</bdi>
            </button>
          );
        })}
      </div>
      <div className={cn(head, 'mt-2')}>{t('fleet.roster.fields.mission')}</div>
      <div className="divide-y divide-slate-100 pb-2 dark:divide-slate-800/80" role="menu">
        <OptionRow multi on={pickedMissions.length === 0} onClick={onAllMissions} name="all">
          {t('fleet.roster.allMissions')}
        </OptionRow>
        {missions.map((mission) => (
          <OptionRow
            multi
            key={mission.id}
            on={pickedMissions.includes(mission.id)}
            onClick={() => onToggleMission(mission.id)}
            name={mission.id}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold',
                  mission.tone,
                )}
              >
                {mission.label}
              </span>
              <span className="font-figures text-sm text-slate-500 dark:text-slate-400">
                {num(mission.count)}
              </span>
            </span>
          </OptionRow>
        ))}
      </div>
    </BottomSheet>
  );
};

/**
 * «تعديل التعيين» on touch — the note, the one fact of the four the card cannot edit by itself
 * (the mission is the pill, the drivers are the seats). «حفظ» here saves into the DRAFT, exactly as
 * the computer's dialog does; the day is stored by the unsaved bar's «حفظ».
 */
export const NotesSheet = ({
  row,
  onSave,
  onClose,
}: {
  row: FleetRosterRowDto | null;
  onSave: (notes: string) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState('');
  useEffect(() => {
    if (row !== null) setText(row.notes ?? '');
  }, [row]);
  return (
    <BottomSheet
      name="notes"
      open={row !== null}
      onClose={onClose}
      title={t('fleet.roster.assignTitle', { code: row?.code ?? '' })}
      subtitle={t('fleet.roster.editAssignment')}
      footer={
        <div className="flex items-center gap-2.5">
          <Button data-save-notes="true" onClick={() => onSave(text)} className="min-h-12 flex-1">
            {t('common.save')}
          </Button>
          <Button variant="secondary" onClick={onClose} className="min-h-12 shrink-0">
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="px-4 pb-4 pt-1">
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            data-notes-input="true"
            rows={4}
            textScale="comfortable"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-28"
          />
        </Field>
      </div>
    </BottomSheet>
  );
};

/**
 * A confirm on touch: a short sheet with the two choices as full 48px buttons under the thumb —
 * the destructive one first (the start edge), the way back beside it. Used for «إلغاء التعيين —
 * {{code}}» (the computer's confirm, same words) and for discarding several cars' edits.
 */
export const ConfirmSheet = ({
  name,
  open,
  title,
  children,
  confirmLabel,
  backLabel,
  onConfirm,
  onClose,
}: {
  name: string;
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  backLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element => (
  <BottomSheet
    name={name}
    open={open}
    onClose={onClose}
    title={title}
    footer={
      <div className="flex items-center gap-2.5">
        <Button
          variant="danger"
          data-confirm={name}
          onClick={onConfirm}
          className="min-h-12 flex-1 text-[15px]"
        >
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onClose} className="min-h-12 shrink-0 px-5">
          {backLabel}
        </Button>
      </div>
    }
  >
    <div className="px-4 pb-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</div>
  </BottomSheet>
);
