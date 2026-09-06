// The SECOND way to seat a driver: click the empty slot and type a name.
//
// Dragging is how a dispatcher who can see both the pool and the car does it, and it stays. It is
// also the only way that ever existed, which made the board unusable in the two situations it is
// most often read in: a pool of two hundred drivers where the person you want is somewhere below
// the fold, and a narrow screen where the panel and the row are not on top of one another at all.
// Typing a name answers "seat THIS person here" directly.
//
// ONE RULE, TWO GESTURES. This control decides nothing: it offers the drivers its owner hands it
// and reports the one that was chosen, and the owner runs the very same `assignDriver` a drop
// runs. So a slot that refuses a drop refuses a pick — a car in the workshop, a second seat with
// no first driver, a reader without `fleetRoster.plan` — because the owner never renders the
// control in the first place, and nothing here can route round the board rules.
//
// The list is the SAME list the pool panel shows, filtered by the same `filterDrivers`: whoever
// is already seated elsewhere is not in it, so a pick cannot silently steal a driver off another
// car the way an unfiltered search could.
import { useMemo, useRef, useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { useOnClickOutside } from '../../../shared/lib/useOnClickOutside';
import { PlusIcon } from '../../../shared/ui/icons';
import { DriverChip } from './DriverChip';
import { filterDrivers, type DriverSearchRecord } from '../lib/driver-search';

export interface DriverOption {
  employeeId: string;
}

export const DriverSlotPicker = ({
  drivers,
  index,
  onSelect,
  slotKey,
  label,
}: {
  /** Exactly the pool the board would let a drag carry — already free of anyone seated. */
  drivers: readonly DriverOption[];
  /** Names for the search, keyed by employee. The panels already load these records. */
  index: ReadonlyMap<string, DriverSearchRecord>;
  onSelect: (employeeId: string) => void;
  /** `vehicleId:slot` — the same key the drop zone carries, so a test can name one cell. */
  slotKey: string;
  /** Read out to a screen reader: which car, which seat. */
  label: string;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  /**
   * Where to draw the panel, measured from the trigger at the moment it opens.
   *
   * `position: fixed`, not `absolute`, and that is a fix rather than a preference: the board is a
   * `DataTable`, whose shell is `overflow-x-auto` so a wide table scrolls instead of taking the
   * page sideways. An absolutely-positioned child of a scroll container is CLIPPED by it — the
   * list opened, held its options, and was invisible below the row. A fixed panel is positioned
   * against the viewport, so the same scroll container cannot cut it off.
   */
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useOnClickOutside(boxRef, () => setOpen(false), open);

  const shown = useMemo(() => filterDrivers(drivers, index, term), [drivers, index, term]);

  return (
    <div ref={boxRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        data-driver-picker={slotKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} · ${t('fleet.roster.pickDriver')}`}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect !== undefined) {
            // Below the slot, and aligned to it. Flipped above when the row sits near the bottom
            // of the viewport, so the list is never drawn off-screen.
            const height = 280;
            const below = rect.bottom + 4;
            setAt({
              top: below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)),
              width: Math.max(rect.width, 240),
            });
          }
          setOpen((o) => !o);
          setTerm('');
        }}
        className="inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
      >
        <PlusIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t('fleet.roster.pickDriver')}</span>
      </button>

      {open && (
        <div
          data-driver-picker-panel={slotKey}
          style={
            at === null ? undefined : { position: 'fixed', top: at.top, left: at.left, width: 256 }
          }
          className="z-50 mt-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <SearchInput
            value={term}
            onChange={setTerm}
            placeholder={t('fleet.fixedRoster.driverSearchPlaceholder')}
            className="w-full"
          />
          {shown.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
              {/* Two different emptinesses, said differently: nobody is free today, versus
                  nobody matches what was typed. */}
              {drivers.length === 0
                ? t('fleet.roster.availableEmpty')
                : t('fleet.fixedRoster.driverSearchEmpty')}
            </p>
          ) : (
            <ul role="listbox" className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {shown.map((driver) => (
                <li key={driver.employeeId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-driver-option={driver.employeeId}
                    onClick={() => {
                      // The owner's handler — the same one a drop calls. Closing after, so a
                      // mis-click can be corrected by opening it again rather than by undoing.
                      onSelect(driver.employeeId);
                      setOpen(false);
                      setTerm('');
                    }}
                    className="w-full rounded-md text-start hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
                  >
                    <DriverChip employeeId={driver.employeeId} className="w-full" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
