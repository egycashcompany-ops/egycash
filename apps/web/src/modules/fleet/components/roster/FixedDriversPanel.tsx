// «الطقم الثابت» on a computer: the drivers panel beside the table — the daily board's panel
// («شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui»), minus the day.
//
// The daily panel has two tabs («السائقون المتاحون» / «غير المتاحين») and a licence block, all facts
// about a DAY. A standing crew asks no such question, so this panel has ONE list under ONE heading
// in the tabs' place — «السائقون (n)», n the drivers with no standing crew — and nothing pinned under
// it:
//
//   · first the drivers with no fixed crew, each draggable onto a seat (a planner), the name and
//     the code under it, with NO «متاح» beside them: every row here is simply a driver with no seat;
//   · then «معيّنون على سيارات أخرى (n)»: anyone the server holds on a car that is not on this board
//     (another branch's car, or a car out of service), with the blue «سيارة أخرى». Not draggable —
//     the daily rule for a seated row. A seat's list in the pen dialog still offers him, and the
//     save then says why it cannot stand;
//   · «لا يوجد سائقون بلا طقم ثابت» when everyone is crewed; a search that finds nobody says so.
//
// Owner's answer 1 (ب): no licence, profile or role flag on any row.
import { useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { type FixedRosterBoardModel } from '../../lib/fixed-roster-model';
import { DESK_CONTROLS, LIST_SCROLL } from './roster-desk-parts';
import { AvailableList, DriverSearch, DriversHeading } from './roster-drivers';

/**
 * The heading at a computer's size — the daily panel sizes its tabs the same way: 36px, 13px
 * words, the gaps closing up in the laptop's 18.25rem.
 */
const DESK_HEADING =
  '[&_[data-drivers-heading]]:!h-9 [&_[data-drivers-heading]]:!gap-1 [&_[data-drivers-heading]]:!px-1 [&_[data-drivers-heading]]:!text-[13px] max-[1535px]:[&_[data-drivers-heading]]:!gap-0.5 max-[1535px]:[&_[data-drivers-heading]]:!px-0.5';

export const FixedDriversPanel = ({
  m,
  mayPlan,
}: {
  m: FixedRosterBoardModel;
  mayPlan: boolean;
}): JSX.Element => {
  const t = useT();
  // The panel's own term: a name typed to find a driver is not a filter on the board.
  const [term, setTerm] = useState('');
  const searched = term.trim() !== '';
  return (
    <aside
      data-drivers-panel="true"
      data-fixed-drivers="true"
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]',
        DESK_CONTROLS,
      )}
    >
      {/* 12px around the heading and the search; 8px on a laptop, as the daily panel. */}
      <div className="shrink-0 space-y-2.5 border-b border-slate-200 p-3 max-[1535px]:p-2 dark:border-slate-800">
        <DriversHeading
          label={t('fleet.fixedRoster.driversTitle')}
          count={m.pool.length}
          className={DESK_HEADING}
        />
        <DriverSearch value={term} onChange={setTerm} />
      </div>
      <div className={LIST_SCROLL} data-drivers-list="fixed">
        {/* Nothing until the board answers: «nobody without a crew» is a fact about an answer. */}
        {m.board !== undefined && (
          <AvailableList
            options={m.availableFor(term, null)}
            person={m.person}
            onPick={null}
            licence={null}
            dayHasDrivers={m.board.drivers.length > 0}
            searched={searched}
            draggable={mayPlan}
            hoverCard
            part="list"
            freeBadge={false}
            emptyLabel={t('fleet.fixedRoster.poolEmpty')}
          />
        )}
      </div>
    </aside>
  );
};
