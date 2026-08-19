// A draggable crew card — the legacy pool card (tashghela.ejs:861-880), rebuilt.
//
// THE ICONS ARE INDICATORS, NOT GATES. Legacy showed a gun, an id, a signature and a "new" badge
// beside each name, and the same icons doubled as filter buttons (:1114-1142). None of them ever
// stopped an assignment — server-side they were never read at all (discovery §9.2) — and that is
// the approved decision this UI carries forward: they inform the planner, they do not decide.
// They live in `CrewFlagIcons`, which is also where the temporary licence finally appears.
//
// The card is also the drag SOURCE. HTML5 drag and drop, no library: the legacy board did the same
// by hand, and the interaction is small enough that a dependency would cost more than it saves.
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';
import { CrewFlagIcons } from './CrewFlagIcons';

/** The MIME type the board's drop targets accept — narrow, so a stray drag is ignored. */
export const CREW_DRAG_TYPE = 'application/x-ecms-crew-member';

export const CrewMemberCard = ({
  member,
  draggable = true,
  onRemove,
}: {
  member: OperationsCrewMemberDto;
  draggable?: boolean;
  onRemove?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const req = member.requirements;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(CREW_DRAG_TYPE, member.employeeId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800"
      data-employee-id={member.employeeId}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{member.fullNameAr}</span>
          {req?.isCaptain === true && (
            <Badge tone="brand" size="sm">
              {t('operations.crew.role.captain')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular-nums">{member.code}</span>
          {/* Who carries what — weapon, signature, licence, temporary licence. Indicators only. */}
          <CrewFlagIcons requirements={req} />
          {req?.isNewJoiner === true && (
            <Badge tone="info" size="sm">
              {t('operations.crew.flag.isNewJoiner')}
            </Badge>
          )}
        </div>
      </div>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={t('common.remove')}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
};
