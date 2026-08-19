// What a crew member CARRIES, at a glance — the legacy pool icons (tashghela.ejs:861-880).
//
// THEY ARE INDICATORS, NOT GATES. Legacy showed a gun, an id and a signature beside each name and
// used the same icons as filter buttons (:1114-1142); none of them ever stopped an assignment, and
// server-side they were never read at all (discovery §9.2). That is the approved decision this
// carries forward: they inform the planner, they do not decide.
//
// WHY THIS IS ITS OWN COMPONENT. The four flags were previously bare emoji in the card's grey code
// line, distinguished only by a `title` — invisible on touch, unreliable to a screen reader, and
// easy to miss on a dense board, which is exactly the complaint that produced this file. And
// `hasTemporaryLicense` was not rendered at all: the board could not tell a full practising licence
// from a temporary one, which is the distinction the flag exists to make.
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';

/** The carried credentials, in the order the legacy pool listed them. */
const CARRIED = [
  ['hasWeapon', '🔫'],
  ['hasSignature', '✍️'],
  ['hasLicense', '🪪'],
  // An hourglass rather than a second id card: the two licences must be told apart at a glance,
  // and two near-identical glyphs would be worse than none.
  ['hasTemporaryLicense', '⏳'],
] as const;

export const CrewFlagIcons = ({
  requirements,
}: {
  requirements: OperationsCrewMemberDto['requirements'];
}): JSX.Element => {
  const t = useT();

  // No row on the roster at all — which is a DIFFERENT fact from "carries nothing", and the one
  // that explains an empty card to a planner wondering where the icons went.
  if (requirements === null) {
    return (
      <span
        className="text-slate-300 dark:text-slate-600"
        title={t('operations.crew.flag.none')}
        aria-label={t('operations.crew.flag.none')}
        role="img"
      >
        —
      </span>
    );
  }

  const carried = CARRIED.filter(([flag]) => requirements[flag] === true);
  if (carried.length === 0) {
    return (
      <span
        className="text-slate-300 dark:text-slate-600"
        title={t('operations.crew.flag.carriesNothing')}
        aria-label={t('operations.crew.flag.carriesNothing')}
        role="img"
      >
        —
      </span>
    );
  }

  return (
    <>
      {carried.map(([flag, glyph]) => (
        <span
          key={flag}
          // A bordered chip, not loose text: on a board of stacked cards the icons have to read as
          // a row of markers rather than punctuation in the code line.
          className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-slate-200 bg-slate-50 px-0.5 leading-none dark:border-slate-600 dark:bg-slate-700"
          role="img"
          // BOTH: `title` is the hover tooltip a mouse user expects, `aria-label` is what a screen
          // reader reads. `title` alone announces nothing reliably, which is what it had before.
          title={t(`operations.crew.flag.${flag}`)}
          aria-label={t(`operations.crew.flag.${flag}`)}
        >
          {glyph}
        </span>
      ))}
    </>
  );
};
