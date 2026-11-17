// «لوحة التشغيلة» — the list the «بدون سيارة» cell of a row opens (Round 24).
//
// THE OWNER: «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم».
// Every car with no crew that day (`vehicleChoices` — the server's `freeVehicles` seen through the
// draft), as the slot's list draws people (`CrewSlotPicker`):
//   · the head says which row is being given a car;
//   · a search by code («١٥٠» finds 150; «150 - 151» both), or by a roster van's driver;
//   · the cars in groups, each under its heading and its count — the Fleet roster's vans first, each
//     with its drivers' names («تعيين السيارات» gives a car its drivers), then the cash-transfer
//     operations' cars, the standing crew's, and every other active car of the fleet;
//   · a car IN THE WORKSHOP that day is listed and marked «في الصيانة»; off the roster it cannot be
//     picked (the save would refuse it) and says why.
// A pick runs the page's `giveVan` (the round-22 and round-23 checks first), and the list closes;
// Escape, a press outside, or its ✕ close it too.
//
// THE KEYBOARD: the search is a combobox over a listbox; the arrows walk the cars that can be
// picked, Enter picks, Escape closes (the focus back on the cell). A COMPUTER draws it under the
// cell, over the page; a PHONE gets Fleet's bottom sheet.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { OPERATIONS_CREW_FREE_VEHICLE_GROUPS } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { CloseIcon } from '../../../shared/ui/icons';
import { useAppSelector } from '../../../store';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { BottomSheet } from '../../fleet/components/roster/RosterBottomSheet';
import { searchVehicleChoices, type VehicleChoice } from '../lib/crew-vehicles';
import { usePickerSpot } from './CrewSlotPicker';
import { PLAN_ICON } from './crew-plan-icons';

/** The next car the arrows can land on from `from`, in `step`'s direction — wrapping; -1 for none. */
export const nextPickableCar = (
  choices: readonly VehicleChoice[],
  from: number,
  step: 1 | -1,
): number => {
  const count = choices.length;
  for (let moved = 1; moved <= count; moved += 1) {
    const at = (((from + step * moved) % count) + count) % count;
    if (choices[at]?.pickable === true) return at;
  }
  return -1;
};

export interface VehiclePickerProps {
  rowKey: string;
  rowName: string;
  /** The cell on the page — the list is placed under it. */
  anchor: RefObject<HTMLElement | null>;
  /** What opened it — a press there is not «outside». */
  trigger: RefObject<HTMLElement | null>;
  sheet: boolean;
  /** What the row may take, in the list's order (`vehicleChoices`). */
  choices: readonly VehicleChoice[];
  onPick: (choice: VehicleChoice) => void;
  /** `back`: put the focus back on the cell (Escape, the ✕) — not after a press elsewhere. */
  onClose: (back: boolean) => void;
  /**
   * Round 27 — the same list on «الطاقم الثابت»'s «إضافة سيارة»: its own head and its own word for
   * «nothing left to offer». The board's words when left out.
   */
  words?: { title: string; subtitle: string; none: string; search: string };
}

export const CrewVehiclePicker = ({
  rowKey,
  rowName,
  anchor,
  trigger,
  sheet,
  choices,
  onPick,
  onClose,
  words,
}: VehiclePickerProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const id = useId();
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const spot = usePickerSpot(anchor, !sheet);

  const listed = searchVehicleChoices(choices, search);
  const found = listed.findIndex((choice) => choice.vehicleId === activeId);
  const active =
    found >= 0 && listed[found]?.pickable === true ? found : nextPickableCar(listed, -1, 1);
  const activeChoice = active >= 0 ? listed[active] : undefined;
  const optionId = (vehicleId: string): string => `${id}-car-${vehicleId}`;

  useEffect(() => {
    if (sheet) return undefined;
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [sheet]);

  const activeKey = activeChoice?.vehicleId ?? null;
  useEffect(() => {
    if (activeKey !== null)
      document.getElementById(`${id}-car-${activeKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, id]);

  // A press anywhere but the list and what opened it closes it (the bottom sheet has its scrim).
  useEffect(() => {
    if (sheet) return undefined;
    const away = (event: PointerEvent): void => {
      const at = event.target as Node;
      if (panel.current?.contains(at) || trigger.current?.contains(at)) return;
      close.current(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [sheet, trigger]);

  const pick = (choice: VehicleChoice | undefined): void => {
    if (choice === undefined || !choice.pickable) return;
    onPick(choice);
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextPickableCar(listed, active, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) setActiveId(listed[next]?.vehicleId ?? null);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(activeChoice);
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close.current(true);
  };

  const title = words?.title ?? t('operations.crewPlan.vehicles.title');
  const searchWord = words?.search ?? t('operations.crewPlan.vehicles.search');
  const subtitle = words?.subtitle ?? t('operations.crewPlan.picker.row', { row: rowName });

  const searchBox = (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeKey === null ? undefined : optionId(activeKey)}
        aria-label={searchWord}
        autoComplete="off"
        inputMode="search"
        placeholder={searchWord}
        value={search}
        data-vehicle-search="true"
        onChange={(event) => {
          setSearch(event.target.value);
          setActiveId(null);
        }}
        onKeyDown={onSearchKey}
        className="h-9 w-full rounded-lg border border-slate-300 bg-white pe-2 ps-8 text-base font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 sm:h-8 sm:text-[12.5px] dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-100"
      />
    </div>
  );

  const option = (choice: VehicleChoice): JSX.Element => {
    const on = listed[active] === choice;
    const drivers = choice.drivers
      .map((driver) => driver.fullNameAr)
      .filter((name): name is string => name !== null && name !== '');
    return (
      <div
        key={choice.vehicleId}
        id={optionId(choice.vehicleId)}
        role="option"
        aria-selected={on}
        aria-disabled={choice.pickable ? undefined : true}
        data-vehicle-option={choice.vehicleId}
        data-vehicle-group={choice.group}
        data-vehicle-workshop={choice.inWorkshop ? 'true' : undefined}
        data-pick-active={on ? 'true' : undefined}
        title={
          choice.pickable
            ? undefined
            : t('operations.crewPlan.vehicles.workshopRefused', { code: choice.vehicleCode })
        }
        onMouseEnter={() => {
          if (choice.pickable) setActiveId(choice.vehicleId);
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(choice)}
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
          choice.pickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
          on && 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/40 dark:bg-brand-500/15',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            choice.onRoster
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
          )}
        >
          <BoardIcon d={[...PATH.truck]} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <bdi
            dir="ltr"
            className={cn(
              NUM,
              'block truncate text-[14px] font-black leading-5 text-slate-900 dark:text-white',
            )}
          >
            {choice.vehicleCode}
          </bdi>
          {drivers.length > 0 && (
            <span className="block truncate text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
              {drivers.join('، ')}
            </span>
          )}
        </span>
        {choice.inWorkshop && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-50 px-1.5 text-[11px] font-black leading-5 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30">
            <BoardIcon d={PLAN_ICON.wrench} className="h-3 w-3" />
            {t('operations.crewPlan.vehicles.inWorkshop')}
          </span>
        )}
      </div>
    );
  };

  const list = (
    <div
      id={`${id}-list`}
      role="listbox"
      aria-label={`${title} — ${rowName}`}
      data-vehicle-list={rowKey}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        sheet ? 'px-3 py-2' : 'p-1.5',
      )}
    >
      {listed.length === 0 && (
        <p className="px-2 py-6 text-center text-[12.5px] font-bold text-slate-500 dark:text-slate-400">
          {search.trim() === ''
            ? (words?.none ?? t('operations.crewPlan.noEmptyVehicle'))
            : t('operations.crewPlan.vehicles.noMatch')}
        </p>
      )}
      {OPERATIONS_CREW_FREE_VEHICLE_GROUPS.map((group) => {
        const part = listed.filter((choice) => choice.group === group);
        if (part.length === 0) return null;
        return (
          <div
            key={group}
            role="group"
            aria-labelledby={`${id}-${group}`}
            data-vehicle-section={group}
          >
            <div
              id={`${id}-${group}`}
              className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-black text-slate-500 dark:text-slate-400"
            >
              <span className="min-w-0 truncate">
                {t(`operations.crewPlan.vehicles.group.${group}`)}
              </span>
              <span className={cn(NUM, 'shrink-0 opacity-80')}>
                {formatNumber(part.length, locale)}
              </span>
            </div>
            {part.map(option)}
          </div>
        );
      })}
    </div>
  );

  if (sheet) {
    return (
      <BottomSheet
        name="crew-vehicle-picker"
        tall
        open
        onClose={() => close.current(true)}
        title={title}
        subtitle={subtitle}
        toolbar={<div ref={panel}>{searchBox}</div>}
      >
        {list}
      </BottomSheet>
    );
  }
  if (spot === null) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={`${title} — ${rowName}`}
      data-vehicle-picker={rowKey}
      onKeyDown={onPanelKey}
      style={{
        position: 'fixed',
        left: spot.left,
        width: Math.min(spot.width, 320),
        maxHeight: spot.maxHeight,
        ...(spot.top === undefined ? { bottom: spot.bottom } : { top: spot.top }),
      }}
      className="z-[75] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 animate-menu-in dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/60"
    >
      <div className="shrink-0 space-y-2 border-b border-slate-200 px-2.5 pb-2.5 pt-2 dark:border-slate-800">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-black leading-5 text-slate-900 dark:text-white">
              {title}
            </p>
            <p className="truncate text-[11.5px] font-bold leading-4 text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => close.current(true)}
            aria-label={t('common.close')}
            className="-me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {searchBox}
      </div>
      {list}
    </div>,
    document.body,
  );
};
