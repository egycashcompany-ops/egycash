// «الطقم الثابت» on a computer: the table's cells that are not the daily board's own — «واعمل
// ديزاين شاشة الطاقم الثابت زى التعيين اليومى», the daily look without a day.
//
//   FixedStatusCell  «الحالة»: «في الورشة» (when the workshop holds the car) over «معيّنة» or
//                    «بلا طقم» — the daily `StatusCell`'s face (one-line badges, stacked), with the
//                    standing crew's two words and none of the day's flags.
//   FixedNotesCell   «ملاحظات»: at most three lines, the whole note on hover — a long note never
//                    grows the row, so the table fits a laptop with «إجراءات» in sight.
//   fixedSeatFacts   what the daily `SeatCell` is told about a seat's person. Owner's answer 1 (ب):
//                    no flag for a standing member who can no longer drive — no expired licence,
//                    no absence, no reason badge, no amber frame. Only the move is said
//                    («سيُنقل من السيارة 214 عند الحفظ») and the person is named.
//
// Declared at module level, as the daily cells are: a component written inside the board would
// be a new element type on every render, and React would rebuild the cell under a drag in flight.
import { type FleetFixedCrewRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { hasDriver } from '../../lib/roster-view';
import { type FixedRosterBoardModel } from '../../lib/fixed-roster-model';
import { DASH, type SeatFacts } from './roster-desk-cells';

/** The «الحالة» badges, one line each: the workshop first, then crewed or not. */
export const FixedStatusCell = ({ row }: { row: FleetFixedCrewRowDto }): JSX.Element => (
  <span
    data-status-cell="true"
    className="mx-auto flex w-max flex-col items-center gap-1 [&_span]:whitespace-nowrap"
  >
    <FixedStatusBadges row={row} />
  </span>
);

const FixedStatusBadges = ({ row }: { row: FleetFixedCrewRowDto }): JSX.Element => {
  const t = useT();
  return (
    <>
      {/* The workshop badge is always said: the row's rose tint is never its only carrier. */}
      {row.inMaintenance && (
        <Badge tone="info" size="sm">
          {t('fleet.vehicles.inWorkshop')}
        </Badge>
      )}
      {/* `hasDriver`: a mission with nobody on it is not a crew. */}
      {hasDriver(row) ? (
        <Badge tone="success" size="sm">
          {t('fleet.roster.assigned')}
        </Badge>
      ) : (
        <Badge tone="neutral" size="sm">
          {t('fleet.fixedRoster.unassigned')}
        </Badge>
      )}
    </>
  );
};

/**
 * The note, three lines at most, the whole of it on hover. No `block` beside the clamp: the
 * clamp is a display of its own, and a later display utility would undo it.
 */
export const FixedNotesCell = ({ notes }: { notes: string | null }): JSX.Element =>
  notes === null ? (
    DASH
  ) : (
    <span
      data-fixed-note="true"
      title={notes}
      className="mx-auto line-clamp-3 min-w-[5rem] max-w-[8rem] whitespace-normal break-words text-xs leading-snug [text-wrap:balance] max-[1535px]:min-w-[3.125rem]"
    >
      {notes}
    </span>
  );

/** Nobody is flagged here (answer 1 ب) — the same empty answers for every seat. */
const NO_FLAGS: ReadonlySet<string> = new Set<string>();
const NO_REASONS: ReadonlyMap<string, string> = new Map<string, string>();

/**
 * The daily seat's facts for a standing crew: nobody flagged, nobody out, the move off a saved
 * seat on another car promised in one place, and the person by the screen's one people map.
 */
export const fixedSeatFacts = (
  m: Pick<FixedRosterBoardModel, 'transferFrom' | 'person'>,
): SeatFacts => ({
  expired: NO_FLAGS,
  unavailable: NO_REASONS,
  transferFrom: m.transferFrom,
  person: m.person,
  // Never reached: no seat here carries a reason.
  reasonLabel: (reason) => reason,
});
