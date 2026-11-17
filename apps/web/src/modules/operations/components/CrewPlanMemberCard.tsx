// The person card on «لوحة التشغيلة» — Round 22.
//
// THE OWNER: «ولما اقف على القائد يظهر فى كارد زى السواق فى الحركة». Hovering a name on the board — in
// a pool, or seated on a row — opens the card Fleet's «الحركة» board opens on a driver: the WHOLE name
// at its head, then the facts, label beside value. It is the Operations person card already on
// «كشف طاقم العمليات» (`RosterMemberCard`, Round 19b, «زى السواق»), with what THIS board adds:
//   · the ROLE, in the chip's own colour — green «قائد», blue «أخصائي يعمل قائدًا», red «أخصائي»;
//   · WHERE HE SITS in the draft — the row and the slot («213 · قائد الطاقم»), or «غير معيَّن اليوم»;
//   · his ATTENDANCE on the board's day (`PlanAttendanceFact`, Round 22 F): «غائب» or «في إجازة» as HR
//     has it — the reason a pale chip cannot be put on a row — or that HR records neither;
//   · what he holds, each flag by its ICON (the chips' drawings) and its name.
// The owner said «القائد»; the card is on EVERY person chip, captains and specialists alike — one
// board, one way to ask «who is this», and a specialist's flags are as much the planner's question.
//
// THE MECHANICS ARE FLEET'S (`useHoverCard` + `HoverCardLayer`), as the driver card's: the same beat
// before it opens, at once on a keyboard focus, one card open at a time across every card and tip,
// closed on leave, blur, Escape and any press; drawn in a layer of its own that takes NO pointer
// events, placed above the name (below when there is no room), following it as the pool scrolls.
//
// IT NEVER GETS IN A DRAG'S WAY: the press that starts a drag closes it (and the card waiting to
// open); while a drag is in progress no card opens at all (`dragActive` — the page's own state), so
// nothing is ever drawn over the slots the drag is aiming at; and it takes no pointer events, so even
// open it could not take a drop. The MOUSE opens it from the NAME only — the requirement icons beside
// it open their own small tips (`crew-plan-icons`), and the two never fight over the same spot. The
// KEYBOARD opens it from the chip's button (Tab), which adds no tab stop of its own.
import { type ReactNode } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';
import {
  HOVER_CARD_FACTS,
  HoverCardFact as Fact,
  HoverCardLayer,
  useHoverCard,
  type HoverCardTriggerProps,
} from '../../fleet/components/HoverCardLayer';
import { crewRoleOf, flagsOf, type CrewAway, type CrewRole } from '../lib/crew-plan';
import { CardHead, PersonIcon } from './BoardCrewCards';
import { FLAG_PATH } from './crew-plan-icons';
import { CardHeld, CarriesNothing, CrewPersonFacts, HeldChip } from './RosterMemberCard';

/** The role in the chip's own solid colour (`ROLE_FILL`, without its hover). */
const ROLE_PILL: Record<CrewRole, string> = {
  captain: 'bg-emerald-600 dark:bg-emerald-700',
  dual: 'bg-sky-600 dark:bg-sky-700',
  specialist: 'bg-rose-600 dark:bg-rose-700',
};

/** The attendance line's words in the badge's colours: «غائب» red, «في إجازة» amber. */
const AWAY_TONE: Record<CrewAway, string> = {
  absent: 'text-rose-700 dark:text-rose-300',
  onLeave: 'text-amber-700 dark:text-amber-300',
};

/**
 * The card's attendance line on the board's day (Round 22 F): «غائب في هذا اليوم» or «في إجازة في
 * هذا اليوم» — what keeps him off a row — or «لا غياب ولا إجازة مسجَّلة» when HR answers neither (at
 * work, a day off, or not computed yet: an unknown is not an absence).
 */
export const PlanAttendanceFact = ({ away }: { away: CrewAway | null }): JSX.Element => {
  const t = useT();
  return (
    <Fact label={t('operations.crewPlan.card.attendance')}>
      {away === null ? (
        <span data-plan-member-away="none" className="text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.card.attendanceNone')}
        </span>
      ) : (
        <span data-plan-member-away={away} className={cn('font-black', AWAY_TONE[away])}>
          {t(`operations.crewPlan.away.day.${away}`)}
        </span>
      )}
    </Fact>
  );
};

/**
 * What the card says. Exported for the specs. `seat`: where he sits in the draft, in words, or null;
 * `attendance`: a whole fact line for his attendance on the board's day, or null for none (yet).
 */
export const PlanMemberCardBody = ({
  member,
  mayReadCrew,
  seat,
  attendance = null,
}: {
  member: OperationsCrewMemberDto;
  mayReadCrew: boolean;
  seat: string | null;
  attendance?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const role = crewRoleOf(member.requirements);
  const flags = flagsOf(member);
  return (
    <div data-plan-member-card={role}>
      <CardHead
        icon={<PersonIcon />}
        sub={
          <span
            data-plan-member-role={role}
            className={cn(
              'mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-black leading-4 text-white',
              ROLE_PILL[role],
            )}
          >
            {t(`operations.crewPlan.role.${role}`)}
          </span>
        }
      >
        {/* The WHOLE name, wrapped — the chip cuts it to its column. */}
        {member.fullNameAr}
      </CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <CrewPersonFacts member={member} mayReadCrew={mayReadCrew} />
        <Fact label={t('operations.crewPlan.card.seat')}>
          {seat === null ? (
            <span data-plan-member-seat="none" className="text-slate-500 dark:text-slate-400">
              {t('operations.crewPlan.card.unseated')}
            </span>
          ) : (
            <span data-plan-member-seat="true">{seat}</span>
          )}
        </Fact>
        {/* His attendance on the board's day — one line (`PlanAttendanceFact`, from the chip). */}
        {attendance}
      </dl>
      {/* «قائد» and «أخصائي» are the role above; these are the rest, as the chip's icons. */}
      <CardHeld>
        {flags.length === 0 ? (
          <CarriesNothing />
        ) : (
          <span className="flex flex-wrap gap-1" data-plan-member-held={flags.join(' ')}>
            {flags.map((flag) => (
              <HeldChip
                key={flag}
                mark={
                  <StrokeIcon
                    d={FLAG_PATH[flag]}
                    className="h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-300"
                    width={2.2}
                  />
                }
              >
                {t(`operations.crew.flag.${flag}`)}
              </HeldChip>
            ))}
          </span>
        )}
      </CardHeld>
    </div>
  );
};

/** Some of the trigger's props — each present, or not at all. */
type TriggerPart<K extends keyof HoverCardTriggerProps> = {
  [P in K]?: HoverCardTriggerProps[P] | undefined;
};

/** The mouse's half of the trigger — on the NAME — and the keyboard's — on the chip's button. */
export interface PlanMemberCardTrigger {
  nameProps: TriggerPart<'ref' | 'onMouseEnter' | 'onMouseLeave' | 'onMouseDown'> & {
    'data-plan-member-hover'?: 'true';
  };
  buttonProps: TriggerPart<'onFocus' | 'onBlur' | 'onKeyDown' | 'aria-describedby'>;
  /** The card while open — a portal, so where it sits in the markup changes nothing on screen. */
  card: ReactNode;
}

/**
 * One chip's card. Spread `nameProps` on the element that draws the name, `buttonProps` on the
 * chip's button, and render `card` anywhere in the chip.
 *
 * `dragActive`: a chip is being dragged somewhere on the board — no card opens, an open one is gone.
 * `seat`: where he sits in the draft, in words, or null. `attendance`: his attendance line, if any.
 */
export const usePlanMemberCard = (
  member: OperationsCrewMemberDto,
  {
    dragActive,
    seat,
    attendance = null,
  }: { dragActive: boolean; seat: string | null; attendance?: ReactNode },
): PlanMemberCardTrigger => {
  const can = useCan();
  const hover = useHoverCard(!dragActive, { focusable: false });
  const { ref, onMouseEnter, onMouseLeave, onMouseDown, onFocus, onBlur, onKeyDown } =
    hover.triggerProps;
  return {
    nameProps:
      ref === undefined
        ? {}
        : { ref, onMouseEnter, onMouseLeave, onMouseDown, 'data-plan-member-hover': 'true' },
    buttonProps: {
      onFocus,
      onBlur,
      onKeyDown,
      'aria-describedby': hover.triggerProps['aria-describedby'],
    },
    card: hover.open ? (
      <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="crew-plan">
        <PlanMemberCardBody
          member={member}
          mayReadCrew={can('operationsCrew.view')}
          seat={seat}
          attendance={attendance}
        />
      </HoverCardLayer>
    ) : null,
  };
};
