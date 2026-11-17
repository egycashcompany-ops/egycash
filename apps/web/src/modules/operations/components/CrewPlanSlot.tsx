// One SLOT of a crew row — «قائد الطاقم», «أخصائي 1» or «أخصائي 2» — as «لوحة التشغيلة» draws it, for
// «الطاقم الثابت» (Round 27: «نفس شكل لوحة التشغيل»). Every mark is the board's own:
//   · the people in it as the board's chips (`CrewPlanChip`, the person's card on a hover), a seat
//     held outside one's role ringed and worded (Round 23);
//   · EMPTY, the slot is its own «+ اختيار قائد» / «+ اختيار أخصائي» (Round 22 E); half full, a «+»
//     rides beside a chip's ✕ — either opens the slot's list (`CrewSlotPicker`, the page's);
//   · a chip picked up lights the slots it may go to, each with «ضع هنا»;
//   · UNDER A DRAG, the slot the drop would land in says «ضع هنا» over itself, and a slot that would
//     refuse it turns red with why — full, or (Round 23) «للقادة فقط» / «للأخصائيين فقط». The page's
//     frame takes the drag's events (`lib/crew-drag.ts`, Round 22); the slot only marks where it is
//     (`data-slot-zone`), and draws what the frame decided.
// What a slot DOES is the page's: `decide` (the drop's rule, `resolveDrop`) answers every question
// asked here, so a drop, a pick and «ضع هنا» cannot disagree.
import { type DragEvent } from 'react';
import { CREW_SLOT_CAPACITY, type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { BoardIcon, PATH } from '../../fleet/components/FuelCardBoard';
import {
  refusedAsAway,
  refusedAsWrongSlot,
  type DropDecision,
  type DropTarget,
} from '../lib/crew-drag';
import { type CrewSlot, type WrongSlot } from '../lib/crew-plan';
import { CrewPlanChip } from './CrewPlanChip';
import { ON_TINT } from './shift-type-look';

/** One person in the slot, as the page knows him. */
export interface SlotSeat {
  member: OperationsCrewMemberDto;
  /** Seated outside his role (Round 23) — `wrongSlotOf`'s answer, or null. */
  wrong: WrongSlot | null;
  /** The last save named him on this row. */
  refused: boolean;
  /** His row and slot in words — the person card's «في …» line. */
  seatedAt: string | null;
}

export const CrewPlanSlot = ({
  rowKey,
  rowName,
  slot,
  seats,
  canPlan,
  selected,
  dragging,
  overDecision,
  decide,
  listOpen,
  tinted = false,
  onSelect,
  onRemove,
  onOpenList,
  onPlace,
  onDragStart,
  onDragEnd,
}: {
  rowKey: string;
  rowName: string;
  slot: CrewSlot;
  seats: readonly SlotSeat[];
  canPlan: boolean;
  /** A chip picked up (the keyboard's and the phone's way), or null. */
  selected: string | null;
  /** A chip under a drag, or null — for the drawing only. */
  dragging: string | null;
  /** What a drop where the pointer is would do (the page's, from the frame's dragover). */
  overDecision: DropDecision | null;
  /** The drop's rule, for this slot and a person. */
  decide: (target: DropTarget, employeeId: string) => DropDecision | null;
  /** This slot's list is the one open. */
  listOpen: boolean;
  /** The row is drawn in a colour: the empty slot's «+ اختيار» stands on the page's colour. */
  tinted?: boolean;
  onSelect: (employeeId: string) => void;
  onRemove: (employeeId: string) => void;
  onOpenList: (from: HTMLElement) => void;
  /** «ضع هنا» — the picked-up chip, here. */
  onPlace: (employeeId: string) => void;
  onDragStart: (employeeId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}): JSX.Element => {
  const t = useT();
  const zone = `${rowKey}|${slot}`;
  const moving = dragging ?? selected;
  // Armed: what is picked up or dragged would land here — the drop's own answer.
  const armed =
    canPlan &&
    moving !== null &&
    decide({ kind: 'slot', key: rowKey, slot }, moving)?.kind === 'place';
  const slotWord = t(`operations.crewPlan.columns.${slot}`);
  // Its list, «+ اختيار»: on a slot with room, whenever nothing is picked up (then it is «ضع هنا»).
  const offerList = canPlan && selected === null && seats.length < CREW_SLOT_CAPACITY;
  const chooseWord = t(
    `operations.crewPlan.picker.choose.${slot === 'captain' ? 'captain' : 'specialist'}`,
  );
  const isOver =
    overDecision?.kind === 'place' && overDecision.key === rowKey && overDecision.slot === slot;
  const refused =
    overDecision?.kind === 'refuse' &&
    overDecision.key === rowKey &&
    overDecision.slots.includes(slot);
  const refusedWord =
    overDecision?.kind === 'refuse' && refusedAsAway(overDecision.reason)
      ? t(`operations.crewPlan.away.day.${overDecision.reason}`)
      : overDecision?.kind === 'refuse' && refusedAsWrongSlot(overDecision.reason)
        ? t(`operations.crewPlan.wrongSlot.over.${overDecision.reason}`)
        : t('operations.crewPlan.slotFull');
  return (
    <div
      role="group"
      aria-label={`${slotWord} — ${rowName}`}
      data-slot-zone={zone}
      data-drop-over={isOver ? 'accept' : refused ? 'refuse' : undefined}
      className={cn(
        'relative flex min-h-[2.25rem] w-[8.75rem] flex-col gap-1 rounded-lg p-0.5 transition-colors min-[1440px]:w-[9.75rem] min-[1750px]:w-[10.5rem] min-[1900px]:w-[12.25rem]',
        seats.length === 0 && 'border border-dashed border-slate-300/80 dark:border-slate-700/70',
        armed &&
          'outline-dashed outline-2 -outline-offset-1 outline-brand-300/80 dark:outline-brand-500/45',
        isOver &&
          armed &&
          'bg-brand-50 [&&]:outline [&&]:outline-brand-500 dark:bg-brand-500/20 dark:[&&]:outline-brand-400',
        refused &&
          'bg-rose-50 outline-dashed outline-2 -outline-offset-1 outline-rose-400 dark:bg-rose-500/10',
      )}
    >
      {seats.map(({ member, wrong, refused: named, seatedAt }) => (
        <CrewPlanChip
          key={member.employeeId}
          member={member}
          variant="seat"
          selected={selected === member.employeeId}
          dragging={dragging === member.employeeId}
          canPlan={canPlan}
          seatedAt={seatedAt}
          dragActive={dragging !== null}
          wrongSlot={
            wrong === null
              ? null
              : {
                  why: wrong,
                  badge: t(`operations.crewPlan.wrongSlot.badge.${wrong}`),
                  reason: t(`operations.crewPlan.wrongSlot.held.${wrong}`),
                }
          }
          refused={named}
          onSelect={() => onSelect(member.employeeId)}
          onRemove={() => onRemove(member.employeeId)}
          onAdd={
            offerList
              ? {
                  label: t('operations.crewPlan.picker.add', { slot: slotWord, row: rowName }),
                  open: onOpenList,
                }
              : undefined
          }
          onDragStart={(event) => onDragStart(member.employeeId, event)}
          onDragEnd={onDragEnd}
        />
      ))}
      {seats.length === 0 && offerList && (
        <button
          type="button"
          data-cell-control="pick"
          data-slot-pick={zone}
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          aria-label={`${chooseWord} — ${slotWord} — ${rowName}`}
          onClick={(event) => onOpenList(event.currentTarget)}
          className={cn(
            'flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-md text-[11.5px] font-bold transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:text-brand-200',
            listOpen
              ? cn(
                  'text-brand-700 dark:text-brand-200',
                  tinted ? 'bg-brand-50 dark:bg-[#16203a]' : 'bg-brand-500/15',
                )
              : tinted
                ? ON_TINT.pick.tinted
                : ON_TINT.pick.plain,
            dragging !== null && 'invisible',
          )}
        >
          <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
          {chooseWord}
        </button>
      )}
      {/* Over the slot, never in its flow: a line added there grew the row under the pointer. */}
      {dragging !== null && isOver && armed && (
        <span
          aria-hidden
          data-drop-landing="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-brand-500/90 text-[11.5px] font-black text-white shadow"
        >
          <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
          {t('operations.crewPlan.placeHere')}
        </span>
      )}
      {selected !== null && armed && (
        <button
          type="button"
          data-cell-control="place"
          data-place={zone}
          onClick={() => onPlace(selected)}
          className="flex min-h-[1.75rem] items-center justify-center gap-1 rounded-md border border-dashed border-brand-400 bg-brand-500/10 text-[11.5px] font-black text-brand-700 transition hover:bg-brand-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-200"
        >
          <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
          {t('operations.crewPlan.placeHere')}
        </button>
      )}
      {refused && (
        <span
          role="status"
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-rose-600/85 px-1 text-center text-[12px] font-black leading-4 text-white backdrop-blur-[1px]"
        >
          {refusedWord}
        </span>
      )}
    </div>
  );
};
