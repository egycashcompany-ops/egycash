// A member's name on «كشف طاقم العمليات», with their card — Round 19b.
//
// The owner: «يكون فيها الاسم بتاع القائد فى الاول وجمبه صغير كدا الكود ولما اقف على القائد يجيب
// بياناته زى السواق». So the row starts with the PERSON — the name, the code small beside it — and
// hovering the name (or reaching it with Tab) opens the Fleet driver card's facts for them: the
// whole name, the code, «الوظيفة», the mobile number, the branch — and what they hold, the flags as
// small labelled chips, since that is what this screen is about.
//
// The mechanics are Fleet's own (`HoverCardLayer`), the same the day board's captain card rides
// (`BoardCrewCards`): one card open at a time across every kind, a portal that takes no pointer
// events, Escape and any press close it. Its look is that captain card's — the same head, figures
// and branch naming, shared from there.
//
// Everything comes with the roster (`GET /operations/crew-board/directory`, under
// `operationsCrew.view`): nothing is fetched when a card opens except the branch names, one cached
// list any signed-in reader may read. A reader without `operationsCrew.view` is sent no phone, and
// the card has no phone line at all — as the captain card — rather than a dash that reads «no
// phone». The roster itself is read under that grant, so today everyone who can open this screen
// gets the line; the guard stays so the card never shows a phone line the server sent nothing for,
// should the roster ever be read under another grant.
import { type ReactNode } from 'react';
import { type Locale, type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { useAppSelector } from '../../../store';
import {
  HOVER_CARD_FACTS,
  HoverCardFact as Fact,
  HoverCardLayer,
  HoverCardMissing as Missing,
  useHoverCard,
} from '../../fleet/components/HoverCardLayer';
import { heldFlags } from '../lib/requirements';
import { CardHead, Figure, PersonIcon, useBranchName } from './BoardCrewCards';

/** The ✓ the roster's round toggles carry (`RosterFlagToggle`), small, at the start of a chip. */
const CHECK = 'M5 13l4 4L19 7';

/**
 * The person's own facts — the Fleet driver card's: the code, «الوظيفة», the mobile number (only for
 * a reader the server sends it to) and the branch, named from the shared list. Lines of a
 * `HOVER_CARD_FACTS` grid, so a card adds its own lines after them. Shared with the person card on
 * «لوحة التشغيلة» (`CrewPlanMemberCard`, Round 22): one person card for Operations, two screens.
 */
export const CrewPersonFacts = ({
  member,
  mayReadCrew,
}: {
  member: OperationsCrewMemberDto;
  mayReadCrew: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const branch = useBranchName(member.branchId);
  return (
    <>
      <Fact label={t('fleet.drivers.columns.employeeCode')}>
        <Figure>{member.code}</Figure>
      </Fact>
      <Fact label={t('operations.crew.requirements.jobTitle')}>
        {member.jobTitle === null ? (
          <Missing />
        ) : (
          member.jobTitle.name[locale] || member.jobTitle.name.ar
        )}
      </Fact>
      {mayReadCrew && (
        <Fact label={t('fleet.drivers.columns.phone')}>
          {member.phone === null ? <Missing /> : <Figure>{member.phone}</Figure>}
        </Fact>
      )}
      <Fact label={t('fleet.drivers.columns.branch')}>
        {branch === null || branch === 'loading' ? (
          <Missing loading={branch === 'loading'} />
        ) : (
          branch
        )}
      </Fact>
    </>
  );
};

/**
 * «يحمل» — what they hold, under a rule and across the card's whole width: four chips squeezed into
 * the value column stood one per line.
 */
export const CardHeld = ({ children }: { children: ReactNode }): JSX.Element => {
  const t = useT();
  return (
    <dl className="mt-2.5 border-t border-slate-200 pt-2 text-[13px] leading-snug dark:border-[#2b3b6b]">
      <dt className="font-semibold text-slate-500 dark:text-slate-400">
        {t('operations.crew.requirements.holds')}
      </dt>
      <dd className="mt-1.5">{children}</dd>
    </dl>
  );
};

/** «لا يحمل شيئًا مسجلًا» — a row with every flag off, or no row yet: either way nothing on file. */
export const CarriesNothing = (): JSX.Element => {
  const t = useT();
  return (
    <span className="font-semibold text-slate-500 dark:text-slate-400">
      {t('operations.crew.flag.carriesNothing')}
    </span>
  );
};

/**
 * One flag held, as a chip that says its name in words after a small mark — the card is a tooltip,
 * so an icon alone would have nothing to hover for its name.
 */
export const HeldChip = ({
  mark,
  children,
}: {
  mark: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-4',
      'bg-emerald-500/15 text-emerald-800 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-200',
    )}
  >
    {mark}
    {children}
  </span>
);

/** The ✓ in its green circle — the roster's mark for a flag held. */
const HeldCheck = (): JSX.Element => (
  <span
    aria-hidden
    className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
  >
    <svg viewBox="0 0 24 24" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth={4}>
      <path d={CHECK} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/**
 * What the member card says, from the roster's own row. Exported for the specs. `mayReadCrew`: the
 * reader holds `operationsCrew.view` — without it the server sends no phone, and the card has no
 * phone line.
 */
export const RosterMemberCardBody = ({
  member,
  mayReadCrew,
}: {
  member: OperationsCrewMemberDto;
  mayReadCrew: boolean;
}): JSX.Element => {
  const t = useT();
  const held = heldFlags(member);
  return (
    <div data-roster-card="true">
      {/* The WHOLE name, wrapped — the table's column may cut it to two lines. */}
      <CardHead icon={<PersonIcon />}>{member.fullNameAr}</CardHead>
      <dl className={HOVER_CARD_FACTS}>
        <CrewPersonFacts member={member} mayReadCrew={mayReadCrew} />
      </dl>
      <CardHeld>
        {held.length === 0 ? (
          <CarriesNothing />
        ) : (
          <span className="flex flex-wrap gap-1" data-roster-card-held={held.join(' ')}>
            {held.map((flag) => (
              <HeldChip key={flag} mark={<HeldCheck />}>
                {t(`operations.crew.flag.${flag}`)}
              </HeldChip>
            ))}
          </span>
        )}
      </CardHeld>
    </div>
  );
};

/**
 * The member's name in the roster's person column, with their card. The trigger is the name's own
 * element; the card is a portal, so the cell's layout is what it was.
 */
export const RosterMemberHoverName = ({
  member,
  className,
}: {
  member: OperationsCrewMemberDto;
  className?: string;
}): JSX.Element => {
  const can = useCan();
  const hover = useHoverCard(true);
  return (
    <>
      <span
        className={cn(
          className,
          // Says it opens something, as a linked name does — and where the keyboard is.
          'cursor-default rounded-sm decoration-slate-400/70 decoration-dotted underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        )}
        data-roster-hover="true"
        {...hover.triggerProps}
      >
        {member.fullNameAr}
      </span>
      {hover.open && (
        <HoverCardLayer id={hover.id} anchor={hover.anchor} mark="roster">
          <RosterMemberCardBody member={member} mayReadCrew={can('operationsCrew.view')} />
        </HoverCardLayer>
      )}
    </>
  );
};
