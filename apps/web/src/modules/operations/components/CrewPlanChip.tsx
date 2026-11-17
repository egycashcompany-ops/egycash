// One person on «لوحة التشغيلة» — in a pool, or seated in a row's slot.
//
// THE COLOUR IS THE ROLE, as the legacy board drew it and as the owner reads it: GREEN a captain,
// BLUE a specialist who also leads («اللى فى خانة القادة بس لونهم ازرق»), RED a specialist
// (`crewRoleOf`). The requirement icons sit beside the name («يظهر جمب القائد او الاخصائى»).
//
// TWO WAYS TO MOVE IT, both always there:
//   · DRAG it (HTML5) onto a row or a slot, or back onto a pool. The chip only starts the drag; the
//     page knows who is dragged from that start and decides every drop (`lib/crew-drag.ts`, Round 22:
//     «بسحب الاسم بالماوس وبيرجع تانى» — nothing here may hang a drop on what the browser shows);
//   · or PRESS it (mouse, Enter or Space) to pick it up — it rings — then press «ضع هنا» in a slot.
//     The keyboard's way and the phone's, where a drag does not exist; as «توزيع المحصنات» offers
//     its «نقل إلى…» beside the drag.
//
// HOVERING IT (Round 22) opens the person's CARD — «ولما اقف على القائد يظهر فى كارد زى السواق فى
// الحركة» (`CrewPlanMemberCard`): from the NAME with the mouse, from the button with the keyboard. Each
// requirement icon opens its own small TIP. Both replace the browser's `title` the chip had, and
// neither ever gets in a drag's way (see those files). The card says his attendance on the day.
//
// AWAY THAT DAY (Round 22) — «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت
// ومقدرش احطه على العربيه و كذلك الاخصائيين». HR has him absent or on leave (`awayOf`):
//   · in a POOL: the role's colour gone PALE — further than the dim of somebody already placed — with
//     «غائب» or «إجازة» on the chip; it cannot be dragged or picked up (the slots and the save refuse
//     him too). Its card still opens, so the planner can see why;
//   · SEATED on a row (put there before HR recorded it): the chip keeps its colour, says «غائب» (red)
//     or «إجازة» (amber) and is ringed in that colour, and stays until the planner takes him off — the
//     server lets a seat held before the absence stay, so the save still passes.
//
// IN A SLOT NOT HIS ROLE'S (Round 23) — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد
// اخصائى». No drop, pick or load puts anybody there any more; somebody already sitting there (seated
// before the rule, or before «متطلبات الطاقم» changed his flags) keeps the seat, as the server lets
// him, and is MARKED: a dashed amber ring and a word on the chip — «ليس قائدًا» / «ليس أخصائيًا» —
// with the whole reason for a screen reader and on hover. Not removed: taking him out is the
// planner's act. (The Round-20 board drew a quiet dot here and called it «marked, not refused».)
//
// «+» BESIDE THE ✕ (Round 22 E): a seated chip in a slot with room for one more carries the slot's
// own «choose from the list» — «لما ادوس عليه يجيب قايمة الناس اللى اختار منهم» — where the ✕ is, so
// the half-full slot keeps its one line.
import { type DragEvent } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  awayOf,
  crewRoleOf,
  flagsOf,
  type CrewAway,
  type CrewRole,
  type WrongSlot,
} from '../lib/crew-plan';
import { PlanAttendanceFact, usePlanMemberCard } from './CrewPlanMemberCard';
import { CrewFlagMarks } from './crew-plan-icons';
import { showsDayFacts, useCrewPlanScope } from './crew-plan-scope';

/** The role's fill — solid, as legacy's, so a column of names reads by colour first. */
export const ROLE_FILL: Record<CrewRole, string> = {
  captain: 'bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600',
  dual: 'bg-sky-600 hover:bg-sky-500 dark:bg-sky-700 dark:hover:bg-sky-600',
  specialist: 'bg-rose-600 hover:bg-rose-500 dark:bg-rose-700 dark:hover:bg-rose-600',
};

/**
 * The role's colour gone PALE — «باللون الباهت» — for somebody away that day in a pool: a tint of
 * the colour, its words in the colour itself, and no hover, as nothing can be done with it. Still
 * the role's own hue, so the column keeps reading green, blue, red.
 */
export const ROLE_PALE: Record<CrewRole, string> = {
  captain:
    'bg-emerald-600/[0.12] text-emerald-900/70 ring-1 ring-inset ring-emerald-600/25 dark:bg-emerald-400/[0.08] dark:text-emerald-100/55 dark:ring-emerald-400/20',
  dual: 'bg-sky-600/[0.12] text-sky-900/70 ring-1 ring-inset ring-sky-600/25 dark:bg-sky-400/[0.08] dark:text-sky-100/55 dark:ring-sky-400/20',
  specialist:
    'bg-rose-600/[0.12] text-rose-900/70 ring-1 ring-inset ring-rose-600/25 dark:bg-rose-400/[0.08] dark:text-rose-100/55 dark:ring-rose-400/20',
};

/**
 * «غائب» red, «إجازة» amber — a solid word that stands out on the solid chip of a seated person and
 * on the pale one in a pool alike. The picker's list uses the same two.
 */
export const AWAY_BADGE: Record<CrewAway, string> = {
  absent:
    'bg-white text-rose-700 ring-1 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-500/60',
  onLeave: 'bg-amber-300 text-amber-950 ring-1 ring-amber-400 dark:bg-amber-400',
};

/** The ring around a SEATED chip of somebody away that day, in his badge's colour. */
const AWAY_SEATED: Record<CrewAway, string> = {
  absent: 'outline outline-2 outline-offset-1 outline-rose-500 dark:outline-rose-400',
  onLeave: 'outline outline-2 outline-offset-1 outline-amber-400 dark:outline-amber-300',
};

/** The dashed amber ring of a seat held outside one's role (Round 23) — apart from the away ring. */
const WRONG_SLOT_RING =
  'outline-dashed outline-2 outline-offset-1 outline-amber-400 dark:outline-amber-300';

/** The word on that chip — amber, solid, readable on all three role colours. */
const WRONG_SLOT_BADGE = 'bg-amber-300 text-amber-950 ring-1 ring-amber-500 dark:bg-amber-300';

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
  seatedAt = null,
  dragActive = false,
  wrongSlot = null,
  refused = false,
  onSelect,
  onRemove,
  onAdd,
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
  /** Seated on a row: that row and slot in words («213 · قائد الطاقم») — on the person's card. */
  seatedAt?: string | null;
  /** A chip — any — is being dragged on the board: no card and no icon tip opens. */
  dragActive?: boolean;
  /**
   * Seated in a slot his role does not fit — a seat HELD from before the rule or before his flags
   * changed (Round 23): `why` says which way, `badge` the word on the chip, `reason` the whole
   * sentence. Null — he fits where he sits (or sits nowhere).
   */
  wrongSlot?: { why: WrongSlot; badge: string; reason: string } | null;
  /** The last save named THIS person on this row (`planRefusal`'s `crew`): ringed until moved. */
  refused?: boolean;
  onSelect: () => void;
  /** Seated: the ✕ that sends them back to the pool. */
  onRemove?: (() => void) | undefined;
  /**
   * Seated, in a slot with room for one more: the «+» beside the ✕ that opens the slot's list
   * (Round 22 E) — `label` says which slot of which row, for the screen reader and the hover.
   */
  onAdd?: { label: string; open: (from: HTMLElement) => void } | undefined;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}): JSX.Element => {
  const t = useT();
  const role = crewRoleOf(member.requirements);
  const flags = flagsOf(member);
  const where = placedAt ?? null;
  const placed = where !== null;
  const away = awayOf(member);
  // Away, in a pool: shown, pale, its card open to a hover — and nothing else. Neither dragged nor
  // picked up: no row would take him. Seated, he moves as anybody (off the board, or on his row).
  const blocked = away !== null && variant === 'pool';
  const movable = canPlan && !blocked;
  // The whole name, the code, the role, where he sits and his day: the card, on hover (no `title`).
  // «الطاقم الثابت» has no day (Round 27): no attendance line — HR's answer is about one day.
  const dayFacts = showsDayFacts(useCrewPlanScope());
  const card = usePlanMemberCard(member, {
    dragActive,
    seat: where?.long ?? seatedAt,
    attendance: dayFacts ? <PlanAttendanceFact away={away} /> : null,
  });
  const awayWord = away === null ? null : t(`operations.crewPlan.away.${away}`);

  return (
    <div
      draggable={movable}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={movable ? onDragEnd : undefined}
      data-crew-chip={member.employeeId}
      data-role={role}
      data-placed={placed ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-away={away ?? undefined}
      data-wrong-slot={wrongSlot?.why}
      data-refused={refused ? 'true' : undefined}
      className={cn(
        'group/chip relative flex min-w-0 items-stretch rounded-lg transition',
        blocked
          ? cn(ROLE_PALE[role], 'cursor-not-allowed')
          : cn(ROLE_FILL[role], 'text-white shadow-sm'),
        movable && 'cursor-grab active:cursor-grabbing',
        placed && !blocked && 'opacity-50 saturate-50 hover:opacity-80',
        away !== null && variant === 'seat' && AWAY_SEATED[away],
        // Away outranks it for the ring (both say «take him out»); the word stays on the chip.
        wrongSlot !== null && away === null && WRONG_SLOT_RING,
        dragging && 'opacity-30',
        selected &&
          'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-amber-300 dark:ring-offset-[#0b1226]',
        // Solid (Round 24b): a half-clear rose ring vanished on a row drawn in rose.
        refused && 'ring-4 ring-rose-600 dark:ring-rose-400',
      )}
    >
      <button
        type="button"
        data-cell-control="chip"
        // Away in a pool: still a stop for the keyboard (its card says why), but nothing to press —
        // `aria-disabled`, not `disabled`, which would also silence the hover that opens the card.
        disabled={!canPlan}
        aria-disabled={blocked ? true : undefined}
        aria-pressed={blocked ? undefined : selected}
        aria-label={
          blocked
            ? `${member.fullNameAr} — ${t(`operations.crewPlan.away.why.${away}`)}`
            : wrongSlot !== null
              ? `${t('operations.crewPlan.chip.select', { name: member.fullNameAr })} — ${wrongSlot.reason}`
              : t('operations.crewPlan.chip.select', { name: member.fullNameAr })
        }
        {...card.buttonProps}
        onClick={blocked ? undefined : onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 text-start focus:outline-none focus-visible:ring-2 disabled:cursor-default',
          blocked
            ? 'cursor-not-allowed focus-visible:ring-slate-400'
            : 'focus-visible:ring-white/80',
          variant === 'pool' ? 'rounded-lg px-2 py-1' : 'rounded-lg py-1 pe-1 ps-1.5',
        )}
      >
        <span
          {...card.nameProps}
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
              'shrink-0 rounded px-1 text-[11px] font-black leading-4',
              blocked ? 'bg-black/10 dark:bg-white/10' : 'bg-black/30 text-white',
            )}
          >
            {where.short}
          </span>
        )}
        {wrongSlot !== null && (
          <span
            data-wrong-slot-badge={wrongSlot.why}
            title={wrongSlot.reason}
            className={cn(
              'shrink-0 rounded px-1 text-[11px] font-black leading-4',
              WRONG_SLOT_BADGE,
            )}
          >
            {wrongSlot.badge}
          </span>
        )}
        {away !== null && awayWord !== null && (
          <span
            data-away-badge={away}
            className={cn(
              'shrink-0 rounded px-1 text-[11px] font-black leading-4',
              AWAY_BADGE[away],
            )}
          >
            {awayWord}
          </span>
        )}
        <CrewFlagMarks flags={flags} size={variant === 'pool' ? 'sm' : 'xs'} quiet={dragActive} />
      </button>
      {/* The ✕ lies OVER the icons at the chip's end, shown on hover, on focus, and while the chip
          is picked up (a phone has no hover): a slot is narrow, and a ✕ always drawn there took the
          room of half a name on every seated chip. The «+» of a slot with room rides with it. */}
      {canPlan && (onRemove !== undefined || onAdd !== undefined) && (
        <span
          data-chip-actions="true"
          className={cn(
            'absolute inset-y-0 end-0 flex items-stretch rounded-e-lg text-white opacity-0 transition focus-within:opacity-100 group-hover/chip:opacity-100',
            ROLE_FLAT[role],
            selected && 'opacity-100',
          )}
        >
          {onAdd !== undefined && (
            <button
              type="button"
              data-cell-control="add"
              data-slot-add="true"
              aria-haspopup="dialog"
              aria-label={onAdd.label}
              title={onAdd.label}
              onClick={(event) => onAdd.open(event.currentTarget)}
              className="flex items-center px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
            >
              <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
            </button>
          )}
          {onRemove !== undefined && (
            <button
              type="button"
              data-cell-control="remove"
              aria-label={t('operations.crewPlan.chip.remove', { name: member.fullNameAr })}
              title={t('operations.crewPlan.chip.remove', { name: member.fullNameAr })}
              onClick={onRemove}
              className="flex items-center rounded-e-lg px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
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
        </span>
      )}
      {card.card}
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
