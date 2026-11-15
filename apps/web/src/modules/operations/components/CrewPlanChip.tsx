// One person on «لوحة التشغيلة» — in a pool, or seated in a row's slot.
//
// THE COLOUR IS THE ROLE, as the legacy board drew it and as the owner reads it: GREEN a captain,
// BLUE a specialist who also leads («اللى فى خانة القادة بس لونهم ازرق»), RED a specialist
// (`crewRoleOf`). The requirement icons sit beside the name («يظهر جمب القائد او الاخصائى»).
//
// TWO WAYS TO MOVE IT, both always there:
//   · DRAG it (HTML5, the board's own MIME type) onto a slot, or back onto a pool;
//   · or PRESS it (mouse, Enter or Space) to pick it up — it rings — then press «ضع هنا» in a slot.
//     The keyboard's way and the phone's, where a drag does not exist; as «توزيع المحصنات» offers
//     its «نقل إلى…» beside the drag.
import { type DragEvent } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { NUM } from '../../fleet/components/FuelCardBoard';
import { crewRoleOf, flagsOf, type CrewRole } from '../lib/crew-plan';
import { CREW_DRAG_TYPE } from './CrewMemberCard';
import { CrewFlagMarks } from './crew-plan-icons';

export { CREW_DRAG_TYPE };

/** Does this drag carry one of the board's people? A file or a link dragged over a slot is not. */
export const carriesCrewMember = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer.types).includes(CREW_DRAG_TYPE);

/** The role's fill — solid, as legacy's, so a column of names reads by colour first. */
export const ROLE_FILL: Record<CrewRole, string> = {
  captain: 'bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600',
  dual: 'bg-sky-600 hover:bg-sky-500 dark:bg-sky-700 dark:hover:bg-sky-600',
  specialist: 'bg-rose-600 hover:bg-rose-500 dark:bg-rose-700 dark:hover:bg-rose-600',
};

/** The role's colour without its hover — under the seated chip's ✕, which covers the icons. */
const ROLE_FLAT: Record<CrewRole, string> = {
  captain: 'bg-emerald-700 dark:bg-emerald-800',
  dual: 'bg-sky-700 dark:bg-sky-800',
  specialist: 'bg-rose-700 dark:bg-rose-800',
};

/** The role's dot — the legend uses the same three colours. */
export const ROLE_DOT: Record<CrewRole, string> = {
  captain: 'bg-emerald-600 dark:bg-emerald-500',
  dual: 'bg-sky-600 dark:bg-sky-500',
  specialist: 'bg-rose-600 dark:bg-rose-500',
};

export const CrewPlanChip = ({
  member,
  variant,
  selected,
  dragging,
  canPlan,
  placedAt,
  outOfRole,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  member: OperationsCrewMemberDto;
  /**
   * Both ONE line — the name, then the icons. `pool` a size larger. The code is in the hover, not on
   * the chip: a second line for it halved how many names a pool shows (four of twenty-five on a
   * 1440 laptop), and legacy's chips carried no code either; the pool's search still finds by code.
   */
  variant: 'pool' | 'seat';
  selected: boolean;
  dragging: boolean;
  canPlan: boolean;
  /**
   * In a pool: where they already sit — `short` on the chip («213»), `long` in its hover
   * («213 · قائد الطاقم»). The chip is dimmed and says so.
   */
  placedAt?: { short: string; long: string } | null;
  /** Seated outside their role — a quiet mark, never a refusal (see `outOfRole`). */
  outOfRole?: string | null;
  onSelect: () => void;
  /** Seated: the ✕ that sends them back to the pool. */
  onRemove?: (() => void) | undefined;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}): JSX.Element => {
  const t = useT();
  const role = crewRoleOf(member.requirements);
  const flags = flagsOf(member);
  const where = placedAt ?? null;
  const placed = where !== null;
  const roleName = t(`operations.crewPlan.role.${role}`);
  // The whole name and the code on hover; the name on the chip is cut to its column.
  const title = `${member.fullNameAr} · ${member.code} · ${roleName}${where === null ? '' : ` · ${where.long}`}`;

  return (
    <div
      draggable={canPlan}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-crew-chip={member.employeeId}
      data-role={role}
      data-placed={placed ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group/chip relative flex min-w-0 items-stretch rounded-lg text-white shadow-sm transition',
        ROLE_FILL[role],
        canPlan && 'cursor-grab active:cursor-grabbing',
        placed && 'opacity-50 saturate-50 hover:opacity-80',
        dragging && 'opacity-30',
        selected &&
          'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-amber-300 dark:ring-offset-[#0b1226]',
      )}
    >
      <button
        type="button"
        data-cell-control="chip"
        disabled={!canPlan}
        aria-pressed={selected}
        aria-label={t('operations.crewPlan.chip.select', { name: member.fullNameAr })}
        title={title}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-default',
          variant === 'pool' ? 'rounded-lg px-2 py-1' : 'rounded-lg py-1 pe-1 ps-1.5',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-bold leading-5',
            variant === 'pool' ? 'text-[13px]' : 'text-[12.5px]',
          )}
        >
          {member.fullNameAr}
        </span>
        {where !== null && (
          <span
            data-placed-at="true"
            className={cn(
              NUM,
              'shrink-0 rounded bg-black/30 px-1 text-[11px] font-black leading-4 text-white',
            )}
          >
            {where.short}
          </span>
        )}
        <CrewFlagMarks flags={flags} size={variant === 'pool' ? 'sm' : 'xs'} />
      </button>
      {/* The ✕ lies OVER the icons at the chip's end, shown on hover, on focus, and while the chip
          is picked up (a phone has no hover): a slot is narrow, and a ✕ always drawn there took the
          room of half a name on every seated chip. */}
      {onRemove !== undefined && canPlan && (
        <button
          type="button"
          data-cell-control="remove"
          aria-label={t('operations.crewPlan.chip.remove', { name: member.fullNameAr })}
          title={t('operations.crewPlan.chip.remove', { name: member.fullNameAr })}
          onClick={onRemove}
          className={cn(
            'absolute inset-y-0 end-0 flex items-center rounded-e-lg px-1.5 text-white opacity-0 transition focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 group-hover/chip:opacity-100',
            ROLE_FLAT[role],
            selected && 'opacity-100',
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {outOfRole !== undefined && outOfRole !== null && (
        <span
          role="img"
          data-out-of-role="true"
          aria-label={outOfRole}
          title={outOfRole}
          className="absolute -top-1 -start-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#111827]"
        />
      )}
    </div>
  );
};

/** What the three colours mean — said once, beside the board's hint. */
export const RoleLegend = (): JSX.Element => {
  const t = useT();
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] font-bold text-slate-600 dark:text-slate-300"
      data-role-legend="true"
    >
      {(['captain', 'dual', 'specialist'] as const).map((role) => (
        <span key={role} className="inline-flex items-center gap-1">
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', ROLE_DOT[role])} />
          {t(`operations.crewPlan.role.${role}`)}
        </span>
      ))}
    </span>
  );
};
